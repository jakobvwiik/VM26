"use client";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase";
import { isAdminEmail } from "../lib/config";
import { teamNo, teamFlag, teamLabel } from "../lib/teams";
import {
  scorePrediction, groupByStage, isKnockout, teamsSet, teamsFromMatches, STAGE_ORDER,
  scoreBonus, YN_QUESTIONS, TEAM_PICK_QUESTIONS, DEFAULT_BONUS_RULES,
  matchLocked, bonusLocked, bonusDeadlineMs, fmtNO, deadlineLabel, kickoffInstant,
} from "../lib/scoring";

export default function Home() {
  const supabase = createClient();
  const router = useRouter();

  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [matches, setMatches] = useState([]);
  const [preds, setPreds] = useState({});       // match_id -> my prediction row
  const [allPreds, setAllPreds] = useState([]);
  const [rules, setRules] = useState({ exact_pts:3, outcome_pts:1, wrong_pts:0 });
  const [myBonus, setMyBonus] = useState(null);
  const [allBonus, setAllBonus] = useState([]);
  const [bonusAnswers, setBonusAnswers] = useState({ yn:{}, teams:[], picks:{}, yn_notes:{} });
  const [bonusRules, setBonusRules] = useState({ ...DEFAULT_BONUS_RULES });
  const [doubleStages, setDoubleStages] = useState({});
  const [prevRanks, setPrevRanks] = useState({});
  const [tab, setTab] = useState("predict");
  const [sortMode, setSortMode] = useState("gruppe");
  const [loading, setLoading] = useState(true);
  const [needsTerms, setNeedsTerms] = useState(false);
  const isAdmin = isAdminEmail(me?.email);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) router.replace("/auth"); else setMe(data.session.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s); setMe(s?.user || null);
      if (!s) router.replace("/auth");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadAll = useCallback(async () => {
    if (!me) return;
    // Fetch ALL predictions in pages — Supabase caps a single query at 1000 rows,
    // and with many players × 72+ matches we exceed that, which made the leaderboard
    // under-count tips. Page through until we've got everything.
    async function fetchAllPredictions(){
      const pageSize = 1000;
      let from = 0, all = [];
      while(true){
        const { data, error } = await supabase
          .from("predictions").select("*")
          .range(from, from + pageSize - 1);
        if(error || !data) break;
        all = all.concat(data);
        if(data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }
    const [m, prAll, mine, pf, rl, ab, ba, br, ds, rs] = await Promise.all([
      supabase.from("matches").select("*").order("match_no"),
      fetchAllPredictions(),
      supabase.from("predictions").select("*").eq("user_id", me.id),
      supabase.from("profiles").select("*"),
      supabase.from("scoring_rules").select("*").eq("id",1).single(),
      supabase.from("bonus_predictions").select("*"),
      supabase.from("bonus_answers").select("*").eq("id",1).single(),
      supabase.from("bonus_rules").select("*").eq("id",1).single(),
      supabase.from("double_stages").select("*").eq("id",1).single(),
      supabase.from("rank_snapshot").select("*").eq("id",1).single(),
    ]);
    setMatches(m.data || []);
    setAllPreds(prAll || []);
    const mm = {}; (mine.data||[]).forEach(p=>{ mm[p.match_id]=p; }); setPreds(mm);
    setProfiles(pf.data || []);
    if (rl.data) setRules(rl.data);
    setAllBonus(ab.data || []);
    setMyBonus((ab.data||[]).find(x=>x.user_id===me.id) || { user_id:me.id, yn:{}, teams:[], picks:{} });
    if (ba.data) setBonusAnswers({ yn:ba.data.yn||{}, teams:ba.data.teams||[], picks:ba.data.picks||{}, yn_notes:ba.data.yn_notes||{} });
    if (br.data) setBonusRules(br.data);
    if (ds.data) setDoubleStages(ds.data.stages||{});
    if (rs.data) setPrevRanks(rs.data.ranks||{});
    const myProfile = (pf.data||[]).find(p=>p.id===me.id);
    setNeedsTerms(!!myProfile && !myProfile.accepted_terms && !isAdminEmail(me.email));
    setLoading(false);
  }, [me]);

  useEffect(()=>{ if(me) loadAll(); }, [me, loadAll]);

  const reloadTimer = useRef(null);
  const saveTimers = useRef({});       // matchId -> timeout id
  const ignoreReload = useRef(false);  // suppress our own realtime echo
  const debouncedReload = useCallback(()=>{
    if(ignoreReload.current) return;          // ikke last på nytt pga. vår egen skriving
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(()=>{ loadAll(); }, 2500); // samle opp endringer i 2,5 s
  }, [loadAll]);

  useEffect(()=>{
    if(!me) return;
    const ch = supabase.channel("kbb")
      .on("postgres_changes",{event:"*",schema:"public",table:"matches"},debouncedReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"predictions"},debouncedReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"scoring_rules"},debouncedReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"bonus_predictions"},debouncedReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"bonus_answers"},debouncedReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"bonus_rules"},debouncedReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"double_stages"},debouncedReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"rank_snapshot"},debouncedReload)
      .subscribe();
    return ()=>supabase.removeChannel(ch);
  }, [me, debouncedReload]);

  const predictedCount = useMemo(()=>matches.filter(m=>{
    const p=preds[m.id]; if(!p) return false;
    if(isKnockout(m.stage) && !teamsSet(m)) return false; // TBA, not yet tippable
    return p.pred_home!=null && p.pred_away!=null;
  }).length, [matches, preds]);

  function flushPred(matchId, row){
    ignoreReload.current = true;
    supabase.from("predictions").upsert(row, { onConflict:"user_id,match_id" })
      .then(()=>{ setTimeout(()=>{ ignoreReload.current = false; }, 1200); });
  }

  function savePred(matchId, patch){
    const m = matches.find(x=>x.id===matchId);
    if(matchLocked(m, null, isAdmin)) return;
    const cur = preds[matchId] || { user_id:me.id, match_id:matchId };
    const next = { ...cur, ...patch, user_id:me.id, match_id:matchId };
    setPreds(p=>({ ...p, [matchId]: next }));   // umiddelbar UI-oppdatering
    const row = {
      user_id:me.id, match_id:matchId,
      pred_home: next.pred_home ?? null, pred_away: next.pred_away ?? null,
      updated_at: new Date().toISOString(),
    };
    // Debounce: vent ~800 ms etter siste tastetrykk før vi skriver til databasen
    clearTimeout(saveTimers.current[matchId]);
    saveTimers.current[matchId] = setTimeout(()=>flushPred(matchId, row), 800);
  }

  // Lagre eventuelle ventende tips hvis fanen lukkes / mister fokus
  useEffect(()=>{
    function flushAll(){
      Object.keys(saveTimers.current).forEach(id=>{
        if(saveTimers.current[id]){ clearTimeout(saveTimers.current[id]); }
      });
    }
    window.addEventListener("pagehide", flushAll);
    window.addEventListener("beforeunload", flushAll);
    return ()=>{ window.removeEventListener("pagehide", flushAll); window.removeEventListener("beforeunload", flushAll); };
  }, []);

  async function toggleMatchLock(m){
    if(!isAdmin) return;
    await supabase.from("matches").update({ locked_manual: !m.locked_manual }).eq("id", m.id);
    loadAll();
  }

  async function saveBonus(next){
    if(bonusLocked(null, isAdmin)) return;
    setMyBonus(next);
    setAllBonus(list=>[...list.filter(x=>x.user_id!==me.id), next]);
    await supabase.from("bonus_predictions").upsert({
      user_id:me.id, yn:next.yn||{}, teams:next.teams||[], picks:next.picks||{},
      updated_at:new Date().toISOString(),
    });
  }

  async function acceptTerms(){
    setNeedsTerms(false);
    await supabase.from("profiles").update({ accepted_terms:true }).eq("id", me.id);
  }

  const leaderboard = useMemo(()=>{
    const byUser={}; allPreds.forEach(p=>{ (byUser[p.user_id] ||= {})[p.match_id]=p; });
    const bonusByUser={}; allBonus.forEach(b=>{ bonusByUser[b.user_id]=b; });
    return profiles.map(u=>{
      let matchPts=0, exact=0;
      matches.forEach(m=>{
        const p=byUser[u.id]?.[m.id];
        const mult=doubleStages[m.stage]?2:1;
        // Knockout matches with no teams yet (TBA) don't count for anyone.
        if(isKnockout(m.stage) && !teamsSet(m)) return;
        const sc=scorePrediction(p?.pred_home, p?.pred_away, m.result_home, m.result_away, rules);
        if(sc==null) return; matchPts+=sc*mult;
        if(sc===rules.exact_pts) exact++;
      });
      const bonus=scoreBonus(bonusByUser[u.id], bonusAnswers, bonusRules);
      const predicted=matches.filter(m=>{ const p=byUser[u.id]?.[m.id]; if(!p) return false;
        if(isKnockout(m.stage) && !teamsSet(m)) return false;
        return p.pred_home!=null&&p.pred_away!=null; }).length;
      return { ...u, pts:matchPts+bonus, matchPts, bonus, exact, predicted };
    }).sort((a,b)=>b.pts-a.pts || b.exact-a.exact);
  }, [profiles, allPreds, allBonus, bonusAnswers, bonusRules, matches, rules, doubleStages]);

  // ───────── Player Awards (kun lesing av eksisterende data) ─────────
  const awards = useMemo(()=>{
    if(!profiles.length) return null;
    const byUser={}; allPreds.forEach(p=>{ (byUser[p.user_id] ||= {})[p.match_id]=p; });
    // kamper med resultat, ikke TBA-sluttspill, i kampnummer-rekkefølge
    const playedAsc=[...matches]
      .filter(m=>m.result_home!=null && m.result_away!=null)
      .filter(m=>!(isKnockout(m.stage) && !teamsSet(m)))
      .sort((a,b)=>a.match_no-b.match_no);

    // Per kamp: hvor mange tippet, og hvor mange traff (1 p+) — for Flaksloddet og Lårskyteren
    const tippersPerMatch={}, hittersPerMatch={};
    playedAsc.forEach(m=>{
      let tip=0, hit=0;
      profiles.forEach(u=>{
        const p=byUser[u.id]?.[m.id];
        if(p && p.pred_home!=null && p.pred_away!=null){
          tip++;
          const sc=scorePrediction(p.pred_home,p.pred_away,m.result_home,m.result_away,rules);
          if(sc>0) hit++;
        }
      });
      tippersPerMatch[m.id]=tip; hittersPerMatch[m.id]=hit;
    });

    const stats=profiles.map(u=>{
      let wrong=0, exact=0, notTipped=0, doublePts=0, soloHits=0, soloMiss=0;
      let curWrong=0,maxWrong=0;       // feil på rad
      let curExact=0,maxExact=0;       // eksakte på rad
      let curRight=0,maxRight=0;       // riktige (1 p+) på rad
      playedAsc.forEach(m=>{
        const p=byUser[u.id]?.[m.id];
        const tipped = p && p.pred_home!=null && p.pred_away!=null;
        if(!tipped){                    // IKKE TIPPET → bryter alle rekker
          notTipped++; curWrong=0; curExact=0; curRight=0; return;
        }
        const sc=scorePrediction(p.pred_home, p.pred_away, m.result_home, m.result_away, rules);
        const mult=doubleStages[m.stage]?2:1;
        if(mult>1) doublePts+=sc*mult;                 // poeng kun fra doble runder
        if(sc>0 && hittersPerMatch[m.id]===1) soloHits++; // eneste som traff
        // Lårskyting: du bommet (0 p), men alle ANDRE som tippet traff (minst 2 tippere totalt)
        if(sc===0 && tippersPerMatch[m.id]>=2 && hittersPerMatch[m.id]===tippersPerMatch[m.id]-1) soloMiss++;
        if(sc===rules.exact_pts){ exact++; curExact++; maxExact=Math.max(maxExact,curExact); }
        else { curExact=0; }
        if(sc>0){ curRight++; maxRight=Math.max(maxRight,curRight); curWrong=0; }
        else { wrong++; curWrong++; maxWrong=Math.max(maxWrong,curWrong); curRight=0; }
      });
      const lbRow = leaderboard.find(x=>x.id===u.id) || {};
      return { id:u.id, name:u.name, nick:u.nick,
        total:lbRow.pts||0, predicted:lbRow.predicted||0,
        exact, wrong, notTipped, bonus:lbRow.bonus||0, doublePts, soloHits, soloMiss,
        wrongStreak:maxWrong, exactStreak:maxExact, rightStreak:maxRight };
    });

    // Én vinner for en metrikk. Tiebreaker: flest kamper spilt → høyest totalsum.
    // min = laveste verdi som teller (ellers "ikke avgjort ennå").
    function win(metric, min=1){
      const pool=stats.filter(s=>s[metric]>=min);
      if(!pool.length) return null;
      const sorted=[...pool].sort((a,b)=> b[metric]-a[metric] || b.predicted-a.predicted || b.total-a.total);
      const w=sorted[0];
      return { nick:w.nick, name:w.name, value:w[metric] };
    }
    return {
      skarpskytter: win("exact"),
      gullgraver:   win("exactStreak", 2),
      perfeksjonist:win("rightStreak", 2),
      bonusjeger:   win("bonus"),
      dobbeltgjenger:win("doublePts", 1),
      flakslodd:    win("soloHits", 1),
      larskyter:    win("soloMiss", 1),
      skivebom:     win("wrong"),
      orken:        win("wrongStreak", 2),
    };
  }, [profiles, allPreds, matches, rules, leaderboard, doubleStages]);

  async function signOut(){ await supabase.auth.signOut(); }


  async function snapshotRanks(){
    // store current standings so movement arrows compare against pre-result order
    const ranks={}; leaderboard.forEach((r,i)=>{ ranks[r.id]=i+1; });
    setPrevRanks(ranks);
    await supabase.from("rank_snapshot").update({ ranks }).eq("id",1);
  }

  async function deleteUser(u){
    if(!isAdmin || u.id===me.id) return;
    if(!confirm(`Slette ${u.name} (${u.email})? Dette fjerner spilleren og alle tipsene deres permanent.`)) return;
    // remove their data; profile delete cascades predictions/bonus via FK, but delete explicitly to be safe
    await supabase.from("predictions").delete().eq("user_id", u.id);
    await supabase.from("bonus_predictions").delete().eq("user_id", u.id);
    await supabase.from("profiles").delete().eq("id", u.id);
    loadAll();
  }

  async function editUser(u, name, nick){
    if(!isAdmin) return;
    if(!name.trim()){ alert("Navn kan ikke være tomt."); return; }
    const { error } = await supabase.from("profiles").update({ name: name.trim(), nick: nick.trim() || null }).eq("id", u.id);
    if(error){ alert("Kunne ikke lagre: " + error.message + "\n\nHar du kjørt schema.sql på nytt i Supabase?"); return; }
    loadAll();
  }

  if (session===undefined || loading) return <div className="spin">Laster…</div>;
  if (!session) return null;
  const myProf = profiles.find(p=>p.id===me.id);

  return (
    <>
      {needsTerms && <TermsModal onAccept={acceptTerms} />}
      <header className="band">
        <div className="bandinner">
          <div className="kicker">★ Privat tippeliga · VM 2026 ★</div>
          <div style={{fontFamily:"'Archivo'",fontWeight:700,fontSize:"clamp(13px,3.5vw,18px)",letterSpacing:".08em",color:"var(--mut)",marginBottom:2}}>Wiik og Kælle presenterer</div>
          <div className="logo" style={{fontSize:"clamp(30px,8vw,58px)",wordBreak:"break-word"}}><span className="g">PROGNOSESENTERET</span></div>
          <div className="sub">USA · Canada · Mexico — 11. juni–19. juli 2026</div>
          <div className="who">
            <span className="tag">{myProf?.nick || myProf?.name || me.email}</span>
            {isAdmin && <span className="tag gold">ADMIN</span>}
            <button className="btn ghost" onClick={signOut}>Logg ut</button>
          </div>
        </div>
      </header>

      <div className="wrap" style={{paddingTop:4}}>
        <NextMatchStrip matches={matches} onGoToPredict={()=>setTab("predict")} />
        <nav className="nav">
          <button className={tab==="predict"?"on":""} onClick={()=>setTab("predict")}>Mine tips</button>
          <button className={tab==="bonus"?"on":""} onClick={()=>setTab("bonus")}>Bonus</button>
          <button className={tab==="matches"?"on":""} onClick={()=>setTab("matches")}>Kamper</button>
          <button className={tab==="leaderboard"?"on":""} onClick={()=>setTab("leaderboard")}>Tabell</button>
          <button className={tab==="awards"?"on":""} onClick={()=>setTab("awards")}>Prestasjoner</button>
          <button className={tab==="pott"?"on":""} onClick={()=>setTab("pott")}>Pott</button>
          <button className={tab==="regler"?"on":""} onClick={()=>setTab("regler")}>Regler</button>
          {isAdmin && <button className={tab==="admin"?"on":""} onClick={()=>setTab("admin")}>Admin</button>}
        </nav>

        {tab==="predict" && <Predict matches={matches} preds={preds} predictedCount={predictedCount}
          sortMode={sortMode} setSortMode={setSortMode} savePred={savePred} rules={rules}
          isAdmin={isAdmin} allPreds={allPreds} doubleStages={doubleStages} totalPlayers={profiles.length} toggleMatchLock={toggleMatchLock} />}
        {tab==="bonus" && <Bonus matches={matches} bonus={myBonus} answers={bonusAnswers} rules={bonusRules}
          saveBonus={saveBonus} locked={bonusLocked(null, isAdmin)} />}
        {tab==="matches" && <MatchList matches={matches} />}
        {tab==="leaderboard" && <Leaderboard rows={leaderboard} rules={rules} total={matches.length} isAdmin={isAdmin} deleteUser={deleteUser} editUser={editUser} prevRanks={prevRanks} matches={matches} allPreds={allPreds} doubleStages={doubleStages} />}
        {tab==="awards" && <Awards awards={awards} />}
        {tab==="pott" && <PrizePool profiles={profiles} leaderboard={leaderboard} />}
        {tab==="regler" && <Rules rules={rules} bonusRules={bonusRules} />}
        {tab==="admin" && isAdmin && <Admin supabase={supabase} matches={matches} rules={rules} bonusRules={bonusRules}
          profiles={profiles} allPreds={allPreds} leaderboard={leaderboard} bonusAnswers={bonusAnswers}
          doubleStages={doubleStages} reload={loadAll} snapshotRanks={snapshotRanks} />}
      </div>
    </>
  );
}

