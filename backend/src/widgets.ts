export interface FlightRecord {
  id: number;
  flightDate: string;
  airlineIata: string;
  flightNumber: string;
  depAirportIata: string;
  arrAirportIata: string;
  depTime?: string | null;
  arrTime?: string | null;
  distanceKm?: number | null;
  bookingRef?: string | null;
  cabinClass?: string | null;
  seat?: string | null;
  aircraftType?: string | null;
}

export interface AirportReviewInfo {
  iataCode: string;
  name: string;
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone?: string | null;
  confidence?: string | null;
  reasoning?: string | null;
}

const encoder = new TextEncoder();

export function utf8ByteLength(str: string): number {
  return encoder.encode(str).length;
}

export function truncateUtf8(str: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8ByteLength(str) <= maxBytes) return str;

  const target = maxBytes > 3 ? maxBytes - 3 : maxBytes;
  let out = '';
  let bytes = 0;

  for (const ch of str) {
    const chBytes = encoder.encode(ch).length;
    if (bytes + chBytes > target) break;
    out += ch;
    bytes += chBytes;
  }

  return maxBytes > 3 ? out + '...' : out;
}

export function formatFlightRef(airlineIata: string, flightNumber: string): string {
  return flightNumber.startsWith(airlineIata) ? flightNumber : airlineIata + flightNumber;
}

function diffDaysFromToday(dateStr: string, todayStr: string): number {
  const target = Date.parse(dateStr + 'T00:00:00Z');
  const today = Date.parse(todayStr + 'T00:00:00Z');
  if (Number.isNaN(target) || Number.isNaN(today)) return 0;
  return Math.round((target - today) / 86400000);
}

function compactFlight(
  f: FlightRecord,
  cityMap?: Map<string, string>,
  todayStr?: string
) {
  const base: Record<string, unknown> = {
    id: f.id,
    fn: formatFlightRef(f.airlineIata, f.flightNumber),
    dt: f.flightDate,
    d: f.depAirportIata,
    a: f.arrAirportIata,
  };
  if (cityMap) {
    const dc = cityMap.get(f.depAirportIata);
    const ac = cityMap.get(f.arrAirportIata);
    if (dc) base.dc = truncateUtf8(dc, 24);
    if (ac) base.ac = truncateUtf8(ac, 24);
  }
  if (f.depTime) base.dt_t = f.depTime;
  if (f.arrTime) base.ar_t = f.arrTime;
  if (f.distanceKm) base.km = Math.round(f.distanceKm);
  if (f.bookingRef) base.pnr = truncateUtf8(f.bookingRef, 16);
  if (f.cabinClass) base.cb = truncateUtf8(f.cabinClass, 18);
  if (f.seat) base.st = truncateUtf8(f.seat, 10);
  if (f.aircraftType) base.eq = truncateUtf8(f.aircraftType, 18);
  if (todayStr) base.days = diffDaysFromToday(f.flightDate, todayStr);
  return base;
}

export function buildUpcomingFlightData(
  upcoming: FlightRecord[],
  requestedIndex = 0,
  cityMap?: Map<string, string>,
  todayStr = new Date().toISOString().split('T')[0]
): string {
  const tot = upcoming.length;
  if (tot === 0) {
    return JSON.stringify({ v: 'next', i: 0, tot: 0, f: null });
  }
  const idx = Math.max(0, Math.min(Number.isFinite(requestedIndex) ? requestedIndex : 0, tot - 1));
  const f = compactFlight(upcoming[idx], cityMap, todayStr);
  let json = JSON.stringify({ v: 'next', i: idx, tot, f });

  if (utf8ByteLength(json) > 1024) {
    delete f.dc;
    delete f.ac;
    delete f.eq;
    json = JSON.stringify({ v: 'next', i: idx, tot, f });
  }
  return json;
}

