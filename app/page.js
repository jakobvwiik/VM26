"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase";
import { ADMIN_EMAIL } from "../lib/config";
import {
  scorePrediction, scoreKnockout, groupByStage, isKnockout, teamsFromMatches,
  scoreBonus, YN_QUESTIONS, GUESS_FIELDS, DEFAULT_BONUS_RULES,
  MATCH_LOCK_HOURS, matchLocked, bonusLocked, bonusDeadlineMs, fmtNO, deadlineLabel, noLocalToMs,
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
  const [bonusAnswers, setBonusAnswers] = useState({ yn:{}, teams:[], top_scorer:"", top_assist:"", top_keeper:"" });
  const [bonusRules, setBonusRules] = useState({ ...DEFAULT_BONUS_RULES });
  const [tab, setTab] = useState("predict");
  const [sortMode, setSortMode] = useState("gruppe");
  const [loading, setLoading] = useState(true);
  const [simNow, setSimNow] = useState(null); // admin test clock (ms) or null

  const isAdmin = me?.email === ADMIN_EMAIL;
  const nowMs = simNow != null ? simNow : Date.now();

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
    const [m, pr, mine, pf, rl, ab, ba, br] = await Promise.all([
      supabase.from("matches").select("*").order("match_no"),
      supabase.from("predictions").select("*"),
      supabase.from("predictions").select("*").eq("user_id", me.id),
      supabase.from("profiles").select("*"),
      supabase.from("scoring_rules").select("*").eq("id",1).single(),
      supabase.from("bonus_predictions").select("*"),
      supabase.from("bonus_answers").select("*").eq("id",1).single(),
      supabase.from("bonus_rules").select("*").eq("id",1).single(),
    ]);
    setMatches(m.data || []);
    setAllPreds(pr.data || []);
    const mm = {}; (mine.data||[]).forEach(p=>{ mm[p.match_id]=p; }); setPreds(mm);
    setProfiles(pf.data || []);
    if (rl.data) setRules(rl.data);
    setAllBonus(ab.data || []);
    setMyBonus((ab.data||[]).find(x=>x.user_id===me.id) || { user_id:me.id, yn:{}, teams:[], top_scorer:"", top_assist:"", top_keeper:"" });
    if (ba.data) setBonusAnswers({ yn:ba.data.yn||{}, teams:ba.data.teams||[], top_scorer:ba.data.top_scorer||"", top_assist:ba.data.top_assist||"", top_keeper:ba.data.top_keeper||"" });
    if (br.data) setBonusRules(br.data);
    setLoading(false);
  }, [me]);

  useEffect(()=>{ if(me) loadAll(); }, [me, loadAll]);

  useEffect(()=>{
    if(!me) return;
    const ch = supabase.channel("kbb")
      .on("postgres_changes",{event:"*",schema:"public",table:"matches"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"predictions"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"scoring_rules"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"bonus_predictions"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"bonus_answers"},loadAll)
      .on("postgres_changes",{event:"*",schema:"public",table:"bonus_rules"},loadAll)
      .subscribe();
    return ()=>supabase.removeChannel(ch);
  }, [me, loadAll]);

  const predictedCount = useMemo(()=>matches.filter(m=>{
    const p=preds[m.id]; if(!p) return false;
    if(isKnockout(m.stage)) return p.pred_home_team && p.pred_away_team && p.pred_home!=null && p.pred_away!=null;
    return p.pred_home!=null && p.pred_away!=null;
  }).length, [matches, preds]);

  async function savePred(matchId, patch){
    const m = matches.find(x=>x.id===matchId);
    if(matchLocked(m, nowMs, isAdmin)) return;
    const cur = preds[matchId] || { user_id:me.id, match_id:matchId };
    const next = { ...cur, ...patch, user_id:me.id, match_id:matchId };
    setPreds(p=>({ ...p, [matchId]: next }));
    await supabase.from("predictions").upsert({
      user_id:me.id, match_id:matchId,
      pred_home: next.pred_home ?? null, pred_away: next.pred_away ?? null,
      pred_home_team: next.pred_home_team ?? null, pred_away_team: next.pred_away_team ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict:"user_id,match_id" });
  }

  async function saveBonus(next){
    if(bonusLocked(nowMs, isAdmin)) return;
    setMyBonus(next);
    setAllBonus(list=>[...list.filter(x=>x.user_id!==me.id), next]);
    await supabase.from("bonus_predictions").upsert({
      user_id:me.id, yn:next.yn||{}, teams:next.teams||[],
      top_scorer:next.top_scorer||null, top_assist:next.top_assist||null, top_keeper:next.top_keeper||null,
      updated_at:new Date().toISOString(),
    });
  }

  const leaderboard = useMemo(()=>{
    const byUser={}; allPreds.forEach(p=>{ (byUser[p.user_id] ||= {})[p.match_id]=p; });
    const bonusByUser={}; allBonus.forEach(b=>{ bonusByUser[b.user_id]=b; });
    return profiles.map(u=>{
      let matchPts=0, exact=0;
      matches.forEach(m=>{
        const p=byUser[u.id]?.[m.id];
        if(isKnockout(m.stage)){
          const sc=scoreKnockout(m, p, m.result_home, m.result_away);
          if(sc==null) return; matchPts+=sc;
          if(p && p.pred_home!=null && m.result_home!=null && p.pred_home===m.result_home && p.pred_away===m.result_away) exact++;
        } else {
          const sc=scorePrediction(p?.pred_home, p?.pred_away, m.result_home, m.result_away, rules);
          if(sc==null) return; matchPts+=sc;
          if(sc===rules.exact_pts) exact++;
        }
      });
      const bonus=scoreBonus(bonusByUser[u.id], bonusAnswers, bonusRules);
      const predicted=matches.filter(m=>{ const p=byUser[u.id]?.[m.id]; if(!p) return false;
        if(isKnockout(m.stage)) return p.pred_home_team&&p.pred_away_team&&p.pred_home!=null&&p.pred_away!=null;
        return p.pred_home!=null&&p.pred_away!=null; }).length;
      return { ...u, pts:matchPts+bonus, matchPts, bonus, exact, predicted };
    }).sort((a,b)=>b.pts-a.pts || b.exact-a.exact);
  }, [profiles, allPreds, allBonus, bonusAnswers, bonusRules, matches, rules]);

  async function signOut(){ await supabase.auth.signOut(); }

  async function deleteUser(u){
    if(!isAdmin || u.id===me.id) return;
    if(!confirm(`Slette ${u.name} (${u.email})? Dette fjerner spilleren og alle tipsene deres permanent.`)) return;
    // remove their data; profile delete cascades predictions/bonus via FK, but delete explicitly to be safe
    await supabase.from("predictions").delete().eq("user_id", u.id);
    await supabase.from("bonus_predictions").delete().eq("user_id", u.id);
    await supabase.from("profiles").delete().eq("id", u.id);
    loadAll();
  }

  if (session===undefined || loading) return <div className="spin">Laster…</div>;
  if (!session) return null;
  const myProf = profiles.find(p=>p.id===me.id);

  return (
    <>
      <header className="band">
        <div className="bandinner">
          <div className="kicker">★ Privat tippeliga · VM 2026 ★</div>
          <div className="logo">Kælles ball<br/><span className="g">og bong</span></div>
          <div className="sub">USA · Canada · Mexico — 11. juni–19. juli 2026</div>
          <div className="who">
            <span className="tag">{myProf?.nick || myProf?.name || me.email}</span>
            {isAdmin && <span className="tag gold">ADMIN</span>}
            <button className="btn ghost" onClick={signOut}>Logg ut</button>
          </div>
        </div>
      </header>

      <div className="wrap" style={{paddingTop:4}}>
        <nav className="nav">
          <button className={tab==="predict"?"on":""} onClick={()=>setTab("predict")}>Mine tips</button>
          <button className={tab==="bonus"?"on":""} onClick={()=>setTab("bonus")}>Bonus</button>
          <button className={tab==="matches"?"on":""} onClick={()=>setTab("matches")}>Kamper</button>
          <button className={tab==="leaderboard"?"on":""} onClick={()=>setTab("leaderboard")}>Tabell</button>
          {isAdmin && <button className={tab==="admin"?"on":""} onClick={()=>setTab("admin")}>Admin</button>}
        </nav>

        {tab==="predict" && <Predict matches={matches} preds={preds} predictedCount={predictedCount}
          sortMode={sortMode} setSortMode={setSortMode} savePred={savePred} rules={rules}
          nowMs={nowMs} isAdmin={isAdmin} />}
        {tab==="bonus" && <Bonus matches={matches} bonus={myBonus} answers={bonusAnswers} rules={bonusRules}
          saveBonus={saveBonus} locked={bonusLocked(nowMs, isAdmin)} />}
        {tab==="matches" && <MatchList matches={matches} />}
        {tab==="leaderboard" && <Leaderboard rows={leaderboard} rules={rules} total={matches.length} isAdmin={isAdmin} deleteUser={deleteUser} />}
        {tab==="admin" && isAdmin && <Admin supabase={supabase} matches={matches} rules={rules} bonusRules={bonusRules}
          profiles={profiles} allPreds={allPreds} leaderboard={leaderboard} bonusAnswers={bonusAnswers} reload={loadAll} />}
      </div>

      {isAdmin && <TestPanel simNow={simNow} setSimNow={setSimNow} />}
    </>
  );
}