/* ───────── Terms modal (first login) ───────── */
/* ───────── Kampen nå / neste kamp (stripe) ───────── */
function NextMatchStrip({ matches, onGoToPredict }){
  const [now, setNow] = useState(Date.now());
  useEffect(()=>{ const t=setInterval(()=>setNow(Date.now()), 1000); return ()=>clearInterval(t); }, []);

  const withKo = matches
    .filter(m=>m.match_date && m.match_time && teamsSet(m))
    .map(m=>({ m, ko: kickoffInstant(m.match_date, m.match_time)?.getTime() }))
    .filter(x=>x.ko)
    .sort((a,b)=>a.ko-b.ko);
  if(!withKo.length) return null;

  const live = withKo.find(x=> now>=x.ko && now < x.ko + 2.5*3600*1000 && x.m.result_home==null);
  // startindeks: live-kampen hvis den finnes, ellers første kommende
  let startIdx = live ? withKo.indexOf(live) : withKo.findIndex(x=> x.ko>now);
  if(startIdx<0) return null;
  const picks = withKo.slice(startIdx, startIdx+3);

  function fmtCountdown(ms){
    if(ms<=0) return "nå";
    const s=Math.floor(ms/1000), d=Math.floor(s/86400), h=Math.floor(s%86400/3600), mi=Math.floor(s%3600/60), se=s%60;
    if(d>0) return `${d}d ${h}t`;
    if(h>0) return `${h}t ${mi}m`;
    if(mi>0) return `${mi}m ${se}s`;
    return `${se}s`;
  }

  return (
    <div onClick={onGoToPredict} style={{cursor:"pointer",display:"flex",gap:8,marginBottom:14,alignItems:"stretch"}}>
      {picks.map((p,idx)=>{
        const { m, ko } = p;
        const isLive = idx===0 && !!live;
        const isPrimary = idx===0;
        const koStr = new Date(ko).toLocaleString("no-NO",{timeZone:"Europe/Oslo",weekday:"short",hour:"2-digit",minute:"2-digit"});
        return (
          <div key={m.id} style={{flex:1,minWidth:0,textAlign:"center",borderRadius:14,padding:"12px 8px",
            background:isLive?"linear-gradient(160deg,rgba(255,42,109,.18),rgba(124,92,255,.12))":"var(--panel2)",
            border:`1px solid ${isLive?"var(--magenta)":isPrimary?"var(--teal)":"var(--line)"}`}}>
            <div style={{fontSize:9.5,fontWeight:800,letterSpacing:".04em",textTransform:"uppercase",marginBottom:5,
              color:isLive?"var(--magenta)":isPrimary?"var(--teal)":"var(--mut)"}}>
              {isLive ? "● Nå" : isPrimary ? "Neste" : idx===1 ? "Deretter" : "Så"}
            </div>
            <div style={{fontWeight:700,fontSize:"clamp(11px,3vw,13px)",lineHeight:1.3,marginBottom:5,wordBreak:"break-word"}}>
              <div>{teamFlag(m.home)} {teamNo(m.home)}</div>
              <div style={{margin:"2px 0"}}>{teamFlag(m.away)} {teamNo(m.away)}</div>
            </div>
            {isLive
              ? <div style={{fontSize:11,color:"var(--mut)"}}>Stengt</div>
              : <div style={{fontSize:"clamp(11px,3.2vw,13px)",color:"var(--gold)",fontWeight:800,fontVariantNumeric:"tabular-nums"}}>{fmtCountdown(ko-now)}</div>}
            <div style={{fontSize:9.5,color:"var(--mut)",textTransform:"capitalize",marginTop:2}}>{koStr}</div>
          </div>
        );
      })}
    </div>
  );
}

