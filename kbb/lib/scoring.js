/* ===== Stage ordering ===== */
export const STAGE_ORDER = [
  "Gruppe A","Gruppe B","Gruppe C","Gruppe D","Gruppe E","Gruppe F",
  "Gruppe G","Gruppe H","Gruppe I","Gruppe J","Gruppe K","Gruppe L",
  "Sekstendelsfinale","Åttedelsfinale","Kvartfinale","Semifinale","Bronsefinale","Finale"
];

export function isKnockout(stage){ return stage && !stage.startsWith("Gruppe"); }

// True once a match has two real teams (admin has filled them in — not TBA/placeholder).
export function teamsSet(m){
  const ok = t => t && !/\(|TBD|TBA/i.test(t);
  return ok(m.home) && ok(m.away);
}

export function groupByStage(matches){
  const g={};
  matches.forEach(m=>{ (g[m.stage] ||= []).push(m); });
  const out={};
  Object.keys(g).sort((a,b)=>{
    const ia=STAGE_ORDER.indexOf(a), ib=STAGE_ORDER.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib) || a.localeCompare(b);
  }).forEach(k=>out[k]=g[k]);
  return out;
}

/* ===== Group-stage scoring (rules: {exact_pts,outcome_pts,wrong_pts}) ===== */
export function scorePrediction(predH, predA, resH, resA, rules){
  if(resH==null || resA==null) return null;
  if(predH==null || predA==null) return 0;
  if(predH===resH && predA===resA) return rules.exact_pts;
  const po=Math.sign(predH-predA), ao=Math.sign(resH-resA);
  return po===ao ? rules.outcome_pts : rules.wrong_pts;
}

/* ===== Knockout scoring: 1 p per correct team (max 2), +1 outcome, +3 exact (max 6) =====
   m = match (home/away are ACTUAL teams once admin sets them),
   p = user prediction {pred_home_team, pred_away_team, pred_home, pred_away},
   resH/resA = actual score. */