export function buildFlightStatsData(input: {
  totalFlights: number;
  totalDistanceKm: number;
  uniqueAirports: number;
  countriesVisited: number;
  uniqueAirlines: number;
  upcomingFlights: number;
  monthlyCounts: number[]; // 12 numbers Jan-Dec
  cabinBreakdown: Array<[string, number]>;
}): string {
  const mo = Array.from({ length: 12 }, (_, idx) => Math.max(0, Math.round(input.monthlyCounts[idx] || 0)));
  const cb = input.cabinBreakdown.slice(0, 4).map(([label, cnt]) => [truncateUtf8(label, 18), cnt] as [string, number]);
  let json = JSON.stringify({
    v: 'stats',
    tot: input.totalFlights,
    km: Math.round(input.totalDistanceKm),
    ap: input.uniqueAirports,
    co: input.countriesVisited,
    al: input.uniqueAirlines,
    up: input.upcomingFlights,
    mo,
    cb,
  });

  if (utf8ByteLength(json) > 1024) {
    json = JSON.stringify({
      v: 'stats',
      tot: input.totalFlights,
      km: Math.round(input.totalDistanceKm),
      ap: input.uniqueAirports,
      co: input.countriesVisited,
      al: input.uniqueAirlines,
      up: input.upcomingFlights,
      mo,
      cb: cb.slice(0, 2),
    });
  }
  return json;
}

export function buildFlightListData(
  view: 'hist' | 'srch',
  allMatches: FlightRecord[],
  requestedPage = 0,
  query = ''
): string {
  const pageSize = 4;
  const totalMatches = allMatches.length;
  const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));
  const page = Math.max(0, Math.min(Number.isFinite(requestedPage) ? requestedPage : 0, totalPages - 1));
  const slice = allMatches.slice(page * pageSize, (page + 1) * pageSize);
  const qTrunc = view === 'srch' ? truncateUtf8(query, 36) : '';

  const encode = (maxItems: number, includeMeta: boolean): string => {
    const items = slice.slice(0, maxItems).map((f) => {
      const item: Record<string, unknown> = {
        id: f.id,
        fn: formatFlightRef(f.airlineIata, f.flightNumber),
        dt: f.flightDate,
        d: f.depAirportIata,
        a: f.arrAirportIata,
      };
      if (includeMeta) {
        if (f.depTime) item.dt_t = f.depTime;
        if (f.arrTime) item.ar_t = f.arrTime;
        if (f.distanceKm) item.km = Math.round(f.distanceKm);
        if (f.bookingRef) item.pnr = truncateUtf8(f.bookingRef, 12);
        if (f.cabinClass) item.cb = truncateUtf8(f.cabinClass, 12);
        if (f.seat) item.st = truncateUtf8(f.seat, 8);
        if (f.aircraftType) item.eq = truncateUtf8(f.aircraftType, 12);
      }
      return item;
    });

    return JSON.stringify({
      v: view,
      ...(view === 'srch' ? { q: qTrunc } : {}),
      p: page,
      tp: totalPages,
      n: totalMatches,
      items,
    });
  };

  for (const [maxItems, includeMeta] of [
    [4, true],
    [3, true],
    [4, false],
    [2, true],
    [1, true],
  ] as Array<[number, boolean]>) {
    const candidate = encode(maxItems, includeMeta);
    if (utf8ByteLength(candidate) <= 1024) {
      return candidate;
    }
  }

  return JSON.stringify({ v: view, ...(view === 'srch' ? { q: '' } : {}), p: page, tp: totalPages, n: totalMatches, items: [] });
}