function TermsModal({ onAccept }){
  const items = [
    "Jeg forstår at deltakelse koster 200 kr, og at jeg kan bli fjernet fra konkurransen dersom betalingen ikke er mottatt av Henrik.",
    "Jeg bekrefter at jeg har lest reglene og er kjent med dem. Det er mitt eget ansvar å overholde frister, følge med på oppdateringer og sørge for at tips leveres i tide.",
    "Jeg forstår at appen er vibecodet med kjærlighet, pils og tvilsomme utviklervalg. Ethvert forsøk på å manipulere, utnytte eller lure systemet medfører umiddelbar diskvalifisering uten refusjon.",
    "Jeg forstår at Henrik har siste ord i alle spørsmål knyttet til bonuspoeng, tolkning av regler og eventuelle gråsoner. Alle avgjørelser er endelige, og VAR kan ikke brukes.",
    "Jeg forstår at Cheese er tilbakestående, men at han må behandles likt som alle andre på tross av sine utfordringer.",
  ];
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(5,4,18,.88)",backdropFilter:"blur(3px)",zIndex:100,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16,overflowY:"auto"}}>
      <div className="card" style={{maxWidth:520,width:"100%",margin:"auto"}}>
        <h2 className="sec" style={{marginBottom:6}}>Før du blir med</h2>
        <p className="note" style={{marginBottom:14}}>Ved å trykke «Jeg godtar» bekrefter jeg følgende:</p>
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:18}}>
          {items.map((t,i)=>(
            <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",fontSize:13.5,lineHeight:1.5}}>
              <span style={{color:"var(--teal)",flexShrink:0,marginTop:1}}>☑️</span><span>{t}</span>
            </div>
          ))}
        </div>
        <button className="btn primary" style={{width:"100%",justifyContent:"center"}} onClick={onAccept}>Jeg godtar</button>
      </div>
    </div>
  );
}