export function scoreKnockout(m, p, resH, resA){
  if(!p) return null;
  const picks=[(p.pred_home_team||"").trim().toLowerCase(),(p.pred_away_team||"").trim().toLowerCase()].filter(Boolean);
  const actualTeams=[];
  if(m.home && !/\(|TBD/.test(m.home)) actualTeams.push(m.home.trim().toLowerCase());
  if(m.away && !/\(|TBD/.test(m.away)) actualTeams.push(m.away.trim().toLowerCase());
  const teamsKnown=actualTeams.length===2;
  const resultKnown=resH!=null && resA!=null;
  if(!teamsKnown && !resultKnown) return null;
  let pts=0;
  if(teamsKnown){
    const used=[...actualTeams];
    picks.forEach(t=>{ const idx=used.indexOf(t); if(idx>=0){ pts+=1; used.splice(idx,1); } });
  }
  if(resultKnown && p.pred_home!=null && p.pred_away!=null){
    if(p.pred_home===resH && p.pred_away===resA) pts+=3+1;
    else { const po=Math.sign(p.pred_home-p.pred_away), ao=Math.sign(resH-resA); if(po===ao) pts+=1; }
  }
  return pts;
}

/* ===== Teams (48 group-stage teams) ===== */
export function teamsFromMatches(matches){
  const set=new Set();
  matches.forEach(m=>{ if(m.stage && m.stage.startsWith("Gruppe")){ set.add(m.home); set.add(m.away); } });
  return [...set].filter(t=>t && !/\(|TBD/.test(t)).sort((a,b)=>a.localeCompare(b));
}

/* ===== Bonus ===== */
export const YN_QUESTIONS = [
  "Erling Braut Haaland scorer hattrick",
  "En annen norsk landslagsspiller scorer flere mål enn Erling",
  "Norge tar seg videre til sluttspillet",
  "Martin Ødegaard blir skadet og går glipp av en kamp",
  "Julian Ryerson bytter sveis i løpet av mesterskapet",
  "En kamp blir forsinket eller avlyst på grunn av ekstremvær eller opptøyer",
  "En tilskuer stormer banen i løpet av mesterskapet",
  "En amerikansk superkjendis som ikke har en dritt med idrett å gjøre filmes fra tribunen",
];
export const GUESS_FIELDS = [
  { key:"top_scorer", label:"Spilleren med flest mål" },
  { key:"top_assist", label:"Spilleren med flest målgivende pasninger" },
  { key:"top_keeper", label:"Keeperen med flest kamper uten å slippe inn mål" },
];
export const DEFAULT_BONUS_RULES = { yn:5, guess:5, intop8:1, exactpos:4 };

// b = bonus prediction {yn:{}, teams:[], top_scorer, top_assist, top_keeper}
// a = bonus answers (same shape); rules = {yn,guess,intop8,exactpos}
export function scoreBonus(b, a, rules){
  if(!b) return 0;
  a=a||{}; rules=rules||DEFAULT_BONUS_RULES;
  let pts=0;
  const byn=b.yn||{}, ayn=a.yn||{};
  YN_QUESTIONS.forEach((_,i)=>{ if(ayn[i] && byn[i] && ayn[i]===byn[i]) pts+=rules.yn; });
  GUESS_FIELDS.forEach(f=>{
    const ans=(a[f.key]||"").trim().toLowerCase();
    const guess=(b[f.key]||"").trim().toLowerCase();
    if(ans && guess && ans===guess) pts+=rules.guess;
  });
  const correct=a.teams||[], guess=b.teams||[];
  if(correct.length){
    const cs=correct.map(t=>(t||"").trim().toLowerCase()).filter(Boolean);
    guess.forEach((t,i)=>{
      const g=(t||"").trim().toLowerCase(); if(!g) return;
      if(cs.includes(g)) pts+=rules.intop8;
      if(correct[i] && (correct[i]||"").trim().toLowerCase()===g) pts+=rules.exactpos;
    });
  }
  return pts;
}

/* ===== Lock timing (Norwegian time, CEST = GMT+2) ===== */
export const MATCH_LOCK_HOURS = 0;   // kampen låses ved kampstart
export const CEST_OFFSET = 2;
export const BONUS_DEADLINE_NO = "2026-06-11T18:00";

export function kickoffInstant(dateStr, timeStr){
  if(!dateStr || !timeStr) return null;
  const [Y,M,D]=dateStr.split("-").map(Number);
  const [h,mi]=timeStr.split(":").map(Number);
  return new Date(Date.UTC(Y, M-1, D, h-CEST_OFFSET, mi||0));
}
export function bonusDeadlineMs(){
  const [d,t]=BONUS_DEADLINE_NO.split("T");
  const [Y,M,D]=d.split("-").map(Number);
  const [h,mi]=t.split(":").map(Number);
  return Date.UTC(Y, M-1, D, h-CEST_OFFSET, mi||0);
}
// nowMs: pass a simulated time (ms) or null for real clock
export function matchLocked(m, nowMs, isAdmin){
  if(isAdmin) return false;
  if(m && m.locked_manual) return true;   // admin nødlås (backup)
  const ko=kickoffInstant(m.match_date, m.match_time);
  if(!ko) return false;
  return (nowMs ?? Date.now()) >= ko.getTime() - MATCH_LOCK_HOURS*3600*1000;
}
export function bonusLocked(nowMs, isAdmin){
  if(isAdmin) return false;
  return (nowMs ?? Date.now()) >= bonusDeadlineMs();
}
export function fmtNO(ms){
  try { return new Date(ms).toLocaleString("no-NO",{timeZone:"Europe/Oslo"}); }
  catch(e){ return new Date(ms).toLocaleString(); }
}
// Frist = kampstart (låses ved avspark)
export function deadlineLabel(m){
  const ko=kickoffInstant(m.match_date, m.match_time);
  if(!ko) return "";
  const dl=ko.getTime()-MATCH_LOCK_HOURS*3600*1000;
  try { return new Date(dl).toLocaleString("no-NO",{timeZone:"Europe/Oslo",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
  catch(e){ return new Date(dl).toISOString(); }
}
export function noLocalToMs(str){
  if(!str) return null;
  const [d,t]=str.split("T");
  const [Y,M,D]=d.split("-").map(Number);
  const [h,mi]=t.split(":").map(Number);
  return Date.UTC(Y, M-1, D, h-CEST_OFFSET, mi||0);
}