export function buildFlightCardPublicData(input: {
  kind: 'import' | 'remind';
  id?: number;
  flight: FlightRecord;
  depCity?: string | null;
  arrCity?: string | null;
}): string {
  const f = input.flight;
  const encode = (cityLimit: number, equipLimit: number, cabinLimit: number): string => {
    const payload: Record<string, unknown> = {
      k: input.kind,
      ...(input.id ? { id: input.id } : {}),
      fn: formatFlightRef(f.airlineIata, f.flightNumber),
      dt: f.flightDate,
      d: f.depAirportIata,
      a: f.arrAirportIata,
    };
    if (input.depCity && cityLimit > 0) payload.dc = truncateUtf8(input.depCity, cityLimit);
    if (input.arrCity && cityLimit > 0) payload.ac = truncateUtf8(input.arrCity, cityLimit);
    if (f.depTime) payload.dt_t = f.depTime;
    if (f.arrTime) payload.ar_t = f.arrTime;
    if (f.distanceKm) payload.km = Math.round(f.distanceKm);
    if (f.bookingRef) payload.pnr = truncateUtf8(f.bookingRef, 16);
    if (f.cabinClass && cabinLimit > 0) payload.cb = truncateUtf8(f.cabinClass, cabinLimit);
    if (f.seat) payload.st = truncateUtf8(f.seat, 10);
    if (f.aircraftType && equipLimit > 0) payload.eq = truncateUtf8(f.aircraftType, equipLimit);
    return JSON.stringify(payload);
  };

  for (const [cLim, eLim, cbLim] of [
    [40, 24, 24],
    [20, 16, 16],
    [0, 12, 12],
    [0, 0, 0],
  ]) {
    const candidate = encode(cLim, eLim, cbLim);
    if (utf8ByteLength(candidate) <= 1024) {
      return candidate;
    }
  }

  return encode(0, 0, 0);
}

export function buildAirportReviewPublicData(info: AirportReviewInfo): string {
  const encode = (nameLimit: number, cityLimit: number, reasonLimit: number): string => {
    const payload: Record<string, unknown> = {
      iata: info.iataCode,
      name: truncateUtf8(info.name, nameLimit),
      city: truncateUtf8(info.city, cityLimit),
      co: info.countryCode,
      lat: Number(info.latitude.toFixed(4)),
      lng: Number(info.longitude.toFixed(4)),
      conf: info.confidence || 'high',
    };
    if (info.timezone) payload.tz = truncateUtf8(info.timezone, 36);
    if (info.reasoning && reasonLimit > 0) payload.rsn = truncateUtf8(info.reasoning, reasonLimit);
    return JSON.stringify(payload);
  };

  for (const [nLim, cLim, rLim] of [
    [64, 40, 260],
    [48, 30, 120],
    [36, 24, 48],
    [28, 20, 0],
  ]) {
    const candidate = encode(nLim, cLim, rLim);
    if (utf8ByteLength(candidate) <= 1024) {
      return candidate;
    }
  }

  return encode(20, 16, 0);
}