/* ───────── Predict ───────── */
function MatchRow({ m, preds, savePred, rules, isAdmin, teamList, allPreds, doubleStages, toggleMatchLock }){
  const adminLock = isAdmin && toggleMatchLock ? (
    <div style={{textAlign:"center",marginTop:6}}>
      <button onClick={()=>toggleMatchLock(m)}
        style={{padding:"5px 11px",borderRadius:8,fontFamily:"inherit",fontWeight:700,fontSize:11,cursor:"pointer",
          border: m.locked_manual ? "1px solid var(--teal)" : "1px solid var(--line)",
          background: m.locked_manual ? "var(--teal)" : "transparent",
          color: m.locked_manual ? "#04120c" : "var(--mut)"}}>
        {m.locked_manual ? "🔒 Manuelt låst — trykk for å låse opp" : "Lås denne kampen (admin)"}
      </button>
    </div>
  ) : null;
  const p = preds[m.id] || {};
  const ko = isKnockout(m.stage);
  const lk = matchLocked(m, null, isAdmin);
  const meta = `${m.match_date} · ${m.match_time}${lk?"":` · frist ${deadlineLabel(m)}`}`;
  const lock = lk ? <div className="lockpill">🔒 Låst (stengte ved kampstart)</div> : null;
  const dbl = doubleStages?.[m.stage] ? <div className="lockpill" style={{color:"var(--lime)"}}>★ DOBBEL POENG</div> : null;
  const num = v => v===""?null:Math.max(0,Math.min(99,parseInt(v)||0));
  // tip distribution (only once locked, to avoid copying before deadline)
  let dist=null;
  if(lk && allPreds){
    let H=0,D=0,A=0,tot=0;
    allPreds.forEach(pp=>{ if(pp.match_id!==m.id) return; if(pp.pred_home==null||pp.pred_away==null) return; tot++; if(pp.pred_home>pp.pred_away) H++; else if(pp.pred_home<pp.pred_away) A++; else D++; });
    if(tot>0){
      const hn=(m.home&&!/\(|TBD/.test(m.home))?m.home:"Hjemme";
      const an=(m.away&&!/\(|TBD/.test(m.away))?m.away:"Borte";
      dist=<div className="mmeta" style={{marginTop:5}}>{H} tror {teamNo(hn)} · {D} uavgjort · {A} tror {teamNo(an)} <span style={{opacity:.6}}>({tot} tippet)</span></div>;
    }
  }
  // Knockout match whose teams aren't decided yet → show TBA, not tippable.
  if(ko && !teamsSet(m)){
    return (
      <div className="match" style={{gridTemplateColumns:"1fr"}}>
        <div style={{textAlign:"center",fontSize:11,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>{m.stage}</div>
        <div style={{textAlign:"center",fontWeight:800,fontSize:18,letterSpacing:".04em",color:"var(--mut)"}}>TBA</div>
        <div className="mmeta">{m.match_date} · {m.match_time}</div>
        {dbl}
        <div className="mmeta" style={{marginTop:4,opacity:.8}}>Lagene er ikke bestemt ennå</div>
        {adminLock}
      </div>
    );
  }
  const baseSc = scorePrediction(p.pred_home, p.pred_away, m.result_home, m.result_away, rules);
  const dblMult = (doubleStages && doubleStages[m.stage]) ? 2 : 1;
  const sc = baseSc==null ? null : baseSc*dblMult;
  return (
    <div className="match" style={{gridTemplateColumns:"1fr"}}>
      {ko && <div style={{textAlign:"center",fontSize:11,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{m.stage}</div>}
      <div className="matchtop">
        <div className="team r">{teamFlag(m.home)}<br/>{teamNo(m.home)}</div>
        <div className="scoreboxes">
          <input className="sb" inputMode="numeric" disabled={lk} value={p.pred_home??""} onChange={e=>savePred(m.id,{pred_home:num(e.target.value)})}/>
          <span style={{color:"var(--mut)"}}>–</span>
          <input className="sb" inputMode="numeric" disabled={lk} value={p.pred_away??""} onChange={e=>savePred(m.id,{pred_away:num(e.target.value)})}/>
        </div>
        <div className="team">{teamFlag(m.away)}<br/>{teamNo(m.away)}</div>
      </div>
      <div className="mmeta">{meta}</div>
      {dbl}
      {dist}
      {lock}
      {m.result_home!=null && <div className="lockpill">Resultat {m.result_home}–{m.result_away} · {sc} p{dblMult>1 && <span style={{color:"var(--lime)",fontWeight:700}}> ★2×</span>}</div>}
      {adminLock}
    </div>
  );
}

function Predict({ matches, preds, predictedCount, sortMode, setSortMode, savePred, rules, isAdmin, allPreds, doubleStages, totalPlayers, toggleMatchLock }){
  const pct = matches.length?Math.round(predictedCount/matches.length*100):0;
  const teamList = teamsFromMatches(matches);
  let body;
  const rowProps = { preds, savePred, rules, isAdmin, teamList, allPreds, doubleStages, toggleMatchLock };
  if(sortMode==="siste24" || sortMode==="neste24"){
    const now=Date.now(), H=3600*1000;
    const lo = sortMode==="siste24" ? now-24*H : now;
    const hi = sortMode==="siste24" ? now      : now+24*H;
    const within=[...matches].map(m=>({m,ko:kickoffInstant(m.match_date,m.match_time)?.getTime()}))
      .filter(x=>x.ko && x.ko>=lo && x.ko<hi)
      .sort((a,b)=> sortMode==="siste24" ? b.ko-a.ko : a.ko-b.ko)   // siste: nyeste først · neste: tidligst først
      .map(x=>x.m);
    const tekst = sortMode==="siste24" ? "siste 24 timer" : "neste 24 timer";
    body = within.length
      ? within.map(m=><MatchRow key={m.id} m={m} {...rowProps}/>)
      : <div className="card"><div className="empty">Ingen kamper i {tekst}. Bytt sortering for å se andre kamper.</div></div>;
  } else if(sortMode==="gruppe"){
    const grouped=groupByStage(matches);
    body = Object.entries(grouped).map(([stage,ms])=>(
      <div key={stage}><h3 className="sub2">{stage}</h3>{ms.map(m=><MatchRow key={m.id} m={m} {...rowProps}/>)}</div>
    ));
  } else if(sortMode==="dato"){
    const sorted=[...matches].sort((a,b)=>{
      const ka=new Date(`${a.match_date}T${a.match_time||"00:00"}`).getTime();
      const kb=new Date(`${b.match_date}T${b.match_time||"00:00"}`).getTime();
      return (ka||Infinity)-(kb||Infinity);
    });
    body = sorted.map(m=><MatchRow key={m.id} m={m} {...rowProps}/>);
  } else {
    const sorted=[...matches].sort((a,b)=>{
      const ka=[a.home,a.away].map(x=>(x||"").toLowerCase()).sort()[0];
      const kb=[b.home,b.away].map(x=>(x||"").toLowerCase()).sort()[0];
      return ka.localeCompare(kb);
    });
    body = sorted.map(m=><MatchRow key={m.id} m={m} {...rowProps}/>);
  }
  return (
    <div>
      <div className="card" style={{marginBottom:16}}>
        <div className="between" style={{marginBottom:10}}>
          <strong style={{fontSize:16}}>{predictedCount} av {matches.length} kamper tippet</strong>
          <span className="tag">Lagres automatisk</span>
        </div>
        <div className="progress"><i style={{width:pct+"%"}}/></div>
        <p className="note" style={{marginTop:12}}>Tipsene lagres mens du skriver. Hver kamp låses automatisk ved kampstart (norsk tid) — du kan endre alle andre kamper helt til da.</p>
        <div className="row" style={{marginTop:12,alignItems:"center"}}>
          <span className="note" style={{fontWeight:600}}>Sorter etter:</span>
          <select className="inp" style={{flex:"0 0 auto",width:"auto"}} value={sortMode} onChange={e=>setSortMode(e.target.value)}>
            <option value="siste24">Siste 24 timer</option>
            <option value="neste24">Neste 24 timer</option>
            <option value="gruppe">Gruppe (A→L)</option>
            <option value="dato">Dato (tidligst først)</option>
            <option value="land">Land (alfabetisk)</option>
          </select>
        </div>
      </div>
      {body}
    </div>
  );
}

/* ───────── Bonus ───────── */
function Bonus({ matches, bonus, answers, rules, saveBonus, locked }){
  const b = bonus || { yn:{}, teams:[], picks:{} };
  const yn=b.yn||{}, teams=b.teams||[], picks=b.picks||{};
  const teamList=teamsFromMatches(matches);
  const ans=answers||{yn:{},picks:{}};
  const ynBtn=(on)=>({padding:"8px 16px",borderRadius:9,fontFamily:"inherit",cursor:locked?"default":"pointer",fontSize:14,
    border:on?"1px solid var(--teal)":"1px solid var(--line)",background:on?"var(--teal)":"var(--panel2)",color:on?"#04120c":"var(--ink)",fontWeight:on?800:600});
  const setYn=(i,v)=>{ if(!locked) saveBonus({...b,yn:{...yn,[i]:v}}); };
  const setTeam=(i,v)=>{ if(!locked){ const t=[...teams]; t[i]=v; saveBonus({...b,teams:t}); } };
  const setPick=(k,v)=>{ if(!locked) saveBonus({...b,picks:{...picks,[k]:v}}); };

  // Fargelegg en rad når admin har satt fasit. status: "green" | "yellow" | "red" | null
  function rowStyle(status){
    const base={padding:"11px 12px",borderBottom:"1px solid var(--line)",borderRadius:10,marginBottom:6};
    if(status==="green") return {...base,background:"color-mix(in srgb, var(--teal) 14%, transparent)",border:"1px solid var(--teal)"};
    if(status==="yellow")return {...base,background:"color-mix(in srgb, var(--gold) 14%, transparent)",border:"1px solid var(--gold)"};
    if(status==="red")   return {...base,background:"color-mix(in srgb, var(--magenta) 12%, transparent)",border:"1px solid var(--magenta)"};
    return {...base,borderBottom:"1px solid var(--line)"};
  }
  function pill(status,pts){
    if(!status) return null;
    const c = status==="green"?"var(--teal)":status==="yellow"?"var(--gold)":"var(--magenta)";
    const shown = status==="red" ? 0 : pts;   // feil = 0 p uansett
    return <span style={{whiteSpace:"nowrap",flexShrink:0,padding:"3px 10px",borderRadius:999,fontSize:12,fontWeight:800,
      color:c,border:`1px solid ${c}`,background:"color-mix(in srgb, "+c+" 16%, transparent)"}}>{`+${shown} p`}</span>;
  }
  return (
    <div>
      <div className="card" style={{marginBottom:16}}>
        <div className="between"><strong style={{fontSize:16}}>Bonusspørsmål</strong>
          {locked?<span className="tag gold">LÅST</span>:<span className="tag">Lagres automatisk</span>}</div>
        <p className="note" style={{marginTop:8}}>Disse teller med i totalsummen din. {locked?`Fristen (${fmtNO(bonusDeadlineMs())}) er passert — svarene er låst.`:"Kan endres frem til 11. juni kl. 18:00 (norsk tid). Etter det låses alle bonussvar."}</p>
      </div>
      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">JA / NEI</h2>
        <p className="note" style={{marginBottom:14}}>{rules.yn} poeng for hvert riktig svar.</p>
        {YN_QUESTIONS.map((q,i)=>{
          const v=yn[i], corr=ans.yn&&ans.yn[i];
          const status = corr ? (v && v===corr ? "green" : "red") : null;
          // Når fasit finnes: marker spillerens valgte knapp grønn (rett) eller rød (feil)
          function ynBtnResult(side){
            const chosen = v===side;
            const base = ynBtn(chosen);
            if(corr && chosen){
              const c = v===corr ? "var(--teal)" : "var(--magenta)";
              return {...base, border:`2px solid ${c}`, boxShadow:`0 0 0 1px ${c}`};
            }
            // Låst, men fasit ikke satt ennå → tone ned valgt knapp så det er tydelig at det er levert/venter
            if(locked && !corr && chosen){
              return {...base, background:"var(--panel2)", color:"var(--mut)",
                border:"1px dashed var(--line)", opacity:.75, fontWeight:700};
            }
            return base;
          }
          return <div key={i} style={{display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",...rowStyle(status)}}>
            <div style={{flex:1,fontSize:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>{q} {pill(status,rules.yn)}
                {locked && !corr && v && <span style={{fontSize:11,color:"var(--mut)",fontStyle:"italic"}}>· venter på fasit</span>}
              </div>
              {corr && ans.yn_notes && ans.yn_notes[i] && <div className="note" style={{marginTop:5,fontStyle:"italic"}}>Fasit: {ans.yn_notes[i]}</div>}
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button disabled={locked} style={ynBtnResult("ja")} onClick={()=>setYn(i,"ja")}>Ja</button>
              <button disabled={locked} style={ynBtnResult("nei")} onClick={()=>setYn(i,"nei")}>Nei</button>
            </div></div>;
        })}
      </div>
      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Kvalifiserte gjetninger</h2>
        <h3 className="sub2">VMs topplasseringer</h3>
        <p className="note" style={{marginBottom:12}}>{rules.intop8} poeng for hvert lag som havner på topp 8, +{rules.exactpos} poeng for riktig plassering.</p>
        {teamList.length===0 && <p className="note" style={{color:"var(--magenta)",marginBottom:12}}>Ingen lag funnet ennå. Admin må kjøre seed_matches.sql.</p>}
        {Array.from({length:8}).map((_,i)=>{
          const correctTeams=ans.teams||[];
          const cs=correctTeams.map(t=>(t||"").trim().toLowerCase()).filter(Boolean);
          const g=(teams[i]||"").trim().toLowerCase();
          let status=null, pts=0;
          if(cs.length && g){
            const exact = correctTeams[i] && (correctTeams[i]||"").trim().toLowerCase()===g;
            const inTop = cs.includes(g);
            if(exact){ status="green"; pts=rules.intop8+rules.exactpos; }
            else if(inTop){ status="yellow"; pts=rules.intop8; }
            else { status="red"; pts=0; }
          }
          return (
          <div key={i} style={{display:"flex",gap:10,alignItems:"center",...rowStyle(status)}}>
            <span className="rankbadge">{i+1}</span>
            <select className="inp" disabled={locked} style={{flex:1}} value={teams[i]||""} onChange={e=>setTeam(i,e.target.value)}>
              <option value="">— velg lag —</option>{teamList.map(t=><option key={t} value={t}>{teamLabel(t)}</option>)}
            </select>
            {pill(status,pts)}
          </div>
          );
        })}
      </div>
      <div className="card">
        <h3 className="sub2">Velg lag</h3>
        <p className="note" style={{marginBottom:12}}>{rules.guess} poeng for hvert riktig svar.</p>
        {TEAM_PICK_QUESTIONS.map(q=>{
          const val=picks[q.key]||"", corr=ans.picks?.[q.key]||"";
          const status = corr ? (val && corr.trim().toLowerCase()===val.trim().toLowerCase() ? "green":"red") : null;
          return <div className="field" key={q.key} style={status?{...rowStyle(status),marginBottom:10}:{marginBottom:14}}>
            <label style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>{q.label} {pill(status,rules.guess)}</label>
            <select className="inp" disabled={locked} value={val} onChange={e=>setPick(q.key,e.target.value)}>
              <option value="">— velg lag —</option>{teamList.map(t=><option key={t} value={t}>{teamLabel(t)}</option>)}
            </select></div>;
        })}
      </div>
    </div>
  );
}

/* ───────── Match list ───────── */
function MatchList({ matches }){
  const grouped=groupByStage(matches);
  return <div className="card"><h2 className="sec">Alle kamper</h2>
    {Object.entries(grouped).map(([stage,ms])=>(
      <div key={stage}><h3 className="sub2">{stage}</h3>
        {ms.map(m=><div className="match" key={m.id} style={{gridTemplateColumns:"1fr"}}>
          <div className="matchtop">
            <div className="team r">{teamFlag(m.home)}<br/>{teamNo(m.home)}</div>
            <div className="mmeta" style={{whiteSpace:"nowrap"}}>{m.match_date}<br/>{m.match_time}{m.result_home!=null&&<><br/><span style={{color:"var(--gold)",fontWeight:800}}>{m.result_home}–{m.result_away}</span></>}</div>
            <div className="team">{teamFlag(m.away)}<br/>{teamNo(m.away)}</div>
          </div>
        </div>)}
      </div>
    ))}
  </div>;
}

/* ───────── Rules ───────── */
function Rules({ rules, bonusRules }){
  const Row = ({label, value}) => (
    <div className="between" style={{padding:"9px 0",borderBottom:"1px solid var(--line)"}}>
      <span style={{fontSize:14}}>{label}</span><strong style={{whiteSpace:"nowrap",marginLeft:12}}>{value}</strong>
    </div>
  );
  return (
    <div>
      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Slik fungerer det</h2>
        <p className="note" style={{lineHeight:1.65}}>
          Tipp resultatet i alle kampene i VM 2026. Du kan endre tippene dine helt frem til
          hver enkelt kamp starter — da låses den kampen automatisk. Tipsene lagres med en gang
          du skriver dem; ingen innsending er nødvendig. Bonusspørsmål og totalsum teller med i
          kampen om premiepotten.
        </p>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Poeng — alle kamper</h2>
        <p className="note" style={{marginBottom:10}}>Samme poeng i gruppespill og sluttspill.</p>
        <Row label="Riktig resultat (eksakt)" value={`${rules.exact_pts} p`} />
        <Row label="Riktig utfall (seier/uavgjort/tap)" value={`${rules.outcome_pts} p`} />
        <Row label="Feil" value={`${rules.wrong_pts} p`} />
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Sluttspill</h2>
        <p className="note" style={{lineHeight:1.6}}>Sluttspillkampene vises som <strong>TBA</strong> til lagene er avgjort. Når admin legger inn lagene, blir kampen tippbar akkurat som en gruppekamp — du tipper resultatet og får poeng på samme måte. Tips gjelder resultatet etter ordinær tid (90 min).</p>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Bonus</h2>
        <Row label="Ja/Nei-spørsmål (per rett)" value={`${bonusRules.yn} p`} />
        <Row label="Individuell pris (per rett)" value={`${bonusRules.guess} p`} />
        <Row label="Lag på topp 8 (per lag)" value={`${bonusRules.intop8} p`} />
        <Row label="Riktig plassering (ekstra)" value={`${bonusRules.exactpos} p`} />
        <p className="note" style={{marginTop:10}}>Alle bonussvar låses 11. juni kl. 18:00 (norsk tid).</p>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Frister & låsing</h2>
        <Row label="Kamptips låses" value="Ved kampstart" />
        <Row label="Bonus låses" value="11. juni 18:00" />
        <p className="note" style={{marginTop:10}}>Alle tider er norsk tid. Etter at en kamp har startet kan den ikke endres.</p>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Doble runder</h2>
        <p className="note">Enkelte runder kan markeres med ★ <strong style={{color:"var(--lime)"}}>dobbel poeng</strong> av admin. Da teller alle kamp-poeng i den runden dobbelt (bonus dobles ikke). Det vises tydelig på hver kamp.</p>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Premiepott</h2>
        <p className="note" style={{marginBottom:8}}>Hver spiller betaler 200 kr. Hele potten deles ut til topp 3:</p>
        <Row label="1. plass" value="70 %" />
        <Row label="2. plass" value="20 %" />
        <Row label="3. plass" value="10 %" />
      </div>

      <div className="card">
        <h2 className="sec">Rangering ved poenglikhet</h2>
        <p className="note">Står to spillere likt på totalpoeng, rangeres den med flest <strong>eksakte</strong> resultater øverst.</p>
      </div>
    </div>
  );
}

/* ───────── Prize pool ───────── */
/* ───────── Player Awards (Spillerprestasjoner) ───────── */
function Awards({ awards }){
  const defs=[
    {key:"skarpskytter", emoji:"🎯", title:"Skarpskytteren",  desc:"Har truffet flest eksakte resultater",        unit:"eksakte", accent:"var(--teal)"},
    {key:"gullgraver",   emoji:"⛏️", title:"Gullgraveren",     desc:"Flest eksakte resultater på rad",             unit:"på rad",  accent:"var(--gold)"},
    {key:"perfeksjonist",emoji:"💎", title:"Perfeksjonisten",  desc:"Lengst rekke uten en eneste bom (1 p+)",      unit:"på rad",  accent:"var(--teal)"},
    {key:"bonusjeger",   emoji:"🧠", title:"Bonusjegeren",     desc:"Har sanket flest poeng på bonusspørsmålene",  unit:"bonus-p", accent:"var(--violet)"},
    {key:"dobbeltgjenger",emoji:"⚡", title:"Dobbeltgjengeren", desc:"Mest poeng hentet i doble runder",            unit:"poeng",   accent:"var(--lime)"},
    {key:"flakslodd",    emoji:"🍀", title:"Flaksloddet",       desc:"Flest treff ingen andre klarte",              unit:"treff",   accent:"var(--lime)"},
    {key:"larskyter",    emoji:"🦵", title:"Lårskyteren",        desc:"Bommet når alle andre traff",                 unit:"bom",     accent:"var(--magenta)"},
    {key:"skivebom",     emoji:"🧱", title:"Skivebommern",     desc:"Har bommet flest ganger (0 poeng)",           unit:"bom",     accent:"var(--magenta)"},
    {key:"orken",        emoji:"🏜️", title:"Ørkenvandreren",   desc:"Lengst rekke med bom på rad",                 unit:"på rad",  accent:"var(--magenta)"},
  ];
  return <div className="card"><h2 className="sec">Spillerprestasjoner</h2>
    <p className="note" style={{marginBottom:16}}>Den som leder hver kategori akkurat nå. Oppdateres automatisk. Ved lik verdi vinner den med flest kamper spilt, deretter høyest på tabellen.</p>
    {!awards ? <div className="empty">Ingen data ennå.</div> :
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {defs.map(d=>{ const w=awards[d.key]; return <AwardCard key={d.key} def={d} w={w}/>; })}
    </div>}
  </div>;
}

function AwardCard({ def:d, w }){
  return (
    <div style={{position:"relative",borderRadius:18,padding:"22px 18px 20px",textAlign:"center",overflow:"hidden",
      background:"radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, "+d.accent+" 10%, var(--panel2)) 0%, var(--panel2) 70%)",
      border:"1px solid var(--line)"}}>
      {/* Leder nå-merkelapp */}
      {w && <div style={{position:"absolute",top:12,right:12,display:"flex",alignItems:"center",gap:5,
        fontSize:10.5,fontWeight:800,letterSpacing:".04em",textTransform:"uppercase",color:d.accent,
        background:"color-mix(in srgb, "+d.accent+" 14%, transparent)",border:"1px solid "+d.accent,
        borderRadius:999,padding:"3px 9px"}}>
        <span style={{width:6,height:6,borderRadius:999,background:d.accent,display:"inline-block"}}></span>Leder nå
      </div>}

      {/* Ikon i glødende sirkel */}
      <div style={{width:64,height:64,margin:"4px auto 12px",borderRadius:999,display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:32,background:"var(--panel)",border:"2px solid "+d.accent,
        boxShadow:"0 0 22px color-mix(in srgb, "+d.accent+" 45%, transparent)"}}>{d.emoji}</div>

      {/* Tittel med streker på sidene */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:10}}>
        <span style={{height:1,width:28,background:"var(--line)"}}></span>
        <span style={{fontSize:12,fontWeight:800,letterSpacing:".14em",textTransform:"uppercase",color:"var(--mut)"}}>{d.title}</span>
        <span style={{height:1,width:28,background:"var(--line)"}}></span>
      </div>

      {w ? <>
        {/* Navn */}
        <div style={{fontSize:"clamp(22px,6vw,30px)",fontWeight:800,lineHeight:1.1,wordBreak:"break-word"}}>{w.nick||w.name}</div>
        {w.nick && w.name && <div className="note" style={{fontSize:13,marginTop:2}}>{w.name}</div>}
        {/* Beskrivelse */}
        <div className="note" style={{fontSize:13,margin:"10px auto 14px",maxWidth:300,lineHeight:1.4}}>{d.desc}</div>
        {/* Verdi-pille */}
        <div style={{display:"inline-block",borderRadius:999,padding:"7px 18px",fontWeight:800,fontSize:13,letterSpacing:".03em",
          color:d.accent,border:"1px solid "+d.accent,background:"color-mix(in srgb, "+d.accent+" 12%, transparent)"}}>
          {w.value} {d.unit.toUpperCase()}
        </div>
      </> : <>
        <div className="note" style={{fontSize:13,margin:"6px auto 4px",maxWidth:300,lineHeight:1.4}}>{d.desc}</div>
        <div className="note" style={{fontSize:13,marginTop:8,fontStyle:"italic"}}>Ikke avgjort ennå</div>
      </>}
    </div>
  );
}

function PrizePool({ profiles, leaderboard }){
  const paid = profiles.filter(p=>p.paid || isAdminEmail(p.email));
  const pot = paid.length*200;
  const splits = [
    { pct:70, label:"1. plass", color:"var(--gold)" },
    { pct:20, label:"2. plass", color:"#cdd3ea" },
    { pct:10, label:"3. plass", color:"#e08a4a" },
  ];
  const fmt = n => n.toLocaleString("no-NO");
  const top3 = leaderboard.slice(0,3);
  return (
    <div>
      <div className="card" style={{marginBottom:16, textAlign:"center"}}>
        <h2 className="sec" style={{justifyContent:"center"}}>Premiepott</h2>
        <div style={{fontFamily:"'Anton',sans-serif",fontSize:"clamp(40px,12vw,68px)",lineHeight:1,
          background:"var(--grad)",WebkitBackgroundClip:"text",backgroundClip:"text",color:"transparent",margin:"6px 0"}}>
          {fmt(pot)} kr
        </div>
        <p className="note">{paid.length} betalende spillere × 200 kr</p>
      </div>

      <div className="card">
        <h3 className="sub2">Fordeling</h3>
        {splits.map((s,i)=>{
          const amount = Math.round(pot*s.pct/100);
          const winner = top3[i];
          return (
            <div key={i} style={{marginBottom:16}}>
              <div className="between" style={{marginBottom:6}}>
                <strong style={{fontSize:15}}><span style={{color:s.color}}>●</span> {s.label} <span className="note">({s.pct}%)</span></strong>
                <strong style={{fontSize:16}}>{fmt(amount)} kr</strong>
              </div>
              <div style={{height:14,background:"#0c0a22",border:"1px solid var(--line)",borderRadius:999,overflow:"hidden"}}>
                <div style={{height:"100%",width:s.pct+"%",background:s.color,opacity:.85}}/>
              </div>
              {winner && <div className="note" style={{marginTop:6}}>Leder nå: <strong>{winner.nick||winner.name}</strong> ({winner.pts} p)</div>}
            </div>
          );
        })}
        <p className="note" style={{marginTop:8}}>Potten oppdateres automatisk når flere bekrefter innskuddet sitt. Vinnerne kåres etter siste kamp.</p>
      </div>
    </div>
  );
}

/* ───────── Leaderboard ───────── */
function Leaderboard({ rows, rules, total, isAdmin, deleteUser, editUser, prevRanks, matches, allPreds, doubleStages }){
  const [editId, setEditId] = useState(null);
  const [openId, setOpenId] = useState(null);   // hvilken spiller er ekspandert
  const [eName, setEName] = useState("");
  const [eNick, setENick] = useState("");
  function startEdit(r){ setEditId(r.id); setEName(r.name||""); setENick(r.nick||""); }
  async function saveEdit(r){ await editUser(r, eName, eNick); setEditId(null); }
  const ds = doubleStages || {};
  const colCount = isAdmin ? 9 : 8;

  // Bygg poengoppdeling for én spiller: kun kamper som har resultat
  function breakdown(userId){
    const mine = (allPreds||[]).filter(p=>p.user_id===userId);
    const byMatch = {}; mine.forEach(p=>{ byMatch[p.match_id]=p; });
    const played = (matches||[])
      .filter(m=>m.result_home!=null && m.result_away!=null)
      .filter(m=>!(isKnockout(m.stage) && !teamsSet(m)))
      .sort((a,b)=>b.match_no-a.match_no);   // nyeste først
    return played.map(m=>{
      const p=byMatch[m.id];
      const mult=ds[m.stage]?2:1;
      const base=scorePrediction(p?.pred_home, p?.pred_away, m.result_home, m.result_away, rules);
      const pts=(base||0)*mult;
      let kind="feil";
      if(base===rules.exact_pts) kind="eksakt";
      else if(base===rules.outcome_pts) kind="utfall";
      if(!p || p.pred_home==null) kind="ikke tippet";
      return { m, pred:p, pts, kind, doubled:mult>1 };
    });
  }

  function mv(email, cur){
    const prev = prevRanks?.[email];
    if(prev==null || prev===cur) return <span style={{color:"var(--mut)",opacity:.5}}>–</span>;
    return prev>cur
      ? <span style={{color:"var(--lime)"}} title={`opp ${prev-cur}`}>▲{prev-cur>1?prev-cur:""}</span>
      : <span style={{color:"var(--magenta)"}} title={`ned ${cur-prev}`}>▼{cur-prev>1?cur-prev:""}</span>;
  }
  const kindColor = k => k==="eksakt"?"var(--teal)":k==="utfall"?"var(--gold)":k==="ikke tippet"?"var(--mut)":"var(--magenta)";

  return <div className="card"><h2 className="sec">Tabell</h2>
    <p className="note" style={{marginBottom:14}}>Riktig resultat {rules.exact_pts} p · riktig utfall {rules.outcome_pts} p · feil {rules.wrong_pts}. Bonus teller med i totalen. Trykk på en spiller for å se poengene deres.{isAdmin?" Som admin kan du redigere eller slette spillere her.":""}</p>
    {rows.length===0?<div className="empty">Ingen spillere ennå.</div>:
    <div className="tablewrap"><table className="lb"><thead><tr><th>#</th><th></th><th>Spiller</th><th className="n tot">Tot</th><th className="n">Tips</th><th className="n">Eksakt</th><th className="n">Bonus</th><th className="n">Tippet</th>{isAdmin&&<th></th>}</tr></thead>
    <tbody>{rows.map((r,i)=>(
      editId===r.id ? (
        <tr key={r.id}>
          <td><span className={`rankbadge ${i===0?"g1":i===1?"g2":i===2?"g3":""}`}>{i+1}</span></td>
          <td className="n" style={{fontSize:12}}>{mv(r.id,i+1)}</td>
          <td colSpan={5}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <input className="inp" style={{flex:1,minWidth:120,padding:"7px 9px",fontSize:13}} value={eNick} placeholder="Kallenavn" onChange={e=>setENick(e.target.value)}/>
              <input className="inp" style={{flex:1,minWidth:120,padding:"7px 9px",fontSize:13}} value={eName} placeholder="Fullt navn" onChange={e=>setEName(e.target.value)}/>
            </div>
          </td>
          <td className="n" style={{whiteSpace:"nowrap"}}>
            <button className="btn primary" style={{padding:"6px 10px",fontSize:12}} onClick={()=>saveEdit(r)}>Lagre</button>
            {" "}
            <button className="btn ghost" style={{padding:"6px 8px",fontSize:12}} onClick={()=>setEditId(null)}>Avbryt</button>
          </td>
        </tr>
      ) : (
      <React.Fragment key={r.id}>
      <tr style={{cursor:"pointer"}} onClick={()=>setOpenId(openId===r.id?null:r.id)}><td><span className={`rankbadge ${i===0?"g1":i===1?"g2":i===2?"g3":""}`}>{i+1}</span></td>
        <td className="n" style={{fontSize:12}}>{mv(r.id,i+1)}</td>
        <td>{openId===r.id?"▾ ":"▸ "}{r.nick||r.name}{r.nick&&<span className="note"> · {r.name}</span>}</td>
        <td className="n tot"><strong>{r.pts}</strong></td><td className="n">{r.matchPts}</td><td className="n">{r.exact}</td><td className="n">{r.bonus}</td>
        <td className="n"><span className="note">{r.predicted}/{total}</span></td>
        {isAdmin&&<td className="n" style={{whiteSpace:"nowrap"}} onClick={e=>e.stopPropagation()}>
          <button className="del" style={{borderColor:"var(--line)",color:"var(--teal)",marginRight:4}} title="Rediger navn" onClick={()=>startEdit(r)}>✎</button>
          {!isAdminEmail(r.email)&&<button className="del" title="Slett spiller" onClick={()=>deleteUser(r)}>✕</button>}
        </td>}</tr>
      {openId===r.id && (
        <tr><td colSpan={colCount} style={{padding:0,background:"rgba(255,255,255,.015)",position:"sticky",left:0}}>
          <div style={{width:"86vw",maxWidth:480,padding:"0 11px 14px"}}>
          {(()=>{ const bd=breakdown(r.id);
            if(!bd.length) return <div className="note" style={{padding:"12px 0"}}>Ingen ferdigspilte kamper ennå.</div>;
            return <div style={{padding:"12px 0",display:"flex",flexDirection:"column",gap:8}}>
              <div className="note" style={{marginBottom:2}}>Kamp-poeng: <strong>{r.matchPts}</strong> · Bonus: <strong>{r.bonus}</strong> · Totalt: <strong style={{color:"var(--ink)"}}>{r.pts}</strong></div>
              <div className="note" style={{fontStyle:"italic",marginBottom:4}}>Viser seneste resultater først{bd.length>10?" — scroll for flere":""}</div>
              <div style={{maxHeight:bd.length>10?360:"none",overflowY:bd.length>10?"auto":"visible",
                WebkitOverflowScrolling:"touch",display:"flex",flexDirection:"column",gap:8,
                paddingRight:bd.length>10?4:0,
                borderTop:bd.length>10?"1px solid var(--line)":"none",borderBottom:bd.length>10?"1px solid var(--line)":"none"}}>
              {bd.map(({m,pred,pts,kind,doubled})=>{
                const label = kind==="eksakt"?"Eksakt":kind==="utfall"?"Riktig utfall":kind==="ikke tippet"?"Ikke tippet":"Feil";
                const col = kindColor(kind);
                return (
                <div key={"m"+m.id} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,borderBottom:"1px solid var(--line)",paddingBottom:7,flexWrap:"wrap"}}>
                  <span style={{minWidth:0,flex:"0 1 auto",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {teamFlag(m.home)} {teamNo(m.home)} {m.result_home}–{m.result_away} {teamNo(m.away)} {teamFlag(m.away)}
                    {doubled && <span style={{color:"var(--lime)",fontWeight:700}}> ★2×</span>}
                  </span>
                  <span style={{whiteSpace:"nowrap",flexShrink:0,padding:"3px 10px",borderRadius:999,fontSize:12,fontWeight:700,
                    color:col,border:`1px solid ${col}`,background:"color-mix(in srgb, "+col+" 12%, transparent)"}}>
                    {label} {kind==="ikke tippet"?"0 p":`+${pts} p`}
                  </span>
                </div>
                );
              })}
              </div>
            </div>;
          })()}
          </div>
        </td></tr>
      )}
      </React.Fragment>
      )
    ))}</tbody></table></div>}
  </div>;
}

/* ───────── Admin ───────── */
function LockToggle({ m, onToggle }){
  const auto = matchLocked(m, null, false); // er den allerede tidslåst?
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginTop:8}}>
      {m.locked_manual
        ? <span style={{fontSize:11,color:"var(--gold)",fontWeight:700}}>🔒 Manuelt låst</span>
        : auto
          ? <span style={{fontSize:11,color:"var(--mut)"}}>Låst automatisk (kampstart passert)</span>
          : <span style={{fontSize:11,color:"var(--mut)"}}>Åpen</span>}
      <button onClick={()=>onToggle(m)}
        style={{padding:"5px 11px",borderRadius:8,fontFamily:"inherit",fontWeight:700,fontSize:12,cursor:"pointer",
          border: m.locked_manual ? "1px solid var(--teal)" : "1px solid var(--line)",
          background: m.locked_manual ? "var(--teal)" : "var(--panel2)",
          color: m.locked_manual ? "#04120c" : "var(--ink)"}}>
        {m.locked_manual ? "Lås opp" : "Lås nå"}
      </button>
    </div>
  );
}

function Admin({ supabase, matches, rules, bonusRules, profiles, allPreds, leaderboard, bonusAnswers, doubleStages, reload, snapshotRanks }){
  const [nm, setNm] = useState({ stage:"Gruppe A", match_date:"", match_time:"", home:"", away:"" });
  const teamList = teamsFromMatches(matches);
  const ba = bonusAnswers || { yn:{}, teams:[] };

  const num = v => v===""?null:Math.max(0,Math.min(99,parseInt(v)||0));
  async function setResult(id,side,val){ await snapshotRanks(); await supabase.from("matches").update({[side==="h"?"result_home":"result_away"]:num(val)}).eq("id",id); reload(); }
  async function toggleDouble(stage){
    const next={...(doubleStages||{})};
    if(next[stage]) delete next[stage]; else next[stage]=true;
    await supabase.from("double_stages").update({ stages: next }).eq("id",1); reload();
  }
  async function setKoTeam(id,field,val){ await supabase.from("matches").update({[field]:val}).eq("id",id); reload(); }
  async function toggleLock(m){ await supabase.from("matches").update({ locked_manual: !m.locked_manual }).eq("id", m.id); reload(); }
  // Vis valgt lag for én side hvis det er et ekte lag (ikke placeholder som "R16 M1 (borte)")
  const sideTeam = name => (name && !/\(|TBD|TBA/i.test(name)) ? name : "";
  async function editMatch(id,field,val){ await supabase.from("matches").update({[field]:val}).eq("id",id); reload(); }
  async function delMatch(id){ if(confirm("Slette denne kampen?")){ await supabase.from("matches").delete().eq("id",id); reload(); } }
  async function addMatch(){ if(!nm.home||!nm.away){alert("Lag er påkrevd.");return;} const n=Math.max(0,...matches.map(m=>m.match_no))+1; await supabase.from("matches").insert({match_no:n,...nm}); setNm({stage:nm.stage,match_date:"",match_time:"",home:"",away:""}); reload(); }
  async function setRule(k,v){ await supabase.from("scoring_rules").update({[k]:parseInt(v)||0}).eq("id",1); reload(); }
  async function setBRule(k,v){ await supabase.from("bonus_rules").update({[k]:parseInt(v)||0}).eq("id",1); reload(); }
  async function setBaYn(i,v){ await supabase.from("bonus_answers").update({yn:{...(ba.yn||{}),[i]:v}}).eq("id",1); reload(); }
  async function setBaTeam(i,v){ const t=[...(ba.teams||[])]; t[i]=v; await supabase.from("bonus_answers").update({teams:t}).eq("id",1); reload(); }
  async function setBaPick(k,v){ await supabase.from("bonus_answers").update({picks:{...(ba.picks||{}),[k]:v}}).eq("id",1); reload(); }
  async function setBaNote(i,v){ await supabase.from("bonus_answers").update({yn_notes:{...(ba.yn_notes||{}),[i]:v}}).eq("id",1); reload(); }

  function exportCSV(){
    const byUser={}; allPreds.forEach(p=>{ (byUser[p.user_id]||={})[p.match_id]=p; });
    const lb=Object.fromEntries(leaderboard.map(r=>[r.id,r]));
    const head=["Spiller","E-post","Kallenavn",...matches.map(m=>`${m.home} v ${m.away}`),"Kamp-poeng","Bonus","Total","Eksakt","Tippet"];
    const rows=profiles.map(u=>{
      const cells=matches.map(m=>{ const p=byUser[u.id]?.[m.id]; if(!p) return "";
        return (p.pred_home!=null)?`${p.pred_home}-${p.pred_away}`:""; });
      const s=lb[u.id]||{};
      return [u.name,u.email,u.nick||"",...cells,s.matchPts||0,s.bonus||0,s.pts||0,s.exact||0,`${s.predicted||0}/${matches.length}`];
    });
    const csv=[head,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="kaelles-tips.csv"; a.click();
  }

  const byUser={}; allPreds.forEach(p=>{ (byUser[p.user_id]||={})[p.match_id]=p; });

  return (
    <div>
      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Poengregler — kamper</h2>
        <p className="note" style={{marginBottom:10}}>Gjelder alle kamper — gruppespill og sluttspill bruker samme poeng.</p>
        <div className="row">{[["exact_pts","Riktig resultat"],["outcome_pts","Riktig utfall"],["wrong_pts","Feil"]].map(([k,l])=>(
          <div className="field" key={k} style={{flex:1,minWidth:120,marginBottom:0}}><label>{l}</label>
            <input className="inp" inputMode="numeric" defaultValue={rules[k]} onBlur={e=>setRule(k,e.target.value)}/></div>
        ))}</div>
      </div>
      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Poengregler — bonus</h2>
        <div className="row">{[["yn","Ja/Nei"],["guess","Individuell pris"],["intop8","Lag på topp 8"],["exactpos","Riktig plassering"]].map(([k,l])=>(
          <div className="field" key={k} style={{flex:1,minWidth:130,marginBottom:0}}><label>{l}</label>
            <input className="inp" inputMode="numeric" defaultValue={bonusRules[k]} onBlur={e=>setBRule(k,e.target.value)}/></div>
        ))}</div>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Doble runder</h2>
        <p className="note" style={{marginBottom:12}}>Marker runder som gir <strong style={{color:"var(--lime)"}}>dobbel poeng</strong> (gjelder alle kamper i runden).</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {[...new Set(matches.map(m=>m.stage))].sort((a,b)=>{
            const ia=STAGE_ORDER.indexOf(a), ib=STAGE_ORDER.indexOf(b);
            return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);
          }).map(s=>{ const on=!!(doubleStages||{})[s];
            return <button key={s} onClick={()=>toggleDouble(s)} style={{padding:"8px 13px",borderRadius:9,fontFamily:"inherit",fontWeight:700,fontSize:13,cursor:"pointer",
              border:on?"1px solid var(--lime)":"1px solid var(--line)",background:on?"var(--lime)":"var(--panel2)",color:on?"#1a2400":"var(--ink)"}}>{on?"★ ":""}{s}</button>;
          })}
        </div>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <div className="between"><h2 className="sec" style={{margin:0}}>Legg inn resultater</h2><button className="btn" onClick={exportCSV}>Eksporter CSV</button></div>
        <p className="note" style={{margin:"6px 0 14px"}}>Tomt = ikke spilt. For sluttspill: velg lagene som faktisk gikk videre — da blir kampen tippbar for spillerne (vises som TBA inntil da). Sluttspill-tips gjelder resultat etter ordinær tid (90 min). <strong>Lås nå</strong> er en nødbryter — bruk den bare hvis en kamp ikke låses automatisk.</p>
        {matches.map(m=> isKnockout(m.stage) ? (
          <div className="match" key={m.id} style={{gridTemplateColumns:"1fr"}}>
            <div style={{textAlign:"center",fontSize:11,color:"var(--mut)",textTransform:"uppercase",marginBottom:4}}>{m.stage} · {m.match_date}</div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
              <select className="inp" style={{flex:1,minWidth:110}} value={sideTeam(m.home)} onChange={e=>setKoTeam(m.id,"home",e.target.value)}><option value="">— lag —</option>{teamList.map(t=><option key={t} value={t}>{teamLabel(t)}</option>)}</select>
              <div className="scoreboxes">
                <input className="sb" inputMode="numeric" defaultValue={m.result_home??""} onBlur={e=>setResult(m.id,"h",e.target.value)}/>
                <span style={{color:"var(--mut)"}}>–</span>
                <input className="sb" inputMode="numeric" defaultValue={m.result_away??""} onBlur={e=>setResult(m.id,"a",e.target.value)}/>
              </div>
              <select className="inp" style={{flex:1,minWidth:110}} value={sideTeam(m.away)} onChange={e=>setKoTeam(m.id,"away",e.target.value)}><option value="">— lag —</option>{teamList.map(t=><option key={t} value={t}>{teamLabel(t)}</option>)}</select>
            </div>
            <LockToggle m={m} onToggle={toggleLock} />
          </div>
        ) : (
          <div className="match" key={m.id} style={{gridTemplateColumns:"1fr"}}>
            <div className="matchtop">
              <div className="team r">{teamFlag(m.home)}<br/>{teamNo(m.home)}</div>
              <div className="scoreboxes">
                <input className="sb" inputMode="numeric" defaultValue={m.result_home??""} onBlur={e=>setResult(m.id,"h",e.target.value)}/>
                <span style={{color:"var(--mut)"}}>–</span>
                <input className="sb" inputMode="numeric" defaultValue={m.result_away??""} onBlur={e=>setResult(m.id,"a",e.target.value)}/>
              </div>
              <div className="team">{teamFlag(m.away)}<br/>{teamNo(m.away)}</div>
            </div>
            <LockToggle m={m} onToggle={toggleLock} />
          </div>
        ))}
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Fasit — bonus</h2>
        <p className="note" style={{marginBottom:12}}>Sett riktige svar. Tabellen oppdateres umiddelbart.</p>
        <h3 className="sub2">JA / NEI</h3>
        {YN_QUESTIONS.map((q,i)=>{ const v=(ba.yn||{})[i]||""; const note=(ba.yn_notes||{})[i]||"";
          const btn=(on)=>({padding:"8px 14px",borderRadius:9,fontFamily:"inherit",cursor:"pointer",fontSize:13,border:on?"1px solid var(--teal)":"1px solid var(--line)",background:on?"var(--teal)":"var(--panel2)",color:on?"#04120c":"var(--ink)",fontWeight:on?800:600});
          return <div key={i} style={{padding:"11px 0",borderBottom:"1px solid var(--line)"}}>
            <div style={{display:"flex",gap:12,alignItems:"center",justifyContent:"space-between"}}>
              <div style={{flex:1,fontSize:13.5}}>{q}</div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button style={btn(v==="ja")} onClick={()=>setBaYn(i,"ja")}>Ja</button>
                <button style={btn(v==="nei")} onClick={()=>setBaYn(i,"nei")}>Nei</button>
                <button style={{...btn(false),opacity:.6}} onClick={()=>setBaYn(i,"")}>Tøm</button>
              </div>
            </div>
            <input className="inp" style={{marginTop:8,width:"100%",fontSize:13}} defaultValue={note}
              placeholder="Begrunnelse (valgfri) — vises for spillerne, f.eks. «Tom Cruise filmet i åpningskampen»"
              onBlur={e=>{ if(e.target.value!==note) setBaNote(i,e.target.value); }}/>
          </div>;
        })}
        <h3 className="sub2">VMs topplasseringer (fasit)</h3>
        {Array.from({length:8}).map((_,i)=>(
          <div key={i} style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
            <span className="rankbadge">{i+1}</span>
            <select className="inp" style={{flex:1}} value={(ba.teams||[])[i]||""} onChange={e=>setBaTeam(i,e.target.value)}><option value="">— velg lag —</option>{teamList.map(t=><option key={t} value={t}>{teamLabel(t)}</option>)}</select>
          </div>
        ))}
        <h3 className="sub2">Velg lag (fasit)</h3>
        {TEAM_PICK_QUESTIONS.map(q=>(
          <div className="field" key={q.key}><label>{q.label}</label>
            <select className="inp" value={(ba.picks||{})[q.key]||""} onChange={e=>setBaPick(q.key,e.target.value)}>
              <option value="">— velg lag —</option>{teamList.map(t=><option key={t} value={t}>{teamLabel(t)}</option>)}
            </select></div>
        ))}
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Administrer kamper</h2>
        <div className="adminmatch">
          <input className="inp" placeholder="Runde" value={nm.stage} onChange={e=>setNm({...nm,stage:e.target.value})}/>
          <input className="inp" type="date" value={nm.match_date} onChange={e=>setNm({...nm,match_date:e.target.value})}/>
          <input className="inp" type="time" value={nm.match_time} onChange={e=>setNm({...nm,match_time:e.target.value})}/>
          <input className="inp" placeholder="Hjemme" value={nm.home} onChange={e=>setNm({...nm,home:e.target.value})}/>
          <input className="inp" placeholder="Borte" value={nm.away} onChange={e=>setNm({...nm,away:e.target.value})}/>
          <button className="btn primary" onClick={addMatch}>Legg til</button>
        </div>
        <h3 className="sub2">Eksisterende ({matches.length})</h3>
        {matches.map(m=>(
          <div className="adminmatch" key={m.id}>
            <input className="inp" defaultValue={m.stage} onBlur={e=>editMatch(m.id,"stage",e.target.value)}/>
            <input className="inp" type="date" defaultValue={m.match_date||""} onBlur={e=>editMatch(m.id,"match_date",e.target.value)}/>
            <input className="inp" type="time" defaultValue={m.match_time||""} onBlur={e=>editMatch(m.id,"match_time",e.target.value)}/>
            <input className="inp" defaultValue={m.home} onBlur={e=>editMatch(m.id,"home",e.target.value)}/>
            <input className="inp" defaultValue={m.away} onBlur={e=>editMatch(m.id,"away",e.target.value)}/>
            <button className="del" onClick={()=>delMatch(m.id)}>✕</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="sec">Spillere ({profiles.length})</h2>
        {profiles.length===0?<div className="empty">Ingen spillere ennå.</div>:profiles.map(u=>{
          const lbr=leaderboard.find(r=>r.id===u.id)||{};
          return <div className="card" key={u.id} style={{background:"var(--panel2)",marginBottom:10}}>
            <div><strong>{u.name}</strong> <span className="note">· {u.email}{u.nick?` · ${u.nick}`:""}</span>
              {!isAdminEmail(u.email) && (u.paid?<span className="tag" style={{color:"var(--teal)",borderColor:"#0c4a36",marginLeft:6}}>200 NOK ✓</span>:<span className="tag" style={{color:"var(--magenta)",borderColor:"#5a2418",marginLeft:6}}>IKKE BETALT</span>)}
              <div className="note">{lbr.predicted||0}/{matches.length} tippet · {lbr.pts||0} p</div>
            </div></div>;
        })}
      </div>
    </div>
  );
}