/* ───────── Predict ───────── */
function MatchRow({ m, preds, savePred, rules, nowMs, isAdmin, teamList }){
  const p = preds[m.id] || {};
  const ko = isKnockout(m.stage);
  const lk = matchLocked(m, nowMs, isAdmin);
  const meta = `${m.match_date} · ${m.match_time}${lk?"":` · frist ${deadlineLabel(m)}`}`;
  const lock = lk ? <div className="lockpill">🔒 Låst (stengte {MATCH_LOCK_HOURS} t før kampstart)</div> : null;
  const num = v => v===""?null:Math.max(0,Math.min(99,parseInt(v)||0));
  if(ko){
    const teams = teamList;
    const sc = scoreKnockout(m, p, m.result_home, m.result_away);
    const opt = () => <><option value="">— velg lag —</option>{teams.map(t=><option key={t} value={t}>{t}</option>)}</>;
    return (
      <div className="match" style={{gridTemplateColumns:"1fr"}}>
        <div style={{textAlign:"center",fontSize:11,color:"var(--mut)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>{m.stage}</div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
          <select className="inp" disabled={lk} style={{flex:1,minWidth:120}} value={p.pred_home_team||""} onChange={e=>savePred(m.id,{pred_home_team:e.target.value})}>{opt()}</select>
          <div className="scoreboxes">
            <input className="sb" inputMode="numeric" disabled={lk} value={p.pred_home??""} onChange={e=>savePred(m.id,{pred_home:num(e.target.value)})}/>
            <span style={{color:"var(--mut)"}}>–</span>
            <input className="sb" inputMode="numeric" disabled={lk} value={p.pred_away??""} onChange={e=>savePred(m.id,{pred_away:num(e.target.value)})}/>
          </div>
          <select className="inp" disabled={lk} style={{flex:1,minWidth:120}} value={p.pred_away_team||""} onChange={e=>savePred(m.id,{pred_away_team:e.target.value})}>{opt()}</select>
        </div>
        <div className="mmeta">{meta}</div>
        {lock}
        {sc!=null && <div className="lockpill">{(m.home&&!/\(|TBD/.test(m.home))?`${m.home} ${m.result_home!=null?`${m.result_home}–${m.result_away}`:""} ${m.away} · `:""}{sc} p</div>}
      </div>
    );
  }
  const sc = scorePrediction(p.pred_home, p.pred_away, m.result_home, m.result_away, rules);
  return (
    <div className="match">
      <div className="team r">{m.home}</div>
      <div>
        <div className="scoreboxes">
          <input className="sb" inputMode="numeric" disabled={lk} value={p.pred_home??""} onChange={e=>savePred(m.id,{pred_home:num(e.target.value)})}/>
          <span style={{color:"var(--mut)"}}>–</span>
          <input className="sb" inputMode="numeric" disabled={lk} value={p.pred_away??""} onChange={e=>savePred(m.id,{pred_away:num(e.target.value)})}/>
        </div>
        <div className="mmeta">{meta}</div>
        {lock}
        {m.result_home!=null && <div className="lockpill">Resultat {m.result_home}–{m.result_away} · {sc} p</div>}
      </div>
      <div className="team">{m.away}</div>
    </div>
  );
}

function Predict({ matches, preds, predictedCount, sortMode, setSortMode, savePred, rules, nowMs, isAdmin }){
  const pct = matches.length?Math.round(predictedCount/matches.length*100):0;
  const teamList = teamsFromMatches(matches);
  let body;
  const rowProps = { preds, savePred, rules, nowMs, isAdmin, teamList };
  if(sortMode==="gruppe"){
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
        <p className="note" style={{marginTop:12}}>Tipsene lagres mens du skriver. Hver kamp låses automatisk {MATCH_LOCK_HOURS} timer før kampstart (norsk tid) — du kan endre alle andre kamper helt til da.</p>
        <div className="row" style={{marginTop:12,alignItems:"center"}}>
          <span className="note" style={{fontWeight:600}}>Sorter etter:</span>
          <select className="inp" style={{flex:"0 0 auto",width:"auto"}} value={sortMode} onChange={e=>setSortMode(e.target.value)}>
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
  const b = bonus || { yn:{}, teams:[], top_scorer:"", top_assist:"", top_keeper:"" };
  const yn=b.yn||{}, teams=b.teams||[];
  const teamList=teamsFromMatches(matches);
  const ans=answers||{yn:{}};
  const ynBtn=(on)=>({padding:"8px 16px",borderRadius:9,fontFamily:"inherit",cursor:locked?"default":"pointer",fontSize:14,
    border:on?"1px solid var(--teal)":"1px solid var(--line)",background:on?"var(--teal)":"var(--panel2)",color:on?"#04120c":"var(--ink)",fontWeight:on?800:600});
  const setYn=(i,v)=>{ if(!locked) saveBonus({...b,yn:{...yn,[i]:v}}); };
  const setTeam=(i,v)=>{ if(!locked){ const t=[...teams]; t[i]=v; saveBonus({...b,teams:t}); } };
  const setGuess=(k,v)=>{ if(!locked) saveBonus({...b,[k]:v}); };
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
          const got=corr&&v?(v===corr?<span style={{color:"var(--teal)"}}> +{rules.yn} p</span>:<span style={{color:"var(--magenta)"}}> 0 p</span>):null;
          return <div key={i} style={{display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",padding:"11px 0",borderBottom:"1px solid var(--line)"}}>
            <div style={{flex:1,fontSize:14}}>{q}{got}</div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button disabled={locked} style={ynBtn(v==="ja")} onClick={()=>setYn(i,"ja")}>Ja</button>
              <button disabled={locked} style={ynBtn(v==="nei")} onClick={()=>setYn(i,"nei")}>Nei</button>
            </div></div>;
        })}
      </div>
      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Kvalifiserte gjetninger</h2>
        <h3 className="sub2">VMs topplasseringer</h3>
        <p className="note" style={{marginBottom:12}}>{rules.intop8} poeng for hvert lag som havner på topp 8, +{rules.exactpos} poeng for riktig plassering.</p>
        {teamList.length===0 && <p className="note" style={{color:"var(--magenta)",marginBottom:12}}>Ingen lag funnet ennå. Admin må kjøre seed_matches.sql.</p>}
        {Array.from({length:8}).map((_,i)=>(
          <div key={i} style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
            <span className="rankbadge">{i+1}</span>
            <select className="inp" disabled={locked} style={{flex:1}} value={teams[i]||""} onChange={e=>setTeam(i,e.target.value)}>
              <option value="">— velg lag —</option>{teamList.map(t=><option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="card">
        <h3 className="sub2">Individuelle priser</h3>
        <p className="note" style={{marginBottom:12}}>{rules.guess} poeng for hvert riktig svar.</p>
        {GUESS_FIELDS.map(f=>{
          const val=b[f.key]||"", corr=ans[f.key]||"";
          const got=corr&&val?(corr.trim().toLowerCase()===val.trim().toLowerCase()?<span style={{color:"var(--teal)"}}> +{rules.guess} p</span>:<span style={{color:"var(--magenta)"}}> 0 p</span>):null;
          return <div className="field" key={f.key}><label>{f.label}{got}</label>
            <input className="inp" disabled={locked} value={val} placeholder="Spillernavn" onChange={e=>setGuess(f.key,e.target.value)}/></div>;
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
        {ms.map(m=><div className="match" key={m.id}>
          <div className="team r">{m.home}</div>
          <div className="mmeta">{m.match_date}<br/>{m.match_time}{m.result_home!=null&&<><br/><span style={{color:"var(--gold)"}}>{m.result_home}–{m.result_away}</span></>}</div>
          <div className="team">{m.away}</div>
        </div>)}
      </div>
    ))}
  </div>;
}

/* ───────── Leaderboard ───────── */
function Leaderboard({ rows, rules, total, isAdmin, deleteUser }){
  return <div className="card"><h2 className="sec">Tabell</h2>
    <p className="note" style={{marginBottom:14}}>Riktig resultat {rules.exact_pts} p · riktig utfall {rules.outcome_pts} p · feil {rules.wrong_pts}. Bonus teller med i totalen.{isAdmin?" Som admin kan du slette spillere her.":""}</p>
    {rows.length===0?<div className="empty">Ingen spillere ennå.</div>:
    <table className="lb"><thead><tr><th>#</th><th>Spiller</th><th className="n">Tot</th><th className="n">Kamp</th><th className="n">Bonus</th><th className="n">Eksakt</th><th className="n">Tippet</th>{isAdmin&&<th></th>}</tr></thead>
    <tbody>{rows.map((r,i)=>(
      <tr key={r.id}><td><span className={`rankbadge ${i===0?"g1":i===1?"g2":i===2?"g3":""}`}>{i+1}</span></td>
        <td>{r.nick||r.name}{r.nick&&<span className="note"> · {r.name}</span>}</td>
        <td className="n"><strong>{r.pts}</strong></td><td className="n">{r.matchPts}</td><td className="n">{r.bonus}</td><td className="n">{r.exact}</td>
        <td className="n"><span className="note">{r.predicted}/{total}</span></td>
        {isAdmin&&<td className="n">{r.email!==ADMIN_EMAIL&&<button className="del" title="Slett spiller" onClick={()=>deleteUser(r)}>✕</button>}</td>}</tr>
    ))}</tbody></table>}
  </div>;
}

/* ───────── Test panel (admin only) ───────── */
function TestPanel({ simNow, setSimNow }){
  const [custom, setCustom] = useState("");
  const presets = [["2026-06-11T15:00","11.06 15:00"],["2026-06-11T16:30","11.06 16:30"],["2026-06-11T19:30","11.06 19:30"]];
  return (
    <div className="testpanel">
      <div style={{fontWeight:800,letterSpacing:".04em",textTransform:"uppercase",fontSize:11,color:"var(--teal)",marginBottom:8}}>🧪 Test-tid (kun admin)</div>
      <div className="note" style={{marginBottom:9}}>{simNow==null?<>Bruker <strong>ekte klokke</strong>.</>:<>Simulert: <strong style={{color:"var(--gold)"}}>{fmtNO(simNow)}</strong></>}</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:9}}>
        {presets.map(([v,l])=><button key={v} className="btn ghost" style={{padding:"7px 10px",fontSize:12}} onClick={()=>setSimNow(noLocalToMs(v))}>{l}</button>)}
      </div>
      <input className="inp" type="datetime-local" value={custom} onChange={e=>setCustom(e.target.value)} style={{fontSize:13,padding:8,marginBottom:8}}/>
      <div style={{display:"flex",gap:6}}>
        <button className="btn primary" style={{flex:1,justifyContent:"center",padding:8,fontSize:13}} onClick={()=>{ if(custom) setSimNow(noLocalToMs(custom)); }}>Bruk tid</button>
        <button className="btn" style={{padding:"8px 10px",fontSize:13}} onClick={()=>setSimNow(null)}>Nullstill</button>
      </div>
    </div>
  );
}

/* ───────── Admin ───────── */
function Admin({ supabase, matches, rules, bonusRules, profiles, allPreds, leaderboard, bonusAnswers, reload }){
  const [nm, setNm] = useState({ stage:"Gruppe A", match_date:"", match_time:"", home:"", away:"" });
  const teamList = teamsFromMatches(matches);
  const ba = bonusAnswers || { yn:{}, teams:[] };

  const num = v => v===""?null:Math.max(0,Math.min(99,parseInt(v)||0));
  async function setResult(id,side,val){ await supabase.from("matches").update({[side==="h"?"result_home":"result_away"]:num(val)}).eq("id",id); reload(); }
  async function setKoTeam(id,field,val){ await supabase.from("matches").update({[field]:val}).eq("id",id); reload(); }
  async function editMatch(id,field,val){ await supabase.from("matches").update({[field]:val}).eq("id",id); reload(); }
  async function delMatch(id){ if(confirm("Slette denne kampen?")){ await supabase.from("matches").delete().eq("id",id); reload(); } }
  async function addMatch(){ if(!nm.home||!nm.away){alert("Lag er påkrevd.");return;} const n=Math.max(0,...matches.map(m=>m.match_no))+1; await supabase.from("matches").insert({match_no:n,...nm}); setNm({stage:nm.stage,match_date:"",match_time:"",home:"",away:""}); reload(); }
  async function setRule(k,v){ await supabase.from("scoring_rules").update({[k]:parseInt(v)||0}).eq("id",1); reload(); }
  async function setBRule(k,v){ await supabase.from("bonus_rules").update({[k]:parseInt(v)||0}).eq("id",1); reload(); }
  async function setBaYn(i,v){ await supabase.from("bonus_answers").update({yn:{...(ba.yn||{}),[i]:v}}).eq("id",1); reload(); }
  async function setBaTeam(i,v){ const t=[...(ba.teams||[])]; t[i]=v; await supabase.from("bonus_answers").update({teams:t}).eq("id",1); reload(); }
  async function setBaGuess(k,v){ await supabase.from("bonus_answers").update({[k]:v}).eq("id",1); reload(); }

  function exportCSV(){
    const byUser={}; allPreds.forEach(p=>{ (byUser[p.user_id]||={})[p.match_id]=p; });
    const lb=Object.fromEntries(leaderboard.map(r=>[r.id,r]));
    const head=["Spiller","E-post","Kallenavn",...matches.map(m=>`${m.home} v ${m.away}`),"Kamp-poeng","Bonus","Total","Eksakt","Tippet"];
    const rows=profiles.map(u=>{
      const cells=matches.map(m=>{ const p=byUser[u.id]?.[m.id]; if(!p) return "";
        if(isKnockout(m.stage)){ const sc=(p.pred_home!=null)?`${p.pred_home}-${p.pred_away}`:""; return (p.pred_home_team||p.pred_away_team)?`${p.pred_home_team||"?"} ${sc} ${p.pred_away_team||"?"}`:sc; }
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
        <p className="note" style={{marginBottom:10}}>Gjelder gruppespill. Sluttspill: 1 p per riktig lag, +1 riktig utfall, +3 eksakt (maks 6).</p>
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
        <div className="between"><h2 className="sec" style={{margin:0}}>Legg inn resultater</h2><button className="btn" onClick={exportCSV}>Eksporter CSV</button></div>
        <p className="note" style={{margin:"6px 0 14px"}}>Tomt = ikke spilt. For sluttspill: velg lagene som faktisk spilte, så får spillerne lag-poeng.</p>
        {matches.map(m=> isKnockout(m.stage) ? (
          <div className="match" key={m.id} style={{gridTemplateColumns:"1fr"}}>
            <div style={{textAlign:"center",fontSize:11,color:"var(--mut)",textTransform:"uppercase",marginBottom:4}}>{m.stage} · {m.match_date}</div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"center"}}>
              <select className="inp" style={{flex:1,minWidth:110}} value={(m.home&&!/\(|TBD/.test(m.home))?m.home:""} onChange={e=>setKoTeam(m.id,"home",e.target.value)}><option value="">— lag —</option>{teamList.map(t=><option key={t} value={t}>{t}</option>)}</select>
              <div className="scoreboxes">
                <input className="sb" inputMode="numeric" defaultValue={m.result_home??""} onBlur={e=>setResult(m.id,"h",e.target.value)}/>
                <span style={{color:"var(--mut)"}}>–</span>
                <input className="sb" inputMode="numeric" defaultValue={m.result_away??""} onBlur={e=>setResult(m.id,"a",e.target.value)}/>
              </div>
              <select className="inp" style={{flex:1,minWidth:110}} value={(m.away&&!/\(|TBD/.test(m.away))?m.away:""} onChange={e=>setKoTeam(m.id,"away",e.target.value)}><option value="">— lag —</option>{teamList.map(t=><option key={t} value={t}>{t}</option>)}</select>
            </div>
          </div>
        ) : (
          <div className="match" key={m.id}>
            <div className="team r">{m.home}</div>
            <div className="scoreboxes">
              <input className="sb" inputMode="numeric" defaultValue={m.result_home??""} onBlur={e=>setResult(m.id,"h",e.target.value)}/>
              <span style={{color:"var(--mut)"}}>–</span>
              <input className="sb" inputMode="numeric" defaultValue={m.result_away??""} onBlur={e=>setResult(m.id,"a",e.target.value)}/>
            </div>
            <div className="team">{m.away}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{marginBottom:16}}>
        <h2 className="sec">Fasit — bonus</h2>
        <p className="note" style={{marginBottom:12}}>Sett riktige svar. Tabellen oppdateres umiddelbart.</p>
        <h3 className="sub2">JA / NEI</h3>
        {YN_QUESTIONS.map((q,i)=>{ const v=(ba.yn||{})[i]||"";
          const btn=(on)=>({padding:"8px 14px",borderRadius:9,fontFamily:"inherit",cursor:"pointer",fontSize:13,border:on?"1px solid var(--teal)":"1px solid var(--line)",background:on?"var(--teal)":"var(--panel2)",color:on?"#04120c":"var(--ink)",fontWeight:on?800:600});
          return <div key={i} style={{display:"flex",gap:12,alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:"1px solid var(--line)"}}>
            <div style={{flex:1,fontSize:13.5}}>{q}</div>
            <div style={{display:"flex",gap:6}}>
              <button style={btn(v==="ja")} onClick={()=>setBaYn(i,"ja")}>Ja</button>
              <button style={btn(v==="nei")} onClick={()=>setBaYn(i,"nei")}>Nei</button>
              <button style={{...btn(false),opacity:.6}} onClick={()=>setBaYn(i,"")}>Tøm</button>
            </div></div>;
        })}
        <h3 className="sub2">VMs topplasseringer (fasit)</h3>
        {Array.from({length:8}).map((_,i)=>(
          <div key={i} style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
            <span className="rankbadge">{i+1}</span>
            <select className="inp" style={{flex:1}} value={(ba.teams||[])[i]||""} onChange={e=>setBaTeam(i,e.target.value)}><option value="">— velg lag —</option>{teamList.map(t=><option key={t} value={t}>{t}</option>)}</select>
          </div>
        ))}
        <h3 className="sub2">Individuelle priser (fasit)</h3>
        {GUESS_FIELDS.map(f=>(
          <div className="field" key={f.key}><label>{f.label}</label>
            <input className="inp" defaultValue={ba[f.key]||""} placeholder="Spillernavn" onBlur={e=>setBaGuess(f.key,e.target.value)}/></div>
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
              {u.email!==ADMIN_EMAIL && (u.paid?<span className="tag" style={{color:"var(--teal)",borderColor:"#0c4a36",marginLeft:6}}>200 NOK ✓</span>:<span className="tag" style={{color:"var(--magenta)",borderColor:"#5a2418",marginLeft:6}}>IKKE BETALT</span>)}
              <div className="note">{lbr.predicted||0}/{matches.length} tippet · {lbr.pts||0} p</div>
            </div></div>;
        })}
      </div>
    </div>
  );
}