export const FLIGHT_DASHBOARD_HTML = `<style>
body{margin:0;padding:0;font-family:system-ui,sans-serif;font-size:var(--tg-text-font-size,15px);line-height:1.35;color:var(--tg-theme-text-color)}
.w{padding:10px 12px max(10px,env(safe-area-inset-bottom)) 12px}
.tabs{display:flex;gap:4px;margin-bottom:8px}
button{font:inherit;font-size:12px;padding:5px 9px;border-radius:8px;border:0;cursor:pointer;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
.tab{flex:1;padding:6px 4px;font-weight:600}
.on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
.card{background:var(--tg-theme-secondary-bg-color);border-radius:10px;padding:10px;margin-bottom:6px}
.rt{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0}
.iata{font-size:22px;font-weight:700;letter-spacing:.5px}
.city{font-size:12px;color:var(--tg-theme-hint-color)}
.pill{font-size:11px;padding:2px 7px;border-radius:99px;background:var(--tg-theme-bg-color);color:var(--tg-theme-accent-text-color);font-weight:600}
.meta{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:13px;color:var(--tg-theme-subtitle-text-color);margin-top:6px}
.kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}
.kb{background:var(--tg-theme-secondary-bg-color);border-radius:8px;padding:6px 8px}
.kv{font-size:15px;font-weight:700}
.kl{font-size:11px;color:var(--tg-theme-hint-color)}
.row{background:var(--tg-theme-secondary-bg-color);border-radius:9px;padding:7px 9px;margin-bottom:5px;cursor:pointer}
.rowt{display:flex;justify-content:space-between;align-items:center;gap:6px}
.det{margin-top:6px;padding-top:6px;border-top:1px solid var(--tg-theme-section-separator-color);font-size:12px;color:var(--tg-theme-subtitle-text-color)}
.ft{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:6px}
.pg{font-size:12px;color:var(--tg-theme-hint-color)}
.msg{font-size:12px;color:var(--tg-theme-accent-text-color);margin-bottom:6px}
.barwrap{height:6px;border-radius:4px;background:var(--tg-theme-bg-color);margin-top:3px;overflow:hidden}
.bar{height:6px;border-radius:4px;background:var(--tg-theme-button-color)}
.emp{padding:14px 0;text-align:center;color:var(--tg-theme-hint-color)}
.dis{color:var(--tg-theme-hint-color)}
</style>
<div class="w">
  <div class="tabs">
    <button class="tab" id="t_next">🕒 Next</button>
    <button class="tab" id="t_stats">📊 Stats</button>
    <button class="tab" id="t_hist">📜 Past</button>
    <button id="t_srch">🔍</button>
  </div>
  <div class="msg" id="msg" hidden></div>
  <div id="body"></div>
</div>
<script>
const TW=window.TelegramWidget,$=(id)=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
let S={v:'next',i:0,tot:0,f:null},expId=null,cp='';
function parse(s){try{const o=JSON.parse(s);return o&&o.v?o:null;}catch{return null;}}
function load(){const o=parse(TW&&TW.chatData);if(o)S=o;}
function setMsg(t){const el=$('msg');el.textContent=t||'';el.hidden=!t;}
function req(cmd,hint){
  if(!TW){setMsg('Preview');return;}
  setMsg('Loading...');
  TW.request(cmd).then((r)=>{
    const o=parse(r&&r.result);
    if(o){S=o;expId=null;setMsg('');draw();}
    else{let j=null;try{j=JSON.parse(r&&r.result||'');}catch{}setMsg(j&&j.error?j.error:(hint||''));}
  },(e)=>setMsg('Error: '+e.code));
}
function mk(t,c,txt){const e=document.createElement(t);if(c)e.className=c;if(txt!==undefined)e.textContent=txt;return e;}
function copyBtn(pnr,label){
  const b=mk('button','',cp===pnr?'Copied ✓':(label||'📋 PNR: '+pnr));
  b.onclick=(ev)=>{ev.stopPropagation();if(TW){TW.copyText(pnr);TW.HapticFeedback&&TW.HapticFeedback.notificationOccurred('success');}cp=pnr;draw();setTimeout(()=>{if(cp===pnr){cp='';draw();}},1500);};
  return b;
}
function drawNext(box){
  if(!S.f){box.replaceChildren(mk('div','emp','No upcoming flights recorded. ✈️'));return;}
  const f=S.f,card=mk('div','card');
  const h=mk('div','rt');
  h.append(mk('span','pill',f.fn+(f.eq?' · '+f.eq:'')),mk('span','pill',f.days===0?'Today!':(f.days===1?'Tomorrow':('In '+f.days+'d'))));
  const rt=mk('div','rt');
  const L=mk('div'),R=mk('div');R.style.textAlign='right';
  L.append(mk('div','iata',f.d),mk('div','city',f.dc||''));
  const mid=mk('div','city','✈'+(f.km?(' '+f.km+' km'):''));
  R.append(mk('div','iata',f.a),mk('div','city',f.ac||''));
  rt.append(L,mid,R);
  const meta=mk('div','meta');
  meta.append(mk('span','','📅 '+f.dt),mk('span','','🕒 '+(f.dt_t||'TBD')+' → '+(f.ar_t||'TBD')));
  if(f.cb||f.st)meta.append(mk('span','','💺 '+[f.cb,f.st].filter(Boolean).join(' / ')));
  card.append(h,rt,meta);
  if(f.pnr){const pr=mk('div','ft');pr.append(copyBtn(f.pnr));card.append(pr);}
  const ft=mk('div','ft'),nav=mk('div','tabs');nav.style.margin='0';
  if(S.tot>1){
    const bp=mk('button','','◀'),bn=mk('button','','▶');
    if(S.i<=0){bp.disabled=true;bp.className='dis';}else bp.onclick=()=>req('flight:next:'+(S.i-1));
    if(S.i>=S.tot-1){bn.disabled=true;bn.className='dis';}else bn.onclick=()=>req('flight:next:'+(S.i+1));
    nav.append(bp,mk('span','pg',(S.i+1)+' / '+S.tot),bn);
  }else nav.append(mk('span','pg','1 upcoming'));
  const br=mk('button','','🔄');br.onclick=()=>req('flight:next:'+(S.i||0));
  ft.append(nav,br);box.replaceChildren(card,ft);
}
function drawStats(box){
  const grid=mk('div','kpi');
  [['Flights',S.tot],['Distance',(S.km||0).toLocaleString()+' km'],['Airports',S.ap],['Countries',S.co],['Airlines',S.al],['Upcoming',S.up]].forEach(([k,v])=>{
    const b=mk('div','kb');b.append(mk('div','kv',String(v||0)),mk('div','kl',k));grid.append(b);
  });
  const card=mk('div','card');card.append(mk('div','kl','Monthly Flights (Jan–Dec)'));
  const mo=S.mo||[],mx=Math.max(1,...mo),svg=document.createElementNS(NS,'svg');
  svg.setAttribute('viewBox','0 0 288 76');svg.setAttribute('width','100%');svg.style.marginTop='4px';
  const lbls='JFMAMJJASOND';
  for(let i=0;i<12;i++){
    const v=mo[i]||0,h=v?Math.max(4,Math.round(v/mx*46)):2,x=i*24+4,y=54-h;
    const r=document.createElementNS(NS,'rect');
    r.setAttribute('x',String(x));r.setAttribute('y',String(y));r.setAttribute('width','16');r.setAttribute('height',String(h));r.setAttribute('rx','3');
    r.setAttribute('fill',v?'var(--tg-theme-button-color)':'var(--tg-theme-bg-color)');
    const t=document.createElementNS(NS,'text');
    t.setAttribute('x',String(x+8));t.setAttribute('y','69');t.setAttribute('text-anchor','middle');t.setAttribute('font-size','10');
    t.setAttribute('fill','var(--tg-theme-hint-color)');t.textContent=lbls[i];
    svg.append(r,t);
  }
  card.append(svg);
  const els=[grid,card];
  if(S.cb&&S.cb.length){
    const cc=mk('div','card'),ct=mk('div','kl','Cabins');ct.style.marginBottom='4px';cc.append(ct);
    const cmx=Math.max(1,...S.cb.map((x)=>x[1]));
    S.cb.forEach(([nm,cn])=>{
      const r=mk('div','rowt');r.style.fontSize='12px';r.append(mk('span','',nm),mk('span','',String(cn)));
      const bw=mk('div','barwrap'),br=mk('div','bar');br.style.width=Math.round(cn/cmx*100)+'%';
      bw.append(br);cc.append(r,bw);
    });
    els.push(cc);
  }
  box.replaceChildren(...els);
}
function drawList(box){
  const els=[];
  if(S.v==='srch')els.push(mk('div','kl','Search: "'+(S.q||'')+'" ('+(S.n||0)+')'));
  if(!S.items||!S.items.length){els.push(mk('div','emp','No flights found.'));box.replaceChildren(...els);return;}
  S.items.forEach((f)=>{
    const row=mk('div','row');
    row.onclick=()=>{expId=expId===f.id?null:f.id;draw();};
    const t=mk('div','rowt');
    t.append(mk('strong','',f.d+' → '+f.a+' ('+f.fn+')'),mk('span','kl',f.dt));
    row.append(t);
    if(expId===f.id){
      const d=mk('div','det');
      const bits=['🕒 '+(f.dt_t||'TBD')+'–'+(f.ar_t||'TBD')];
      if(f.km)bits.push(f.km+' km');if(f.eq)bits.push(f.eq);if(f.cb||f.st)bits.push([f.cb,f.st].filter(Boolean).join('/'));
      d.append(mk('div','',bits.join(' · ')));
      if(f.pnr){const pr=mk('div','ft');pr.append(copyBtn(f.pnr,'📋 Copy PNR: '+f.pnr));d.append(pr);}
      row.append(d);
    }
    els.push(row);
  });
  const ft=mk('div','ft'),nav=mk('div','tabs');nav.style.margin='0';
  const pre=S.v==='srch'?'flight:srch:':'flight:hist:',suf=S.v==='srch'?(':'+(S.q||'')):'';
  if((S.tp||1)>1){
    const bp=mk('button','','◀'),bn=mk('button','','▶');
    if(S.p<=0){bp.disabled=true;bp.className='dis';}else bp.onclick=()=>req(pre+(S.p-1)+suf);
    if(S.p>=(S.tp||1)-1){bn.disabled=true;bn.className='dis';}else bn.onclick=()=>req(pre+(S.p+1)+suf);
    nav.append(bp,mk('span','pg','Page '+(S.p+1)+'/'+(S.tp||1)),bn);
  }else nav.append(mk('span','pg',(S.n||0)+' total'));
  const br=mk('button','','🔄');br.onclick=()=>req(pre+(S.p||0)+suf);
  ft.append(nav,br);els.push(ft);box.replaceChildren(...els);
}
function draw(){
  $('t_next').className='tab'+(S.v==='next'?' on':'');
  $('t_stats').className='tab'+(S.v==='stats'?' on':'');
  $('t_hist').className='tab'+(S.v==='hist'?' on':'');
  $('t_srch').className=S.v==='srch'?'on':'';
  const box=$('body');
  if(S.v==='stats')drawStats(box);
  else if(S.v==='hist'||S.v==='srch')drawList(box);
  else drawNext(box);
}
$('t_next').onclick=()=>req('flight:tab:next');
$('t_stats').onclick=()=>req('flight:tab:stats');
$('t_hist').onclick=()=>req('flight:tab:hist');
$('t_srch').onclick=()=>req('flight:ask_search','Reply in chat with airport or flight ↓');
if(TW){TW.onEvent('chatDataChanged',()=>{load();expId=null;draw();});TW.ready&&TW.ready();}
load();draw();
</script>`;

