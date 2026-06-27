// Auto-updates wc2026-results.json from ESPN's public FIFA World Cup API.
// Computes each team's furthest stage reached (1=R32 .. 6=Champion) from knockout matches.
// Group-stage matches are ignored here; R32 qualification is taken from teams appearing in
// Round-of-32 fixtures (which exist once the bracket is set). Merges by max with the existing
// file so a furthest-stage value is never lowered, and manual entries are preserved.
import { readFile, writeFile } from 'node:fs/promises';

// FIFA/ESPN 3-letter codes -> our canonical team names
const ABBR = {
  GER:'Germany', DEU:'Germany', BIH:'Bosnia and Herzegovina', FRA:'France', AUS:'Australia',
  KOR:'South Korea', CAN:'Canada', NED:'Netherlands', NLD:'Netherlands', MAR:'Morocco',
  COL:'Colombia', CRO:'Croatia', HRV:'Croatia', ESP:'Spain', AUT:'Austria', USA:'United States',
  NOR:'Norway', BEL:'Belgium', CZE:'Czech Republic', BRA:'Brazil', JPN:'Japan', ECU:'Ecuador',
  SEN:'Senegal', MEX:'Mexico', SWE:'Sweden', ENG:'England', CIV:'Ivory Coast', ARG:'Argentina',
  URU:'Uruguay', URY:'Uruguay', TUR:'Turkey', IRN:'Iran', IRI:'Iran', SUI:'Switzerland',
  CHE:'Switzerland', EGY:'Egypt', POR:'Portugal', PRT:'Portugal', GHA:'Ghana', SCO:'Scotland',
  ALG:'Algeria', DZA:'Algeria', QAT:'Qatar', NZL:'New Zealand', KSA:'Saudi Arabia',
  SAU:'Saudi Arabia', COD:'DR Congo'
};
const CANON = [...new Set(Object.values(ABBR))];

const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
const NAME = {
  unitedstates:'United States', usa:'United States',
  southkorea:'South Korea', korearepublic:'South Korea', republicofkorea:'South Korea',
  turkey:'Turkey', turkiye:'Turkey',
  czechrepublic:'Czech Republic', czechia:'Czech Republic',
  ivorycoast:'Ivory Coast', cotedivoire:'Ivory Coast',
  bosniaandherzegovina:'Bosnia and Herzegovina', bosniaherzegovina:'Bosnia and Herzegovina',
  drcongo:'DR Congo', congodr:'DR Congo', democraticrepublicofthecongo:'DR Congo',
  iran:'Iran', iriran:'Iran',
};
for (const t of CANON) NAME[norm(t)] = t;

function resolve(c){
  const ab = (c?.team?.abbreviation||'').toUpperCase();
  if (ABBR[ab]) return ABBR[ab];
  return NAME[norm(c?.team?.displayName||c?.team?.name)] || null;
}

// season.slug -> furthest stage that appearing in such a match implies
function stageOf(slug){
  const x = (slug||'').toLowerCase();
  if (/semi/.test(x)) return 4;
  if (/quarter/.test(x)) return 3;
  if (/(round.?of.?16|last.?16)/.test(x)) return 2;
  if (/(round.?of.?32|last.?32)/.test(x)) return 1;
  if (/final/.test(x)) return 5;        // checked after "semi"
  return 0;                              // group stage / unknown -> ignore
}

const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
const stages = {};
const bump = (team, s) => { if (team && s && (stages[team]||0) < s) stages[team] = s; };

const START = Date.UTC(2026,5,28);   // Jun 28 (knockouts begin)
const END   = Date.UTC(2026,6,31);   // Jul 31
let scanned = 0;
for (let t = START; t <= END; t += 86400000){
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${ymd(new Date(t))}`;
  let j;
  try { const r = await fetch(url); if (!r.ok) continue; j = await r.json(); }
  catch { continue; }
  for (const ev of (j.events||[])){
    const s = stageOf(ev?.season?.slug);
    if (!s) continue;
    const comp = ev?.competitions?.[0]; if (!comp) continue;
    const teams = (comp.competitors||[]).map(c => ({ name: resolve(c), winner: c.winner }));
    for (const tm of teams) bump(tm.name, s);                 // appearing => reached this round
    if (s === 5 && comp?.status?.type?.completed){             // champion = winner of the Final
      const w = teams.find(tm => tm.winner); if (w) bump(w.name, 6);
    }
  }
  scanned++;
}

// group finishing positions (1-4) from the standings endpoint
const groupPos = {};
try {
  const r = await fetch('https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026');
  if (r.ok){
    const sj = await r.json();
    for (const grp of (sj.children||[])){
      for (const e of (grp?.standings?.entries||[])){
        const name = resolve(e);
        const rankStat = (e.stats||[]).find(s => s.name === 'rank');
        const rank = rankStat ? Number(rankStat.value) : 0;
        if (name && rank) groupPos[name] = rank;
      }
    }
  }
} catch { /* keep existing positions on failure */ }

// merge with existing file (never lower a stage; keep manual entries; refresh positions)
let existing = {}, existingPos = {};
try { const f = JSON.parse(await readFile('wc2026-results.json','utf8')); existing = f.stages||{}; existingPos = f.groupPositions||{}; } catch {}
const merged = { ...existing };
for (const [tm, s] of Object.entries(stages)) if ((merged[tm]||0) < s) merged[tm] = s;
const mergedPos = Object.keys(groupPos).length ? groupPos : existingPos;

const out = {
  lastUpdated: new Date().toISOString().slice(0,10),
  source: 'ESPN public API (site.api.espn.com) via GitHub Actions',
  note: 'team -> furthest stage reached. 0=out,1=group/R32,2=R16,3=QF,4=SF,5=Final,6=Champion. groupPositions: actual finishing rank (1-4) in the group stage.',
  stages: Object.fromEntries(Object.entries(merged).sort()),
  groupPositions: Object.fromEntries(Object.entries(mergedPos).sort())
};
await writeFile('wc2026-results.json', JSON.stringify(out, null, 2) + '\n');
console.log(`Scanned ${scanned} days; ${Object.keys(stages).length} stage-teams; ${Object.keys(mergedPos).length} group positions; ${Object.keys(out.stages).length} total stages in file.`);