export const FLIGHT_CARD_HTML = `<style>
body{margin:0;padding:0;font-family:system-ui,sans-serif;font-size:var(--tg-text-font-size,15px);line-height:1.35;color:var(--tg-theme-text-color)}
.w{padding:10px 12px max(10px,env(safe-area-inset-bottom)) 12px}
.hd,.rt,.acts{display:flex;justify-content:space-between;align-items:center;gap:8px}
.hd{margin-bottom:6px}
.bdg{font-size:12px;padding:2px 8px;border-radius:99px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-accent-text-color);font-weight:600}
.card{background:var(--tg-theme-secondary-bg-color);border-radius:10px;padding:10px;margin-bottom:8px}
.iata{font-size:22px;font-weight:700}
.sub{font-size:12px;color:var(--tg-theme-hint-color)}
.meta{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:13px;color:var(--tg-theme-subtitle-text-color);margin-top:6px}
.acts{justify-content:flex-start}
button{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:0;cursor:pointer;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
.del{color:var(--tg-theme-destructive-text-color)}
.arm{background:var(--tg-theme-destructive-text-color);color:var(--tg-theme-button-text-color);font-weight:600}
.err{font-size:12px;color:var(--tg-theme-destructive-text-color);margin-top:4px}
</style>
<div class="w">
  <div class="hd"><span class="bdg" id="kd"></span><span class="sub" id="fn"></span></div>
  <div class="card">
    <div class="rt">
      <div><div class="iata" id="d"></div><div class="sub" id="dc"></div></div>
      <div class="sub" id="mid">✈</div>
      <div style="text-align:right"><div class="iata" id="a"></div><div class="sub" id="ac"></div></div>
    </div>
    <div class="meta" id="mt"></div>
  </div>
  <div class="acts" id="acts"></div>
  <div class="err" id="err" hidden></div>
</div>
<script>
const TW=window.TelegramWidget,$=(id)=>document.getElementById(id);
let P={},C={del:0},arm=false,armT=0,cp=false;
function parse(s){try{return JSON.parse(s);}catch{return null;}}
function sync(){const p=parse(TW&&TW.publicData),c=parse(TW&&TW.chatData);if(p)P=p;if(c&&c.del!==undefined)C=c;}
function draw(){
  $('kd').textContent=P.k==='remind'?'⏰ Flight Tomorrow':'✈️ New Flight Imported';
  $('fn').textContent=(P.fn||'')+(P.eq?' · '+P.eq:'');
  $('d').textContent=P.d||'---';$('dc').textContent=P.dc||'';
  $('mid').textContent='✈'+(P.km?(' '+P.km+' km'):'');
  $('a').textContent=P.a||'---';$('ac').textContent=P.ac||'';
  const bits=['📅 '+(P.dt||''),'🕒 '+(P.dt_t||'TBD')+' → '+(P.ar_t||'TBD')];
  if(P.cb||P.st)bits.push('💺 '+[P.cb,P.st].filter(Boolean).join(' / '));
  $('mt').replaceChildren(...bits.map((t)=>{const s=document.createElement('span');s.textContent=t;return s;}));
  const acts=$('acts');
  if(C.del){const s=document.createElement('span');s.className='sub';s.textContent='✓ Import Removed';acts.replaceChildren(s);return;}
  const els=[];
  if(P.pnr){
    const bc=document.createElement('button');
    bc.textContent=cp?'Copied ✓':'📋 PNR: '+P.pnr;
    bc.onclick=()=>{if(TW){TW.copyText(P.pnr);TW.HapticFeedback&&TW.HapticFeedback.notificationOccurred('success');}cp=true;draw();setTimeout(()=>{cp=false;draw();},1500);};
    els.push(bc);
  }
  if(P.k==='import'&&P.id){
    const bd=document.createElement('button');
    bd.className=arm?'arm':'del';
    bd.textContent=arm?'Confirm Delete?':'🗑 Undo Import';
    bd.onclick=()=>{
      if(!TW)return;
      if(!arm){arm=true;TW.HapticFeedback&&TW.HapticFeedback.impactOccurred('light');draw();clearTimeout(armT);armT=setTimeout(()=>{arm=false;draw();},3000);return;}
      clearTimeout(armT);arm=false;bd.disabled=true;bd.textContent='Removing...';
      TW.request('flight:del:'+P.id).then((r)=>{
        const o=parse(r&&r.result);
        if(o&&o.del){C.del=1;TW.HapticFeedback&&TW.HapticFeedback.notificationOccurred('success');}
        else if(o&&o.error){$('err').textContent=o.error;$('err').hidden=false;}
        draw();
      },(e)=>{$('err').textContent='Error: '+e.code;$('err').hidden=false;draw();});
    };
    els.push(bd);
  }
  acts.replaceChildren(...els);
}
if(TW){TW.onEvent('chatDataChanged',()=>{sync();draw();});TW.onEvent('publicDataChanged',()=>{sync();draw();});TW.ready&&TW.ready();}
sync();draw();
</script>`;

export const AIRPORT_REVIEW_HTML = `<style>
body{margin:0;padding:0;font-family:system-ui,sans-serif;font-size:var(--tg-text-font-size,15px);line-height:1.35;color:var(--tg-theme-text-color)}
.w{padding:10px 12px max(10px,env(safe-area-inset-bottom)) 12px}
.hd,.acts{display:flex;justify-content:space-between;align-items:center;gap:8px}
.hd{margin-bottom:6px}
.ttl{font-weight:700}
.bdg{font-size:12px;padding:2px 8px;border-radius:99px;background:var(--tg-theme-secondary-bg-color);font-weight:600}
.low{color:var(--tg-theme-destructive-text-color)}
.kv{display:flex;justify-content:space-between;gap:8px;padding:2px 0;font-size:14px}
.lbl{color:var(--tg-theme-hint-color)}
.rsn{margin:6px 0;padding:8px;border-radius:8px;background:var(--tg-theme-secondary-bg-color);font-size:13px}
.acts{justify-content:flex-start;margin-top:8px}
button{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:0;cursor:pointer;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
.pri{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color);font-weight:600}
.del{color:var(--tg-theme-destructive-text-color)}
.arm{background:var(--tg-theme-destructive-text-color);color:var(--tg-theme-button-text-color);font-weight:600}
.err{font-size:12px;color:var(--tg-theme-destructive-text-color);margin-top:4px}
</style>
<div class="w">
  <div class="hd"><span class="ttl" id="hd"></span><span class="bdg" id="cf"></span></div>
  <div class="kv"><span class="lbl">Name</span><span id="nm"></span></div>
  <div class="kv"><span class="lbl">City</span><span id="ct"></span></div>
  <div class="kv"><span class="lbl">Coords</span><span id="ll"></span></div>
  <div class="kv"><span class="lbl">Timezone</span><span id="tz"></span></div>
  <div class="rsn" id="rs" hidden></div>
  <div class="acts" id="acts"></div>
  <div class="err" id="err" hidden></div>
</div>
<script>
const TW=window.TelegramWidget,$=(id)=>document.getElementById(id);
let P={},C={st:'new'},arm=false,armT=0;
function parse(s){try{return JSON.parse(s);}catch{return null;}}
function sync(){const p=parse(TW&&TW.publicData),c=parse(TW&&TW.chatData);if(p)P=p;if(c&&c.st)C=c;}
function act(cmd){
  if(!TW)return;
  TW.request(cmd).then((r)=>{
    const o=parse(r&&r.result);
    if(o&&o.st){C.st=o.st;TW.HapticFeedback&&TW.HapticFeedback.notificationOccurred('success');}
    else if(o&&o.error){$('err').textContent=o.error;$('err').hidden=false;}
    draw();
  },(e)=>{$('err').textContent='Error: '+e.code;$('err').hidden=false;draw();});
}
function draw(){
  const low=P.conf==='low';
  $('hd').textContent='✨ Airport: '+(P.iata||'');
  $('cf').className='bdg'+(low?' low':'');
  $('cf').textContent=low?'⚠️ Low Confidence':('Confidence: '+(P.conf||'high'));
  $('nm').textContent=P.name||'';
  $('ct').textContent=[P.city,P.co].filter(Boolean).join(', ');
  $('ll').textContent=P.lat!==undefined?(P.lat+', '+P.lng):'';
  $('tz').textContent=P.tz||'Unknown';
  $('rs').textContent=P.rsn?('⚠️ '+P.rsn):'';$('rs').hidden=!P.rsn;
  const acts=$('acts'),els=[];
  if(P.lat!==undefined&&P.lng!==undefined){
    const bm=document.createElement('button');bm.textContent='🗺 Maps';
    bm.onclick=()=>{if(TW)TW.openLink('https://www.google.com/maps?q='+P.lat+','+P.lng);};
    els.push(bm);
  }
  if(C.st==='kept'){const s=document.createElement('span');s.className='lbl';s.textContent='✓ Kept';els.push(s);}
  else if(C.st==='deleted'){const s=document.createElement('span');s.className='lbl';s.textContent='🗑 Deleted';els.push(s);}
  else if(low&&P.iata){
    const bk=document.createElement('button');bk.className='pri';bk.textContent='✓ Keep';
    bk.onclick=()=>act('airport:keep:'+P.iata);
    const bd=document.createElement('button');bd.className=arm?'arm':'del';bd.textContent=arm?'Confirm?':'🗑 Delete';
    bd.onclick=()=>{
      if(!arm){arm=true;TW&&TW.HapticFeedback&&TW.HapticFeedback.impactOccurred('light');draw();clearTimeout(armT);armT=setTimeout(()=>{arm=false;draw();},3000);return;}
      clearTimeout(armT);arm=false;act('airport:del:'+P.iata);
    };
    els.push(bk,bd);
  }
  acts.replaceChildren(...els);
}
if(TW){TW.onEvent('chatDataChanged',()=>{sync();draw();});TW.onEvent('publicDataChanged',()=>{sync();draw();});TW.ready&&TW.ready();}
sync();draw();
</script>`;
