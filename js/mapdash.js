/* =========================================================================
   MAPDASH — world geography trainer.
   Solo drilling + timed 1v1 races.  Works with no backend at all; lights up
   accounts, cloud progress and online matches when config.js is filled in.
   ========================================================================= */
(function(){
"use strict";

const DATA = window.MAPDASH_DATA;
const CFG  = window.MAPDASH_CONFIG || {};

/* ---------------------------------------------------------------- topology */
const T = DATA.t, META = DATA.m, TR = T.transform;

function decodeArcs(){
  return T.arcs.map(arc=>{
    let x=0,y=0; const out=new Array(arc.length);
    for(let i=0;i<arc.length;i++){
      x+=arc[i][0]; y+=arc[i][1];
      out[i]=[x*TR.scale[0]+TR.translate[0], y*TR.scale[1]+TR.translate[1]];
    }
    return out;
  });
}
const ARCS = decodeArcs();

function stitch(idxs){
  const out=[];
  for(const i of idxs){
    const a = i<0 ? ARCS[~i].slice().reverse() : ARCS[i];
    if(out.length) for(let j=1;j<a.length;j++) out.push(a[j]);
    else out.push.apply(out,a);
  }
  return out;
}
function polygons(g){                       // -> array of rings (lon/lat)
  if(g.type==='Polygon')      return g.arcs.map(stitch);
  if(g.type==='MultiPolygon') return g.arcs.flatMap(p=>p.map(stitch));
  return [];
}

/* -------------------------------------------------------------- projection */
/* Robinson — the classic wall-map look. */
const RT=[[1,0],[.9986,.062],[.9954,.124],[.99,.186],[.9822,.248],[.973,.31],
          [.96,.372],[.9427,.434],[.9216,.4958],[.8962,.5571],[.8679,.6176],
          [.835,.6769],[.7986,.7346],[.7597,.7903],[.7186,.8435],[.6732,.8936],
          [.6213,.9394],[.5722,.9761],[.5322,1]];
const VW = 1000, K0 = VW/(2*0.8487*Math.PI), VH = 2*1.3523*K0;
function proj(lon,lat){
  const a=Math.min(Math.abs(lat),90)/5, i=Math.min(Math.floor(a),17), t=a-i;
  const X=RT[i][0]+(RT[i+1][0]-RT[i][0])*t, Y=RT[i][1]+(RT[i+1][1]-RT[i][1])*t;
  return [VW/2 + 0.8487*X*(lon*Math.PI/180)*K0,
          VH/2 - 1.3523*Y*(lat<0?-1:1)*K0];
}

/* --- antimeridian handling: Russia, Fiji & Kiribati would otherwise smear
       a horizontal band right across the map --------------------------- */
function unwrap(r){
  const out=[r[0].slice()];
  for(let i=1;i<r.length;i++){
    let lon=r[i][0]; const prev=out[i-1][0];
    while(lon-prev>180) lon-=360;
    while(prev-lon>180) lon+=360;
    out.push([lon,r[i][1]]);
  }
  return out;
}
function clipEdge(pts,c,dir){
  const res=[], inside=p=> dir>0 ? p[0]>=c : p[0]<=c;
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length], ia=inside(a), ib=inside(b);
    if(ia) res.push(a);
    if(ia!==ib && b[0]!==a[0]){ const t=(c-a[0])/(b[0]-a[0]); res.push([c, a[1]+(b[1]-a[1])*t]); }
  }
  return res;
}
function splitRing(raw){
  const u=unwrap(raw); let mn=1e9,mx=-1e9;
  for(const p of u){ if(p[0]<mn)mn=p[0]; if(p[0]>mx)mx=p[0]; }
  if(mn>=-180.5 && mx<=180.5) return [u];
  const out=[];
  for(const sh of [0,360,-360]){
    if(mn+sh>180 || mx+sh<-180) continue;
    const cl=clipEdge(clipEdge(u.map(p=>[p[0]+sh,p[1]]),-180,1),180,-1);
    if(cl.length>=3) out.push(cl);
  }
  return out.length?out:[u];
}

/* Big enough on paper, but a nightmare to actually click: Timor-Leste is a
   sliver sharing an island in the middle of the Indonesian archipelago, and
   Kuwait is a notch on the Gulf between two much larger neighbours. */
const DOT_ALSO = new Set(['TLS','KWT']);
const DOT_R = 1.8;                             // every dot, identical

/* ------------------------------------------------------------------ countries */
const C = {};                                  // code -> country record
const ALL = [];
const GROUPED = new Map();                     // some states appear as >1 geometry
for(const g of T.objects.countries.geometries){
  if(!META[g.id]) continue;
  const cur = GROUPED.get(g.id) || [];
  GROUPED.set(g.id, cur.concat(polygons(g).flatMap(splitRing)));
}
for(const [code, rings] of GROUPED){
  const m = META[code];
  let d='', x0=1e9,y0=1e9,x1=-1e9,y1=-1e9, best=null, bestA=-1;
  for(const r of rings){
    if(r.length<3) continue;
    let s='', A=0, bx0=1e9,by0=1e9,bx1=-1e9,by1=-1e9;
    for(let i=0;i<r.length;i++){
      const p=proj(r[i][0],r[i][1]);
      s += (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1);
      if(p[0]<bx0)bx0=p[0]; if(p[0]>bx1)bx1=p[0];
      if(p[1]<by0)by0=p[1]; if(p[1]>by1)by1=p[1];
      const q=proj(r[(i+1)%r.length][0], r[(i+1)%r.length][1]);
      A += p[0]*q[1]-q[0]*p[1];
    }
    A=Math.abs(A)/2;
    d += s+'Z';
    if(A>bestA){bestA=A;best=[bx0,by0,bx1,by1];}
    if(bx0<x0)x0=bx0; if(bx1>x1)x1=bx1; if(by0<y0)y0=by0; if(by1>y1)y1=by1;
  }
  if(!d){                                   // micro-state collapsed by simplification
    const p=proj(m.ll[1],m.ll[0]), r=1.1;
    d=`M${(p[0]-r).toFixed(1)} ${p[1].toFixed(1)}L${p[0].toFixed(1)} ${(p[1]-r).toFixed(1)}`+
      `L${(p[0]+r).toFixed(1)} ${p[1].toFixed(1)}L${p[0].toFixed(1)} ${(p[1]+r).toFixed(1)}Z`;
    x0=p[0]-r;y0=p[1]-r;x1=p[0]+r;y1=p[1]+r; best=[x0,y0,x1,y1];
  }
  /* Fiji / Russia / Kiribati straddle the antimeridian → bbox spans the globe.
     Use the largest single ring for framing instead. */
  const wide = (x1-x0) > VW*0.55;
  const bb = wide ? best : [x0,y0,x1,y1];
  const rec = {
    code, name:m.n, official:m.o, iso2:m.a2, capital:m.cap,
    /* split "Americas" the way people actually think about it */
    region: m.reg==='Americas' ? (m.sub==='South America'?'South America':'North America') : m.reg,
    sub:m.sub, un:!!m.un, indep:!!m.ind, area:m.ar, flag:m.fl, ll:m.ll,
    alt:m.alt||[], borders:m.bd||[], d, bb,
    cx:(bb[0]+bb[2])/2, cy:(bb[1]+bb[3])/2,
    span:Math.max(bb[2]-bb[0], bb[3]-bb[1])
  };
  const p = proj(m.ll[1], m.ll[0]);
  if(rec.span < 3){ rec.cx=p[0]; rec.cy=p[1]; }
  /* Needs a dot if you cannot see it. Bounding-box span alone is the wrong
     test: a scattered archipelago like Tonga or Kiribati has a huge bbox and
     is still invisible, because every island is a sub-pixel speck. What
     matters is the LARGEST single landmass — that is the biggest thing there
     is to aim at. bestA is measured in square map units (world = 1000 wide). */
  /* Dots are for things you genuinely cannot see: compact micro-states, and
     scattered archipelagos whose biggest island is a speck. Everything else
     keeps its real shape — the map should look like a map.
     DOT_ALSO is a short, deliberate exception list for countries that are big
     enough by area but sit wedged among neighbours. */
  rec.micro = rec.span < 5 || bestA < 4 || DOT_ALSO.has(code);
  /* For a scattered one, put the dot on its biggest island rather than at the
     centre of the bounding box, which is usually open ocean. */
  if(rec.micro && rec.span >= 5 && best){
    rec.cx=(best[0]+best[2])/2; rec.cy=(best[1]+best[3])/2;
  }
  /* One size for every dot. Deriving it from the country's own geometry made
     Micronesia a radius-35 blob and left the rest visibly mismatched; a marker
     is a marker, so they are all identical and sizeDots keeps them at a
     constant number of screen pixels whatever the zoom. */
  rec.dotR = DOT_R;
  rec.wide  = wide;                       // bbox is unreliable (crosses the antimeridian)
  C[code]=rec; ALL.push(rec);
}
ALL.sort((a,b)=>b.span-a.span);              // big first → small on top
const SOVEREIGN = ALL.filter(c=>c.un || c.code==='PSE').map(c=>c.code);
const EVERY     = ALL.map(c=>c.code);
const REGIONS = ['Africa','Asia','Europe','North America','South America','Oceania'];
const SUBS = {};
ALL.forEach(c=>{ if(c.sub){ (SUBS[c.region]=SUBS[c.region]||new Set()).add(c.sub); }});

/* ------------------------------------------------------------------- helpers */
const $  = s=>document.querySelector(s);
const el = (t,a,h)=>{const e=document.createElementNS(t.startsWith('svg:')?'http://www.w3.org/2000/svg':'http://www.w3.org/1999/xhtml',t.replace('svg:',''));
  if(a)for(const k in a)e.setAttribute(k,a[k]); if(h!=null)e.textContent=h; return e;};
const S = t=>document.createElementNS('http://www.w3.org/2000/svg',t);
const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
                 .replace(/[^a-z0-9]+/g,'');
const fmt = n => n.toLocaleString('en-US');
const shuffle = a=>{for(let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];}return a;};
function lev(a,b){
  if(a===b)return 0; const m=a.length,n=b.length; if(!m||!n)return m||n;
  let prev=Array.from({length:n+1},(_,i)=>i), cur=new Array(n+1);
  for(let i=1;i<=m;i++){cur[0]=i;
    for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    [prev,cur]=[cur,prev];
  } return prev[n];
}

/* --------------------------------------------------------------- persistence */
const STORE='mapdash.v1';
/* Carried over from the old name so nobody loses their local progress in the
   rebrand. Runs once: after the first save the new key is authoritative. */
try{
  if(!localStorage.getItem(STORE)){
    const old=localStorage.getItem('terra.v1');
    if(old) localStorage.setItem(STORE, old);
  }
}catch(e){}
let store = {mastery:{}, totals:{q:0,c:0}, best:{}, recent:[]};
try{ const raw=localStorage.getItem(STORE); if(raw) store=Object.assign(store,JSON.parse(raw)); }catch(e){}
let saveT=null;
function save(){ clearTimeout(saveT); saveT=setTimeout(()=>{ try{localStorage.setItem(STORE,JSON.stringify(store));}catch(e){} },250); }
const M = code => store.mastery[code] || (store.mastery[code]={m:0,s:0,c:0,st:0});
/* Mastery is about whether you can recall it NOW, not about your worst day.
   Clean recalls in a row pull you up to a floor, so a place you genuinely
   know reaches 100% and stays there. A miss knocks you back but the streak
   floor means you can always climb out. */
function record(code, ok, weight){
  const w = weight==null?1:weight;
  const r=M(code); r.s++;
  if(ok){
    r.c++; r.st++;
    r.m = r.m+(1-r.m)*0.62*w;
    if(w>=1){                                  // clean, unaided recall only
      if(r.st>=2) r.m=Math.max(r.m,0.80);
      if(r.st>=3) r.m=Math.max(r.m,0.92);
      if(r.st>=4) r.m=1;                       // mastered — reachable, not asymptotic
    }
  }
  else { r.st=0; r.m = r.m*0.32; }
  store.totals.q++; if(ok&&w>=1) store.totals.c++;
  if(!Array.isArray(store.recent)) store.recent=[];
  store.recent.push(ok&&w>=1?1:0);             // rolling window of your last 100
  if(store.recent.length>100) store.recent.shift();
  save();
  if(typeof markDirty==='function') markDirty(code);
}

/* ================================================================== THE MAP */
const svg=$('#map'), wrap=$('#mapwrap');
svg.setAttribute('viewBox',`0 0 ${VW} ${VH.toFixed(1)}`);
svg.setAttribute('preserveAspectRatio','xMidYMid meet');

const gRoot=S('g'); svg.appendChild(gRoot);
const gGrat=S('g'); gRoot.appendChild(gGrat);
const gLand=S('g'); gRoot.appendChild(gLand);
const gDots=S('g'); gRoot.appendChild(gDots);
const gFx  =S('g'); svg.appendChild(gFx);      // screen-space overlays
const gLbl =S('g'); svg.appendChild(gLbl);

/* graticule + ocean */
(function(){
  const ocean=S('rect'); ocean.setAttribute('x',0);ocean.setAttribute('y',0);
  ocean.setAttribute('width',VW);ocean.setAttribute('height',VH);
  ocean.setAttribute('fill','var(--sea)'); gGrat.appendChild(ocean);
  const mk=d=>{const p=S('path');p.setAttribute('d',d);p.setAttribute('class','grat');gGrat.appendChild(p);};
  for(let lat=-80;lat<=80;lat+=20){
    let d=''; for(let lon=-180;lon<=180;lon+=5){const p=proj(lon,lat);d+=(lon===-180?'M':'L')+p[0].toFixed(1)+' '+p[1].toFixed(1);} mk(d);
  }
  for(let lon=-180;lon<=180;lon+=20){
    let d=''; for(let lat=-90;lat<=90;lat+=5){const p=proj(lon,lat);d+=(lat===-90?'M':'L')+p[0].toFixed(1)+' '+p[1].toFixed(1);} mk(d);
  }
  const eq=S('path'); let d='';
  for(let lon=-180;lon<=180;lon+=5){const p=proj(lon,0);d+=(lon===-180?'M':'L')+p[0].toFixed(1)+' '+p[1].toFixed(1);}
  eq.setAttribute('d',d); eq.setAttribute('class','grat'); eq.setAttribute('stroke','#2a4258'); gGrat.appendChild(eq);
})();

const NODE={}, HIT={}, DOT={}, DOTS=[];
for(const c of ALL){
  const p=S('path'); p.setAttribute('d',c.d); p.setAttribute('class','c');
  p.dataset.code=c.code; gLand.appendChild(p); NODE[c.code]=p;
}
for(const c of ALL){
  if(!c.micro) continue;
  const dot=S('circle'); dot.setAttribute('cx',c.cx);dot.setAttribute('cy',c.cy);
  dot.setAttribute('r', c.dotR); dot.setAttribute('class','dot');
  dot.dataset.code=c.code; gDots.appendChild(dot);
  const h=S('circle'); h.setAttribute('cx',c.cx);h.setAttribute('cy',c.cy);
  h.setAttribute('r',4.5); h.setAttribute('class','hit'); h.dataset.code=c.code;
  gDots.appendChild(h); HIT[c.code]=h;
  DOT[c.code]=dot; DOTS.push({dot, hit:h, base:c.dotR});
}
function sizeDots(){
  const rect=svg.getBoundingClientRect();
  const scale=(rect.width||1500)/VW*view.k;         // map units -> screen px, at current zoom
  const MIN_PX=4.5, CAND_PX=8.5, MIN_HIT_PX=15, CAND_HIT_PX=22;
  for(const d of DOTS){
    const isCand=d.dot.classList.contains('cand');
    const floor=isCand?CAND_PX:MIN_PX;
    const naturalPx=d.base*scale;
    const px=Math.max(floor, naturalPx);
    d.dot.setAttribute('r', (px/scale).toFixed(3));
    const hitFloor=isCand?CAND_HIT_PX:MIN_HIT_PX;
    d.hit.setAttribute('r', (Math.max(hitFloor, px+8)/scale).toFixed(3));
  }
}

/* ---- viewport ---- */
let view={k:1,tx:0,ty:0};
function applyView(){ gRoot.setAttribute('transform',`translate(${view.tx} ${view.ty}) scale(${view.k})`);
  gDots.style.display = view.k>10 ? 'none' : '';
  sizeDots(); refreshLabels(); }
function clampView(){
  view.k=Math.max(1,Math.min(60,view.k));
  const w=VW*view.k,h=VH*view.k;
  view.tx=Math.min(0,Math.max(VW-w,view.tx));
  view.ty=Math.min(0,Math.max(VH-h,view.ty));
}
function zoomAt(sx,sy,f){ const k2=Math.max(1,Math.min(60,view.k*f));
  const r=k2/view.k; view.tx=sx-(sx-view.tx)*r; view.ty=sy-(sy-view.ty)*r; view.k=k2;
  clampView(); applyView(); }
let animT=null;
function flyTo(bb,pad,ms){
  pad=pad||2.4; ms=ms==null?520:ms;
  const w=Math.max(bb[2]-bb[0],4), h=Math.max(bb[3]-bb[1],4);
  const k=Math.max(1,Math.min(30, Math.min(VW/(w*pad), VH/(h*pad))));
  const cx=(bb[0]+bb[2])/2, cy=(bb[1]+bb[3])/2;
  const to={k, tx:VW/2-cx*k, ty:VH/2-cy*k};
  const t2={...to}; const sv={...view};
  (function(){ const s={...view}; view.k=t2.k;view.tx=t2.tx;view.ty=t2.ty;clampView();
     t2.k=view.k;t2.tx=view.tx;t2.ty=view.ty; view.k=s.k;view.tx=s.tx;view.ty=s.ty; })();
  cancelAnimationFrame(animT); const t0=performance.now();
  (function step(t){ const u=Math.min(1,(t-t0)/ms), e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
    view.k=sv.k+(t2.k-sv.k)*e; view.tx=sv.tx+(t2.tx-sv.tx)*e; view.ty=sv.ty+(t2.ty-sv.ty)*e;
    applyView(); if(u<1) animT=requestAnimationFrame(step);
  })(t0);
}
function resetView(){ flyTo([0,0,VW,VH],1.0,420); }
function toMap(ev){
  const pt=svg.createSVGPoint(); pt.x=ev.clientX; pt.y=ev.clientY;
  const m=gRoot.getScreenCTM(); if(!m) return null;
  const q=pt.matrixTransform(m.inverse()); return [q.x,q.y];
}
function toRoot(ev){
  const pt=svg.createSVGPoint(); pt.x=ev.clientX; pt.y=ev.clientY;
  const m=svg.getScreenCTM(); const q=pt.matrixTransform(m.inverse()); return [q.x,q.y];
}

/* pan + zoom input */
let drag=null;
svg.addEventListener('pointerdown',e=>{ drag={x:e.clientX,y:e.clientY,tx:view.tx,ty:view.ty,moved:0};
  if(svg.setPointerCapture) svg.setPointerCapture(e.pointerId); svg.classList.add('drag'); });
svg.addEventListener('pointermove',e=>{
  if(drag){ const r=svg.getBoundingClientRect(); const sc=VW/r.width;
    view.tx=drag.tx+(e.clientX-drag.x)*sc; view.ty=drag.ty+(e.clientY-drag.y)*sc;
    drag.moved+=Math.abs(e.movementX)+Math.abs(e.movementY); clampView(); applyView(); }
  else if(!hovRAF){ const ev={clientX:e.clientX,clientY:e.clientY};
    hovRAF=requestAnimationFrame(()=>{ hovRAF=0; hover(ev); }); }
});
svg.addEventListener('pointerup',e=>{ const d=drag; drag=null; svg.classList.remove('drag');
  if(d && d.moved<5) click(e); });
svg.addEventListener('pointerleave',()=>{ $('#readout').style.display='none'; setHover(null); });
svg.addEventListener('wheel',e=>{
  e.preventDefault();
  if(e.ctrlKey||e.metaKey){                      // pinch-to-zoom / ctrl+wheel
    const p=toRoot(e); zoomAt(p[0],p[1], Math.exp(-e.deltaY*0.012));
  } else {                                       // two-finger swipe / wheel = pan
    const r=svg.getBoundingClientRect(), sc=VW/r.width;
    view.tx-=e.deltaX*sc; view.ty-=e.deltaY*sc; clampView(); applyView();
  }
},{passive:false});
svg.addEventListener('dblclick',e=>{ const p=toRoot(e); zoomAt(p[0],p[1],1.9); });
$('#zin').onclick =()=>zoomAt(VW/2,VH/2,1.5);
$('#zout').onclick=()=>zoomAt(VW/2,VH/2,1/1.5);
$('#zreset').onclick=resetView;

/* ------------------------------------------------------------ hit testing
   Real geometry, smallest country first (so enclaves like the Vatican or
   Lesotho beat the country wrapping around them), a screen-sized grab radius
   for the micro-states, and a forgiving spiral snap when you land just off
   the coast. Everything is measured in screen pixels, so it feels identical
   at every zoom level.                                                     */
const BYSIZE = ALL.slice().sort((a,b)=>a.span-b.span);
let SVGPT=null;
function mapPoint(x,y){ if(!SVGPT) SVGPT=svg.createSVGPoint(); SVGPT.x=x; SVGPT.y=y; return SVGPT; }
function pxToMap(px){                      // css pixels -> gRoot user units
  const r=svg.getBoundingClientRect(); if(!r.width) return px;
  return px*(VW/r.width)/view.k;
}
function isActive(code){ const n=NODE[code]; return n && n.classList.contains('act'); }
function inFill(c,p){
  const n=NODE[c.code]; if(!n||!n.isPointInFill) return false;
  if(!c.wide){                                  // cheap bbox reject first
    const e=0.5;
    if(p[0]<c.bb[0]-e||p[0]>c.bb[2]+e||p[1]<c.bb[1]-e||p[1]>c.bb[3]+e) return false;
  }
  try{ return n.isPointInFill(mapPoint(p[0],p[1])); }catch(e){ return false; }
}
const GEOM_OK = (function(){ const n=NODE[ALL[0].code]; return !!(n && n.isPointInFill); })();
/* exact: what is literally under the cursor.
   Real polygons win, smallest first. Micro-state dots only beat the country
   they sit inside once you have zoomed in — otherwise clicking Rome would
   hand you the Vatican. Island micro-states always get the generous dot.   */
function pickExact(p){
  /* Micro-states are hit-tested by polygon TOO, not dot-only. Scattered
     archipelagos (Bahamas, Vanuatu, Cape Verde) get a dot on their biggest
     island, but their other islands still have to be clickable. Smallest-first
     with a break means an enclave still beats the country around it. */
  let solid=null;
  for(const c of BYSIZE){
    if(!isActive(c.code)) continue;
    if(inFill(c,p)){ solid=c.code; break; }
  }
  const grabBase=pxToMap(15), grabCand=pxToMap(22);
  let dot=null, bd=Infinity;
  for(const c of BYSIZE){
    if(!c.micro || !isActive(c.code)) continue;
    const dn=DOT[c.code];
    const grab=(dn && dn.classList.contains('cand')) ? grabCand : grabBase;
    const d=Math.hypot(c.cx-p[0], c.cy-p[1]);
    if(d<=grab && d<bd){ bd=d; dot=c.code; }
  }
  if(dot && (!solid || view.k>=4)) return dot;
  return solid || dot || null;
}
/* forgiving: exact, then spiral outwards up to ~20px */
const SNAP_RINGS=[7,13,20];
function pick(ev){
  if(!GEOM_OK) return legacyPick(ev);
  const p=toMap(ev); if(!p) return legacyPick(ev);
  const hit=pickExact(p); if(hit) return hit;
  for(const rpx of SNAP_RINGS){
    const r=pxToMap(rpx);
    for(let a=0;a<12;a++){
      const th=a/12*Math.PI*2;
      const q=[p[0]+Math.cos(th)*r, p[1]+Math.sin(th)*r];
      const h=pickExact(q); if(h) return h;
    }
  }
  return null;
}
function legacyPick(ev){
  const t=document.elementFromPoint(ev.clientX,ev.clientY);
  return (t && t.dataset && t.dataset.code) ? t.dataset.code : null;
}
/* live highlight of whatever a click would select */
let hovCode=null, hovRAF=0;
function setHover(code){
  if(code===hovCode) return;
  if(hovCode){ if(NODE[hovCode]) NODE[hovCode].classList.remove('hov');
               if(DOT[hovCode]) DOT[hovCode].classList.remove('hov'); }
  hovCode=code;
  if(hovCode){ if(NODE[hovCode]) NODE[hovCode].classList.add('hov');
               if(DOT[hovCode]) DOT[hovCode].classList.add('hov'); }
}

/* ---- paint helpers ---- */
const TRANSIENT=['good','bad','sel','target','hint','nbr','cand','zone'];
let painted=[];
function clearPaint(){ painted.forEach(c=>{ if(NODE[c]) NODE[c].classList.remove(...TRANSIENT);
    if(DOT[c]) DOT[c].classList.remove(...TRANSIENT); });
  painted=[]; gLbl.innerHTML=''; sizeDots(); }
function paint(code,cls){ const n=NODE[code]; if(!n)return; n.classList.add(cls);
  if(DOT[code]) DOT[code].classList.add(cls);
  painted.push(code); sizeDots(); }
/* countries already found this session keep their green permanently */
function markDone(code){
  if(NODE[code]) NODE[code].classList.add('done');
  if(DOT[code])  DOT[code].classList.add('done');
}
function markShown(code){ if(NODE[code]) NODE[code].classList.add('shown'); if(DOT[code]) DOT[code].classList.add('shown'); }
function clearDone(){
  for(const c of ALL){ NODE[c.code].classList.remove('done','shown');
    if(DOT[c.code]) DOT[c.code].classList.remove('done','shown'); }
}
function repaintDone(){
  const s=state.session; clearDone();
  if(!s) return;
  if(s.shown)  s.shown.forEach(markShown);
  if(s.solved) s.solved.forEach(markDone);
}
function setActive(codes){
  const set=new Set(codes);
  for(const c of ALL){
    const n=NODE[c.code]; const on=set.has(c.code);
    n.classList.toggle('act',on); n.classList.toggle('dim',!on);
    if(DOT[c.code]) DOT[c.code].classList.toggle('dim',!on);
  }
}
function ping(x,y,color){
  const c=S('circle'); c.setAttribute('cx',x*view.k+view.tx);c.setAttribute('cy',y*view.k+view.ty);
  c.setAttribute('class','ping'); c.setAttribute('stroke',color);
  gFx.appendChild(c); setTimeout(()=>c.remove(),750);
}
let labels=[];
function refreshLabels(){
  gLbl.innerHTML='';
  for(const L of labels){
    const t=S('text'); t.setAttribute('x',L.x*view.k+view.tx); t.setAttribute('y',L.y*view.k+view.ty-6);
    t.setAttribute('class','plabel'); t.textContent=L.text; gLbl.appendChild(t);
  }
}
function label(code,text){ const c=C[code]; if(!c)return; labels.push({x:c.cx,y:c.cy,text:text||c.name}); refreshLabels(); }
function clearLabels(){ labels=[]; gLbl.innerHTML=''; }

/* hover readout */
const ro=$('#readout');
function hover(e){
  const s=state.session;
  const inPlay = (state.view==='play'||state.view==='versus') && s && !s.done;
  const code=pick(e);
  setHover(inPlay && state.mode!=='name' && state.mode!=='capname' ? code : (inPlay?null:code));
  /* mid-round the readout is sealed: it only names countries you've already
     dealt with, so it can never hand you the answer. */
  if(inPlay && !(code && (s.solved.has(code) || s.shown.has(code)))){ ro.style.display='none'; return; }
  if(!code || (state.scopeSet && !state.scopeSet.has(code))){ ro.style.display='none'; return; }
  const c=C[code]; ro.style.display='block';
  ro.innerHTML=`${c.flag} <b>${c.name}</b><br><span style="font-size:11.5px">${c.capital?c.capital+' · ':''}${c.sub||c.region}</span>`;
}

/* =============================================================== APP STATE */
const state={
  view:'play', mode:'find', region:'all',
  scopeSet:new Set(SOVEREIGN),
  timerOn:false, adaptive:true,
  session:null, lesson:null, selected:null, atlasQ:'',
  race:null, vsView:'lobby', vsErr:'', joinCode:''
};

function scopeCodes(){
  let list = SOVEREIGN.map(c=>C[c]);
  if(state.region!=='all') list=list.filter(c=>c.region===state.region);
  return list.map(c=>c.code);
}
function refreshScope(){ state.scopeSet=new Set(scopeCodes()); }

/* =============================================================== SESSIONS */
function pickQuestion(pool, exclude){
  const cand=pool.filter(c=>c!==exclude);
  const src=cand.length?cand:pool;
  if(!state.adaptive) return src[(Math.random()*src.length)|0];
  let tot=0; const w=src.map(c=>{ const r=store.mastery[c];
    const m=r?r.m:0; const unseen=r?0:0.5; const x=(1-m)+0.12+unseen; tot+=x; return x; });
  let t=Math.random()*tot;
  for(let i=0;i<src.length;i++){ t-=w[i]; if(t<=0) return src[i]; }
  return src[src.length-1];
}

function startSession(opts){
  opts=opts||{};
  refreshScope();
  let pool = opts.pool || Array.from(state.scopeSet);
  if(state.mode==='capital') pool=pool.filter(c=>C[c].capital);
  if(!MODES.some(m=>m.id===state.mode)) state.mode='find';
  if(!pool.length){ alert('No countries in that selection.'); return; }
  state.session={
    pool, n:pool.length, i:0,
    correct:0, wrong:0, answered:0, streak:0, bestStreak:0, attempts:0, missedThis:false,
    missed:[], assisted:[], hints:0, solved:new Set(), shown:new Set(), splits:[],
    t0:Date.now(), mark:Date.now(), lastAnswerAt:null, current:null, hintLevel:0, done:false,
    order: opts.order ? opts.order.slice() : shuffle(pool.slice()),
    race: !!opts.race, skipped:0
  };
  if(opts.order){ state.session.pool=opts.order.slice(); state.session.n=opts.order.length; }
  state.setupStep=null; renderSetup();
  clearLabels(); clearPaint(); clearDone();
  setActive(state.session.pool);
  if(!opts.race){ state.view='play'; }
  syncTabs(); nextQuestion(); renderSide();
}

function nextQuestion(){
  const s=state.session; if(!s||s.done) return;
  clearPaint(); clearLabels();
  setActive(s.pool); repaintDone();          // any hint narrowing is wiped clean
  if(s.race && state.race && Date.now()>=state.race.endsAt){ endRace('time'); return; }
  if(s.i>=s.n){ if(s.race){ endRace('cleared'); } else { finish(); } return; }
  s.hintLevel=0; s.attempts=0; s.missedThis=false; s.ladder=null;
  s.current = s.order ? s.order[s.i] : pickQuestion(s.pool, s.last);
  s.last=s.current; s.i++;
  s.qStart=Date.now();
  if(state.mode==='name'||state.mode==='capname'){
    const c=C[s.current];
    paint(c.code,'target');
    flyTo(c.bb, c.micro?22:3.4, 400);
  }
  renderHUD(); renderStrip();
  if(state.timerOn) startTimer();
}
let timerId=null, timerLeft=0;
function startTimer(){ clearInterval(timerId); timerLeft=state.mode.includes('name')?18:12;
  timerId=setInterval(()=>{ timerLeft--; renderStrip();
    if(timerLeft<=0){ clearInterval(timerId); timeUp(); } },1000); }
function stopTimer(){ clearInterval(timerId); }
function timeUp(){ const s=state.session; if(!s||s.done) return; reveal(); }

/* Nothing is ever given away automatically — you keep trying until you get it,
   or you ask for the answer with the Reveal button / S. */
function answer(ok, clickedCode){
  const s=state.session; if(!s||s.done) return; stopTimer();
  const c=C[s.current];
  if(ok){
    const clean = !s.missedThis && s.hintLevel===0;
    if(s.hintLevel>0 && !s.missedThis) s.assisted.push(c.code);
    record(c.code, true, clean ? 1 : (s.missedThis ? 0 : 0.4));
    if(clean){ s.correct++; s.streak++; s.bestStreak=Math.max(s.bestStreak,s.streak); }
    s.solved.add(c.code); s.shown.delete(c.code); s.answered++;
    /* Splits are measured mark-to-mark, not qStart-to-answer, so they add up
       to exactly the run time. The gap between an answer and the next question
       (the 640ms celebration) belongs to somebody's split or the totals never
       reconcile and the server rejects the run. */
    { const now=Date.now();
      s.splits.push(Math.max(1, now - (s.mark||s.t0)));
      s.mark=now; s.lastAnswerAt=now;
      /* The run is over the instant the last country is clicked. stoppedAt is
         what freezes it — stopping the interval alone is not enough, because
         renderStrip() runs immediately after this and would rebuild the chip
         with a live clock and start the interval up again. */
      if(s.solved.size>=s.n){
        s.stoppedAt=now;
        stopRunClock();
        const el=document.getElementById('runclock');
        if(el) el.textContent=fmtMs(now-s.t0);
      } }
    s.current=null;                                       // block spam clicks during 640ms delay
    if(s.race) raceScored();
    clearPaint(); setActive(s.pool); repaintDone();       // hint layers vanish
    paint(c.code,'good'); label(c.code,c.name); ping(c.cx,c.cy,'#41c07a');
    feedback('ok', (clean?pickPraise()+' ':'Right — ')+c.flag+' '+c.name+(c.capital?' — '+c.capital:''));
    renderStrip(); renderSide();
    setTimeout(nextQuestion, 640);
  } else {
    if(clickedCode && s.solved.has(clickedCode)){        // already-found country: free pass
      feedback('tip', `${C[clickedCode].flag} ${C[clickedCode].name} — you already got that one.`);
      return;
    }
    s.attempts++;
    if(!s.missedThis){ s.missedThis=true; s.wrong++; s.streak=0; s.missed.push(c.code); record(c.code,false); }
    if(clickedCode && C[clickedCode]){ paint(clickedCode,'bad');
      const cc=C[clickedCode]; ping(cc.cx,cc.cy,'#ec6a6a');
      setTimeout(()=>{ if(NODE[clickedCode]) NODE[clickedCode].classList.remove('bad'); },550); }
    const extra = clickedCode&&C[clickedCode] ? `That's ${C[clickedCode].name}. ` : '';
    const dist  = clickedCode&&C[clickedCode] ? distanceCue(C[clickedCode],c) : '';
    feedback('no', extra+(dist||'Not it — keep looking.'));
    renderStrip();
  }
}
/* rough "warmer / colder" so a wrong click still teaches something */
function distanceCue(from,to){
  if(from.code===to.code) return '';
  if(from.sub===to.sub)      return 'Same neighbourhood — very close.';
  if(from.region===to.region)return 'Right continent, wrong country.';
  const km=gcDist(from,to)*6371;
  return km<1500 ? 'Getting warm.' : km<5000 ? 'Not the right part of the world.' : 'Way off — wrong side of the planet.';
}
/* only ever called by the user pressing Reveal / S */
function reveal(){
  const s=state.session; if(!s||s.done) return; stopTimer();
  const c=C[s.current];
  if(!s.missedThis){ s.missedThis=true; s.wrong++; s.streak=0; s.missed.push(c.code); record(c.code,false); }
  s.shown.add(c.code); s.answered++;
  /* Revealing the last one also ends the run — freeze the clock the same way. */
  if(s.solved.size + s.shown.size >= s.n) s.stoppedAt=Date.now();
  clearPaint(); setActive(s.pool); repaintDone();
  paint(c.code,'good'); label(c.code,c.name);
  const cx=c.cx*view.k+view.tx, cy=c.cy*view.k+view.ty;
  if(cx<0||cx>VW||cy<0||cy>VH) flyTo(c.bb, 8, 400);
  feedback('no', `${c.flag} ${c.name}${c.capital?' — '+c.capital:''}`);
  renderStrip(); renderSide();
  setTimeout(nextQuestion, 1500);
}
const PRAISE=['Correct!','Nailed it.','Yes —','Spot on.','Got it.','Exactly.','Sharp.'];
function pickPraise(){ return PRAISE[(Math.random()*PRAISE.length)|0]; }
function feedback(kind,msg){ const f=$('#fb'); if(!f)return; f.className='fb '+(kind==='ok'?'ok':kind==='tip'?'tip':'no'); f.textContent=msg; }

/* Every press narrows the field further, and steps that would not actually
   narrow anything get skipped. The last step points straight at it — but you
   still have to click it yourself. */
const HINT_STEPS = 3;          // identical for every country
const HINT_FLOOR = 4;          // never narrows tighter than this — no giveaways
function buildLadder(c, pool){
  const N=pool.length, floor=Math.min(N, HINT_FLOOR);
  const want=[Math.ceil(N*0.34), Math.ceil(N*0.12), Math.ceil(N*0.045)];
  const steps=[]; let prev=N;
  for(let i=0;i<HINT_STEPS;i++){
    let n=Math.max(floor, Math.min(want[i], prev-1));
    steps.push({set:nearest(c,pool,n)});
    prev=n;
  }
  return steps;
}
function hint(){
  const s=state.session; if(!s||s.done) return;
  const c=C[s.current];
  if(s.race){                                   // 1v1: one press, continent only
    if(s.hintLevel>0) return;
    s.hintLevel=1; s.hints++;
    const set=s.pool.filter(x=>!s.solved.has(x)||x===c.code).filter(x=>C[x].region===c.region);
    clearPaint(); setActive(set.length?set:[c.code]);
    (set.length?set:[c.code]).forEach(x=>paint(x,'cand'));
    repaintDone(); renderHintBtn();
    return;
  }
  if(state.mode==='name'||state.mode==='capname'){
    if(s.hintLevel>=HINT_STEPS) return;
    s.hintLevel++; s.hints++; renderHintBtn(); return textHint(c,s.hintLevel);
  }
  if(!s.ladder) s.ladder=buildLadder(c, s.pool.filter(x=>!s.solved.has(x)||x===c.code));
  if(s.hintLevel>=s.ladder.length) return;
  s.hints++;
  const step=s.ladder[s.hintLevel++];
  clearPaint();
  setActive(step.set);
  step.set.forEach(x=>paint(x,'cand'));     // one colour, always
  repaintDone();
  feedback('', '');
  renderHintBtn();
}
function renderHintBtn(){
  const s=state.session, b=$('#bhint'); if(!b||!s) return;
  if(s.race){ b.innerHTML = s.hintLevel ? 'Hint used' : 'Hint <kbd>H</kbd>';
    b.style.opacity = s.hintLevel ? .45 : 1; return; }
  b.innerHTML = s.hintLevel ? `Hint · ${s.hintLevel}/${HINT_STEPS} <kbd>H</kbd>` : 'Hint <kbd>H</kbd>';
  b.style.opacity = s.hintLevel>=HINT_STEPS ? .45 : 1;
}
function gcDist(a,b){                     // great-circle, so the antimeridian behaves
  const r=Math.PI/180;
  const p1=a.ll[0]*r, p2=b.ll[0]*r, dp=p2-p1, dl=(b.ll[1]-a.ll[1])*r;
  const h=Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return 2*Math.asin(Math.min(1,Math.sqrt(h)));
}
function nearest(c, pool, n){
  const list=pool.filter(x=>x!==c.code)
    .map(x=>[x, gcDist(C[x],c)])
    .sort((a,b)=>a[1]-b[1]).slice(0,Math.max(0,n-1)).map(a=>a[0]);
  return shuffle(list.concat([c.code]));
}
function maskWord(w, frac){
  const keep=Math.max(1,Math.round(w.length*frac));
  let shown=0;
  return w.split('').map(ch=>{
    if(ch===' '||ch==='-'||ch==="'") return ch;
    return (shown++ < keep) ? ch : '_';
  }).join('');
}
function textHint(c,L){
  const w = state.mode==='name' ? c.name : c.capital;
  const letters = w.replace(/[^A-Za-z]/g,'').length;
  if(L===1)      feedback('tip', `${c.sub||c.region} · ${letters} letters`);
  else if(L===2) feedback('tip', maskWord(w,0.25));
  else           feedback('tip', maskWord(w,0.5));
}

/* A run only counts for the leaderboard if it was the real thing: Classic
   mode, the whole region, every country found first time, no hints, no
   reveals, nothing skipped. Anything less and we don't submit. */
function isCleanRun(s){
  if(state.mode!=='find' || s.race) return false;
  // Must be the WHOLE region, not a drill subset and not a session cut short.
  // ("End session" rewrites s.n to s.i, so n is not trustworthy on its own —
  // we measure against the untouched pool and the live region scope.)
  const full=scopeCodes().length;
  if(!full || !s.pool || s.pool.length!==full) return false;
  if(s.solved.size!==full) return false;            // every country actually found
  if(s.correct!==full) return false;                // and every one of them first try
  // and nothing that counts as help or a stumble
  return !s.missed.length && !s.assisted.length && !s.hints && !s.shown.size;
}

function finish(){
  const s=state.session; s.done=true; stopTimer();
  /* Timed to the last click, not to whenever the results card happens to
     appear. Everything after the final answer is animation, and charging the
     player ~0.7s for watching it is just wrong. Splits now sum to exactly
     this, so the server's consistency check reconciles perfectly too. */
  const ms=(s.stoppedAt||s.lastAnswerAt||Date.now())-s.t0;
  const secs=Math.round(ms/1000);
  const acc = s.n? Math.round(s.correct/s.n*100):0;
  const key=state.mode+'|'+state.region;
  if(!store.best[key] || acc>store.best[key]) { store.best[key]=acc; save(); }
  const clean=isCleanRun(s);
  if(clean){
    /* You just found every country in the region, first try, no hints, no
       reveals. That is knowing the region — so the progress screen says so
       immediately instead of making you prove it six times over. A later miss
       still knocks the country back down, so this can be lost again. */
    for(const code of s.pool){ const r=M(code); r.m=1; r.st=Math.max(r.st,4); }
    save();
    if(typeof markDirty==='function') s.pool.forEach(markDirty);
    submitRecord(state.region, ms, s.n, s.splits);
  }
  renderHUD(); renderStrip(); renderSide();
  const v=el('div'); v.className='veil'; v.id='veil';
  const missed=[...new Set(s.missed)];
  const assisted=[...new Set(s.assisted)].filter(c=>!s.missed.includes(c));
  const weak=[...new Set(missed.concat(assisted))];
  v.innerHTML=`<div class="card">
    <h2>${acc>=90?'Outstanding':acc>=70?'Solid run':acc>=50?'Getting there':'Keep drilling'}</h2>
    <div class="sc">${acc}<span style="font-size:26px">%</span></div>
    <div class="scl">${s.correct} of ${s.n} clean${assisted.length?` · ${assisted.length} with help`:''}</div>
    ${clean?`<div class="lbflash" id="lbflash">
      <b>Perfect run — ${fmtMs(ms)}</b>
      <span id="lbmsg">Every country found, no misses, no hints.</span>
    </div>`:''}
    <div class="statgrid">
      <div class="stat"><div class="v">${s.bestStreak}</div><div class="l">Best streak</div></div>
      <div class="stat"><div class="v">${fmtMs(ms)}</div><div class="l">Time</div></div>
      <div class="stat"><div class="v">${(ms/1000/Math.max(1,s.n)).toFixed(2)}s</div><div class="l">Per question</div></div>
      <div class="stat"><div class="v">${s.hints}</div><div class="l">Hints used</div></div>
    </div>
    ${assisted.length?`<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)">Got there with a hint</div>
      <div class="miss">${assisted.map(c=>`<span style="background:#2a2415;border-color:#4a4127;color:#e2c98a">${C[c].flag} ${C[c].name}</span>`).join('')}</div>`:''}
    ${missed.length?`<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin-top:12px">Missed</div>
      <div class="miss">${missed.map(c=>`<span>${C[c].flag} ${C[c].name}</span>`).join('')}</div>`:''}
    <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">
      <button class="bigbtn" style="flex:1;min-width:130px" id="again">Play again</button>
      ${weak.length?`<button class="bigbtn sec" style="flex:1;min-width:130px" id="drill">Drill the ${weak.length} shaky ones</button>`:''}
      <button class="bigbtn sec" style="flex:1;min-width:110px" id="back">New setup</button>
    </div>
    <button class="bigbtn sec" id="admire" style="margin-top:8px">Look at the finished map</button></div>`;
  wrap.appendChild(v);
  $('#again').onclick=()=>{ v.remove(); startSession(); };
  if($('#drill')) $('#drill').onclick=()=>{ v.remove(); startSession({pool:weak}); };
  $('#admire').onclick=()=>{ v.style.display='none';
    const b=el('button'); b.className='pill solid'; b.textContent='← back to results';
    b.style.cssText+='position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:41';
    b.onclick=()=>{ b.remove(); v.style.display=''; };
    wrap.appendChild(b); resetView(); };
  $('#back').onclick=()=>{ v.remove(); const b=wrap.querySelector('.pill.solid'); if(b)b.remove();
    state.session=null; clearPaint(); clearLabels(); clearDone();
    setActive(Array.from(state.scopeSet)); resetView(); renderHUD(); renderStrip();
    state.setupStep='mode'; renderSide(); renderSetup(); };
}

/* ------------------------------------------------------------- interaction */
function click(ev){
  if(state.view==='home') return;
  const code=pick(ev);
  const s=state.session;
  /* Learn: recalling a location is the whole exercise, so a click here is an
     answer, not navigation. */
  if(state.view==='learn' && state.lesson && !state.lesson.done
     && state.lesson.phase!=='study' && state.lesson.current){
    if(code && state.lesson.list.includes(code)) learnAnswer(code);
    return;
  }
  if((state.view==='play'||state.view==='versus') && s && !s.done && (state.mode==='find'||state.mode==='flag'||state.mode==='capital')){
    if(!code || !state.scopeSet.has(code)) return;
    answer(code===s.current, code);
    return;
  }
  if(code){ selectCountry(code); }
}
function selectCountry(code){
  state.selected=code; clearPaint(); clearLabels();
  paint(code,'sel'); label(code);
  const c=C[code]; flyTo(c.bb, c.micro?26:3.2, 480);
  if(state.view!=='atlas'&&state.view!=='learn'){ state.view='atlas'; syncTabs(); }
  renderSide();
}

/* ==================================================================== HUD */
function renderHUD(){
  const hud=$('#hud'), s=state.session;
  if(state.view==='learn'){ renderLearnHUD(); return; }   // Learn drives its own prompt
  const playable = state.view==='play' || (s && s.race && state.view==='versus');
  if(!playable || !s || s.done){ hud.style.display='none'; return; }
  hud.style.display='block';
  hud.classList.toggle('race', !!(s.race));
  const c=C[s.current];
  let q='', sub='';
  if(state.mode==='find'){ q=`<span class="big" style="font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);margin:0;line-height:1.4">Find</span>${c.name}`; sub='Click it on the map'; }
  else if(state.mode==='flag'){ q=`<span class="big">${c.flag}</span>Whose flag is this?`; sub='Click the country'; }
  else if(state.mode==='capital'){ q=`<span class="big" style="font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);margin:0;line-height:1.4">Capital</span>${c.capital}`; sub='Click the country it belongs to'; }
  else if(state.mode==='name'){ q='Which country is highlighted?'; sub='Type the name and hit Enter'; }
  else if(state.mode==='capname'){ q=`What is the capital of ${c.name}?`; sub='Type it and hit Enter'; }
  const typing = state.mode==='name'||state.mode==='capname';
  hud.innerHTML=`
    <div class="q">${q}</div>
    <div class="sub">${sub}</div>
    ${typing?'<input class="type" id="ti" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="your answer…">':''}
    <div class="fb" id="fb"></div>`;
  /* Controls live in the sidebar — the HUD floats over the map and every extra
     row of buttons covers countries you might need to click. */
  if(typing){ const ti=$('#ti'); ti.focus();
    ti.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); submitTyped(ti.value); } e.stopPropagation(); };
  }
}
function submitTyped(v){
  const s=state.session; if(!s||s.done) return; const c=C[s.current];
  const g=norm(v); if(!g) return;
  let ok=false;
  if(state.mode==='name'){
    const cands=[c.name,c.official,...c.alt].map(norm);
    ok = cands.some(x=> x===g || (g.length>4 && lev(x,g)<=1) || (g.length>7 && lev(x,g)<=2));
    if(!ok && g.length>=4) ok = cands.some(x=> x.startsWith(g) && g.length>=x.length-2);
  } else {
    const cands=[c.capital].map(norm);
    ok = cands.some(x=> x===g || (g.length>4 && lev(x,g)<=1) || (g.length>7 && lev(x,g)<=2));
  }
  if(ok){ answer(true); }
  else { const ti=$('#ti'); if(ti){ti.value='';}
    answer(false, null); }
}

function renderStrip(){
  const st=$('#strip'), s=state.session;
  if(s&&s.race){ stopRunClock(); st.innerHTML=''; renderVsBar(); return; }
  if(state.view!=='play'||!s||s.done){ stopRunClock(); st.innerHTML=''; return; }
  const acc = s.answered>0?Math.round(s.correct/s.answered*100):100;
  st.innerHTML=`
    <div class="chip" style="flex-direction:column;align-items:stretch;gap:5px;min-width:158px">
      <div style="display:flex;justify-content:space-between"><span class="k">Map filled</span><b>${s.solved.size}/${s.n}</b></div>
      <div class="bar"><i style="width:${(s.solved.size+s.shown.size)/s.n*100}%;background:#7a4040">
        <b style="display:block;height:100%;background:var(--good);width:${(s.solved.size+s.shown.size)?s.solved.size/(s.solved.size+s.shown.size)*100:0}%"></b></i></div>
    </div>
    <div class="chip"><span class="k">Clean</span><b style="color:var(--good)">${s.correct}</b>
      <span style="color:var(--ink3)">/</span><b style="color:var(--bad)">${s.wrong}</b></div>
    <div class="chip"><span class="k">Streak</span><b>${s.streak}${s.streak>=5?' 🔥':''}</b></div>
    <div class="chip"><span class="k">Acc</span><b>${acc}%</b></div>
    <div class="chip run"><span class="k">Time</span><b id="runclock">${fmtMs((s.stoppedAt||Date.now())-s.t0)}</b></div>`;
  if(!s.stoppedAt) startRunClock();          // a finished run stays frozen
}

/* The running clock. Ticks ten times a second so the tenths actually move,
   and only while a solo session is live. */
let runClockId=null;
function startRunClock(){
  stopRunClock();
  runClockId=setInterval(()=>{
    const s=state.session;
    const el=document.getElementById('runclock');
    if(!el || !s || s.done || s.race || s.stoppedAt){ stopRunClock(); return; }
    el.textContent=fmtMs(Date.now()-s.t0);
  }, 100);
}
function stopRunClock(){ if(runClockId){ clearInterval(runClockId); runClockId=null; } }

/* ================================================================ SIDEBAR */
const MODES=[
  {id:'find',   k:'target', s:'Classic',  t:'Classic',
   d:'You get a country name. Find it on the map and click it.'},
  {id:'capital',k:'pin',    s:'Capitals', t:'Capitals',
   d:'You get a capital city. Click the country it belongs to.'},
  {id:'flag',   k:'flag',   s:'Flags',    t:'Flags',
   d:'You get a flag. Click the country it belongs to.'},
  {id:'name',   k:'keys',   s:'Name it',  t:'Name it',
   d:'A country lights up on the map. Type its name.'}
];

function renderSide(){
  const body=$('#sideBody'), title=$('#sideTitle'), sub=$('#sideSub');
  if(state.view==='play'){
    if(state.session && !state.session.done){ title.textContent='Session'; sub.textContent=MODES.find(m=>m.id===state.mode).t;
      body.innerHTML=sessionPanel(); bindSessionPanel(); }
    else { title.textContent='New session'; sub.textContent='Two choices and you are playing';
      body.innerHTML=setupPanel(); bindSetup(); }
  }
  else if(state.view==='learn'){ title.textContent='Learn'; sub.textContent=state.lesson?state.lesson.title:'Learn a region for real';
    body.innerHTML=learnPanel(); bindLearn(); }
  else if(state.view==='versus'){ title.textContent='1v1'; sub.textContent='Race a friend on the clock';
    body.innerHTML=versusPanel(); bindVersus(); }
  else if(state.view==='atlas'){ title.textContent='Atlas'; sub.textContent=`${SOVEREIGN.length} countries`;
    body.innerHTML=atlasPanel(); bindAtlas(); }
  else if(state.view==='warmer'){ title.textContent='Warmer'; sub.textContent='Hot or cold, one country';
    body.innerHTML=''; }
  else { title.textContent='Progress'; sub.textContent='Your mastery across the world';
    body.innerHTML=statsPanel(); bindStats(); }
}

function optRow(label, items, cur, attr){
  return `<div class="fset"><label>${label}</label><div class="opts">${
    items.map(i=>`<button class="opt ${i.v===cur?'on':''}" data-${attr}="${i.v}">${i.t}${i.s?`<small>${i.s}</small>`:''}</button>`).join('')
  }</div></div>`;
}
function setupPanel(){
  refreshScope();
  const n=state.scopeSet.size;
  const cur=MODES.find(m=>m.id===state.mode)||MODES[0];
  return `
  <div class="fset"><label>What are you practising?</label>
    <div class="modegrid">
      ${MODES.map(m=>`<button class="mtile ${m.id===state.mode?'on':''}" data-mode="${m.id}">
        ${ICO[m.k]}<span>${m.s}</span></button>`).join('')}
    </div>
    <div class="mdesc">${cur.d}</div>
  </div>
  ${optRow('Where', [{v:'all',t:'World',s:SOVEREIGN.length+' countries'}]
      .concat(REGIONS.map(r=>({v:r,t:r,s:SOVEREIGN.filter(c=>C[c].region===r).length+''}))), state.region,'region')}
  <button class="bigbtn" id="go">Start · all ${n}</button>
  <div class="tips"><kbd>H</kbd> hint · <kbd>S</kbd> skip · drag to pan · pinch to zoom
    <button id="tipmore">How it works</button></div>`;
}
function bindSetup(){
  $('#sideBody').querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;renderSide();});
  $('#sideBody').querySelectorAll('[data-region]').forEach(b=>b.onclick=()=>{
    state.region=b.dataset.region; refreshScope(); previewScope(); renderSide();
  });
  $('#go').onclick=()=>startSession();
  if($('#tipmore')) $('#tipmore').onclick=()=>{
    const v=el('div'); v.className='veil'; v.id='veil';
    v.innerHTML=`<div class="card"><h2>How it works</h2>
      <div class="facts" style="margin-top:16px">
        ${fact('Wrong guess','Costs you nothing — keep trying')}
        ${fact('H','Shrinks the field of candidates')}
        ${fact('S','Gives up on that one')}
        ${fact('Clicking','Near misses snap to the closest country')}
        ${fact('Map','Drag to pan, pinch or +/− to zoom, 0 resets')}
        ${fact('Green','A country you found. It stays green')}
      </div>
      <button class="bigbtn" id="tipclose" style="margin-top:20px">Got it</button></div>`;
    wrap.appendChild(v); $('#tipclose').onclick=()=>v.remove();
  };
  setActive(Array.from(state.scopeSet));
}
function previewScope(){
  refreshScope(); clearPaint(); clearLabels(); setActive(Array.from(state.scopeSet));
  if(state.region!=='all'){
    const list=Array.from(state.scopeSet).map(c=>C[c]);
    if(list.length){ let b=[1e9,1e9,-1e9,-1e9];
      list.forEach(c=>{b[0]=Math.min(b[0],c.bb[0]);b[1]=Math.min(b[1],c.bb[1]);b[2]=Math.max(b[2],c.bb[2]);b[3]=Math.max(b[3],c.bb[3]);});
      flyTo(b,1.25,450); }
  } else resetView();
}
function sessionPanel(){
  const s=state.session;
  const recent=[...new Set(s.missed)].slice(-14).reverse();
  return `<div class="actions">
      <button class="act" id="bhint">Hint <kbd>H</kbd></button>
      <button class="act" id="brev">Give me it <kbd>S</kbd></button>
    </div>
    <div class="statgrid">
    <div class="stat"><div class="v" style="color:var(--good)">${s.solved.size}</div><div class="l">Found</div></div>
    <div class="stat"><div class="v">${s.n-s.solved.size}</div><div class="l">Still hiding</div></div>
    <div class="stat"><div class="v">${s.bestStreak}</div><div class="l">Best streak</div></div>
    <div class="stat"><div class="v">${s.hints}</div><div class="l">Hints used</div></div></div>
    ${recent.length?`<div class="fset"><label>Missed so far</label><div class="lst">${
      recent.map(c=>`<button class="li" data-fly="${c}"><span class="fg">${C[c].flag}</span><span class="nm">${C[c].name}</span></button>`).join('')
    }</div></div>`:'<div class="hintbox">Clean sheet so far. Keep going.</div>'}
    <button class="bigbtn sec" id="endnow">End session</button>`;
}
function bindSessionPanel(){
  $('#sideBody').querySelectorAll('[data-fly]').forEach(b=>b.onclick=()=>{ const c=C[b.dataset.fly]; flyTo(c.bb,4,450); });
  const h=$('#bhint'); if(h) h.onclick=hint;
  const r=$('#brev');  if(r) r.onclick=()=>reveal();
  renderHintBtn();                       // restore the "Hint · 1/3" state after a re-render
  $('#endnow').onclick=()=>{ stopTimer(); state.session.n=state.session.i; finish(); };
}

/* --------------------------------------------------------------- learn */
function learnPanel(){
  if(!state.lesson){
    const groups=REGIONS.map(r=>{
      const list=SOVEREIGN.map(c=>C[c]).filter(c=>c.region===r);
      const m=list.reduce((a,c)=>a+(store.mastery[c.code]?store.mastery[c.code].m:0),0)/Math.max(1,list.length);
      return {r,n:list.length,m};
    });
    return `<div class="hintbox">Pick a region. You'll learn it in small groups of neighbours — a few seconds looking, then straight into recalling them from memory. Wrong answers come back sooner.</div>
    <div class="fset" style="margin-top:14px"><label>Regions</label><div class="lst">${
      groups.map(g=>`<button class="li" data-lesson="${g.r}">
        <span class="nm"><b>${g.r}</b><br><span style="font-size:11px;color:var(--ink3)">${g.n} countries</span></span>
        <span class="mini"><i style="width:${Math.round(g.m*100)}%;background:${g.m>.66?'var(--good)':g.m>.33?'var(--amber)':'var(--bad)'}"></i></span>
        <span class="mv">${Math.round(g.m*100)}%</span></button>`).join('')
    }</div></div>
    <div class="fset"><label>Or by sub-region</label><div class="opts">${
      REGIONS.flatMap(r=>Array.from(SUBS[r]||[])).sort().map(s=>`<button class="opt" data-lessonsub="${s}">${s}</button>`).join('')
    }</div></div>`;
  }
  const L=state.lesson;

  if(L.done){
    const acc=L.asked?Math.round(L.right/L.asked*100):0;
    const shaky=[...(L.shaky||[])];
    return `<div class="hintbox" style="border-left-color:var(--good)">
      <b>${L.title} done.</b> ${shaky.length
        ? `You placed ${L.list.length-shaky.length} of ${L.list.length} from memory.`
        : `You recalled all ${L.list.length} from memory.`}</div>
      <div class="statgrid" style="margin-top:14px">
        <div class="stat"><div class="v">${L.list.length-shaky.length}</div><div class="l">Learned</div></div>
        <div class="stat"><div class="v">${acc}%</div><div class="l">Recall accuracy</div></div>
      </div>
      ${shaky.length?`<div class="fset" style="margin-top:14px"><label>Still not sticking</label>
        <div class="miss">${shaky.map(c=>`<span>${C[c].flag} ${C[c].name}</span>`).join('')}</div>
        <button class="bigbtn" id="lshaky" style="margin-top:10px">Go again on these ${shaky.length}</button></div>`:''}
      <button class="bigbtn ${shaky.length?'sec':''}" id="ldrill" style="margin-top:12px">Test yourself properly</button>
      <button class="bigbtn sec" id="lback" style="margin-top:8px">Learn another region</button>`;
  }

  const chunk=L.clusters[L.ci];
  const learned=[...L.introduced].filter(c=>{
    const q=L.queue.find(x=>x.code===c); return !q || q.streak>=3;
  }).length;
  const phaseLabel = L.phase==='study'  ? 'Look at these'
                   : L.phase==='recall' ? 'Recall this group'
                   : L.phase==='review' ? 'Mixed with earlier groups'
                   : 'Whole region, shuffled';
  const studying = L.phase==='study';
  const c = studying ? C[chunk.codes[L.si]] : null;

  return `<div class="lchip">${phaseLabel}</div>
  ${studying ? `<div class="info" style="margin-top:12px">
      <div class="flag">${c.flag}</div>
      <h3>${c.name}</h3>
      <div class="off">${c.official||''}</div>
      <div class="facts">
        ${fact('Capital',c.capital||'—')}
        ${fact('Region',c.sub||c.region)}
        ${c.borders.length?fact('Borders',c.borders.length):fact('Borders','island')}
      </div>
      ${c.borders.length?`<div class="nbrs" style="margin-top:10px">${
        c.borders.slice(0,6).map(b=>`<span class="nbr">${C[b].flag} ${C[b].name}</span>`).join('')}</div>`:''}
    </div>
    <button class="bigbtn" id="lgot" style="margin-top:14px">Got it ›</button>`
   : `<div class="hintbox" style="margin-top:12px">Find it on the map. Getting it wrong is fine — it just comes back sooner.</div>
      <div class="statgrid" style="margin-top:12px">
        <div class="stat"><div class="v" style="color:var(--good)">${L.right}</div><div class="l">Right</div></div>
        <div class="stat"><div class="v">${L.queue.length}</div><div class="l">Left in round</div></div>
      </div>`}

  <div class="fset" style="margin-top:16px"><label>Progress</label>
    <div class="bar"><i style="width:${Math.round(learned/Math.max(1,L.list.length)*100)}%;background:var(--good)"></i></div>
    <div style="text-align:center;font-size:11.5px;color:var(--ink3);margin-top:5px">
      ${learned} of ${L.list.length} · group ${L.ci+1}/${L.clusters.length} — ${esc(chunk.name)}</div>
  </div>
  <button class="bigbtn sec" id="lback" style="margin-top:12px">Leave lesson</button>`;
}
function fact(k,v){ return `<div class="fact"><span>${k}</span><b>${v}</b></div>`; }

/* ===========================================================================
   LEARN — retrieval practice, not a slideshow.
   ---------------------------------------------------------------------------
   Flipping through 45 countries teaches almost nothing: it is restudy, and
   restudy loses badly to being made to recall (Roediger & Karpicke; ~0.5 SD
   across 159 comparisons). So every country here is studied for a few seconds
   and then immediately has to be produced from memory, with feedback.

   Three other findings shape the loop:
     * spatial memory is hierarchical — people hold a map as regions, then
       clusters, then items — so we teach in small neighbouring chunks rather
       than marching west to east through the whole continent;
     * blocked practice first, then interleaved, beats either alone, so a
       chunk is drilled on its own and then mixed back in with earlier ones;
     * expanding intervals: get it right and it comes back later, get it
       wrong and it comes back almost immediately.
   =========================================================================== */

const CHUNK_MIN=4, CHUNK_MAX=6;

/* Neighbouring countries, in chunks of 4-6. Sub-region first (that is the
   grouping people already think in), split by longitude when too big, and
   merged with its neighbour when too small to be worth a round. */
function clusterRegion(list){
  const bySub=new Map();
  for(const code of list){
    const k=C[code].sub || C[code].region;
    if(!bySub.has(k)) bySub.set(k,[]);
    bySub.get(k).push(code);
  }
  const subs=[...bySub.entries()]
    .map(([k,v])=>({k, v:v.slice().sort((a,b)=>C[a].cx-C[b].cx)}))
    .sort((a,b)=>{
      const ax=a.v.reduce((s,c)=>s+C[c].cx,0)/a.v.length;
      const bx=b.v.reduce((s,c)=>s+C[c].cx,0)/b.v.length;
      return ax-bx;
    });

  const out=[];
  for(const s of subs){
    if(s.v.length<=CHUNK_MAX){ out.push({name:s.k, codes:s.v}); continue; }
    const parts=Math.ceil(s.v.length/CHUNK_MAX);
    const per=Math.ceil(s.v.length/parts);
    for(let i=0;i<s.v.length;i+=per)
      out.push({name:s.k, codes:s.v.slice(i,i+per)});
  }
  // fold undersized chunks into the previous one
  const merged=[];
  for(const c of out){
    const prev=merged[merged.length-1];
    if(prev && c.codes.length<CHUNK_MIN && prev.codes.length+c.codes.length<=CHUNK_MAX+1){
      prev.codes=prev.codes.concat(c.codes);
      if(prev.name!==c.name) prev.name=prev.name+' & '+c.name;
    } else merged.push({name:c.name, codes:c.codes.slice()});
  }
  return merged;
}

function startLesson(title, list){
  const clusters=clusterRegion(list);
  state.lesson={
    title, list:list.slice(), clusters,
    ci:0,              // which chunk
    si:0,              // study position inside the chunk
    phase:'study',     // study -> recall -> (review) -> next chunk -> final
    queue:[],          // scheduled retrieval items {code, streak}
    current:null,
    introduced:new Set(),
    asked:0, right:0, wrong:0,
    lastWrong:null,
    done:false
  };
  advanceLearn(true);
}

/* --- scheduling ---------------------------------------------------------- */
/* Right answers move an item further back each time; wrong answers bring it
   straight back. Positions, not timestamps — this is one sitting. */
const GAP_RIGHT=[3,7,14];
const MAX_FAILS=5;                          // stop hammering one country forever
/* How many clean recalls retire an item, per phase. The first drill of a new
   group is where the work happens; later passes are consolidation, so asking
   for three correct recalls of all 45 again would just be a slog nobody
   finishes. */
function retireAt(L){ return L.phase==='recall' ? 2 : 1; }
function scheduleItem(L, code, ok){
  const it=L.queue.find(q=>q.code===code) || {code, streak:0, fails:0};
  const idx=L.queue.indexOf(it);
  if(idx>=0) L.queue.splice(idx,1);
  if(ok){
    it.streak++;
    if(it.streak>=retireAt(L)) return;       // done with this one for now
    const gap=GAP_RIGHT[Math.min(it.streak, GAP_RIGHT.length-1)];
    L.queue.splice(Math.min(gap, L.queue.length), 0, it);
  } else {
    it.streak=0; it.fails=(it.fails||0)+1;
    /* A country you simply cannot place shouldn't trap you in the lesson.
       After enough misses it is set aside and reported at the end instead. */
    if(it.fails>=MAX_FAILS){ (L.shaky=L.shaky||new Set()).add(code); return; }
    L.queue.splice(Math.min(2, L.queue.length), 0, it);
  }
}
function seedQueue(L, codes){
  for(const code of codes) if(!L.queue.some(q=>q.code===code)) L.queue.push({code, streak:0, fails:0});
}

/* --- the loop ------------------------------------------------------------ */
function advanceLearn(fresh){
  const L=state.lesson; if(!L) return;
  const chunk=L.clusters[L.ci];

  if(L.phase==='study'){
    if(L.si < chunk.codes.length){ showStudyCountry(); renderSide(); return; }
    // chunk studied -> drill it on its own (blocked)
    L.phase='recall';
    L.queue=[];
    seedQueue(L, chunk.codes);
    nextLearnQuestion(); return;
  }

  if(L.phase==='recall' || L.phase==='review' || L.phase==='final'){
    if(L.queue.length){ nextLearnQuestion(); return; }

    if(L.phase==='recall'){
      chunk.codes.forEach(c=>L.introduced.add(c));
      const older=[...L.introduced].filter(c=>!chunk.codes.includes(c));
      if(older.length){                       // mix the new chunk with the old
        L.phase='review';
        /* A handful of earlier countries mixed in with the new ones — enough
           to force the cross-group comparison interleaving is good for,
           without re-testing the whole continent after every group. */
        seedQueue(L, shuffle(shuffle(older.slice()).slice(0,5)).concat(shuffle(chunk.codes.slice())));
        nextLearnQuestion(); return;
      }
      return goNextChunk();
    }
    if(L.phase==='review') return goNextChunk();
    if(L.phase==='final'){ L.done=true; clearPaint(); clearLabels();
      setActive(L.list); resetView(); renderLearnHUD(); renderSide(); return; }
  }
}
function goNextChunk(){
  const L=state.lesson;
  if(L.ci < L.clusters.length-1){
    L.ci++; L.si=0; L.phase='study'; advanceLearn(); return;
  }
  // whole region introduced -> one interleaved pass over everything
  L.phase='final'; L.queue=[];
  seedQueue(L, shuffle(L.list.slice()));
  nextLearnQuestion();
}
function showStudyCountry(){
  const L=state.lesson, c=C[L.clusters[L.ci].codes[L.si]];
  clearPaint(); clearLabels();
  setActive(L.clusters[L.ci].codes);
  paint(c.code,'target'); label(c.code, c.name);
  flyTo(c.bb, c.micro?24:3.4, 520);
  renderLearnHUD();
}
function nextLearnQuestion(){
  const L=state.lesson;
  const it=L.queue[0];
  if(!it){ advanceLearn(); return; }
  L.current=it.code;
  clearPaint(); clearLabels();
  /* Recall happens against the whole region, not just the chunk — picking one
     of four highlighted countries is recognition, which is a much weaker thing
     to practise than actually locating it. */
  setActive(L.list);
  repaintLearnDone();
  const scope=L.phase==='final' ? L.list : [...L.introduced].concat(L.clusters[L.ci].codes);
  const bb=scopeBB(scope);
  if(bb) flyTo(bb, 1.35, 420);
  renderLearnHUD(); renderSide();
}
function scopeBB(codes){
  const list=codes.map(c=>C[c]).filter(Boolean);
  if(!list.length) return null;
  let b=[1e9,1e9,-1e9,-1e9];
  list.forEach(c=>{b[0]=Math.min(b[0],c.bb[0]);b[1]=Math.min(b[1],c.bb[1]);
                   b[2]=Math.max(b[2],c.bb[2]);b[3]=Math.max(b[3],c.bb[3]);});
  return b;
}
function repaintLearnDone(){
  const L=state.lesson; if(!L) return;
  for(const code of L.introduced){
    const q=L.queue.find(x=>x.code===code);
    if(!q || q.streak>=3) paint(code,'done');
  }
}
function learnAnswer(code){
  const L=state.lesson; if(!L || !L.current || L.done) return;
  const target=L.current, c=C[target];
  const ok = code===target;
  L.asked++;
  if(ok){
    L.right++; L.lastWrong=null;
    record(target, true, 1);
    scheduleItem(L, target, true);
    paint(target,'good'); label(target, c.name); ping(c.cx, c.cy, '#41c07a');
    feedbackLearn('ok', pickPraise()+' '+c.flag+' '+c.name);
    L.current=null;
    setTimeout(()=>{ if(state.lesson===L) nextLearnQuestion(); }, 620);
  } else {
    L.wrong++; L.lastWrong=code;
    record(target, false);
    scheduleItem(L, target, false);
    /* Feedback is the point — show them where it actually was. */
    paint(target,'target'); label(target, c.name);
    if(code) { paint(code,'bad'); label(code, C[code].name); }
    feedbackLearn('no', code ? `That's ${C[code].name}. ${c.name} is here.`
                             : `${c.name} is here.`);
    L.current=null;
    setTimeout(()=>{ if(state.lesson===L) nextLearnQuestion(); }, 1500);
  }
  renderSide();
}
function feedbackLearn(kind, msg){
  const el=document.getElementById('lfb');
  if(el){ el.className='fb '+(kind==='ok'?'ok':'no'); el.textContent=msg; }
}

/* Learn drives the same floating HUD the game uses. */
function renderLearnHUD(){
  const hud=$('#hud'), L=state.lesson;
  if(state.view!=='learn' || !L || L.done){ if(state.view==='learn') hud.style.display='none'; return; }
  hud.style.display='block'; hud.classList.remove('race');
  if(L.phase==='study'){
    const c=C[L.clusters[L.ci].codes[L.si]];
    hud.innerHTML=`
      <div class="q"><span class="big" style="font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);margin:0;line-height:1.4">Look</span>${c.flag} ${c.name}</div>
      <div class="sub">${c.capital? c.capital+' · ' : ''}${c.sub||c.region}</div>
      <div class="fb" id="lfb"></div>`;
    return;
  }
  const c=C[L.current];
  hud.innerHTML=`
    <div class="q"><span class="big" style="font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--ink3);margin:0;line-height:1.4">Find</span>${c?c.name:''}</div>
    <div class="sub">Click it on the map</div>
    <div class="fb" id="lfb"></div>`;
}
function bindLearn(){
  const B=$('#sideBody');
  B.querySelectorAll('[data-lesson]').forEach(b=>b.onclick=()=>{
    const r=b.dataset.lesson;
    startLesson(r, SOVEREIGN.filter(c=>C[c].region===r));
  });
  B.querySelectorAll('[data-lessonsub]').forEach(b=>b.onclick=()=>{
    const s=b.dataset.lessonsub;
    startLesson(s, SOVEREIGN.filter(c=>C[c].sub===s));
  });
  if(state.lesson){
    const L=state.lesson;
    const got=$('#lgot');
    if(got) got.onclick=()=>{ L.si++; advanceLearn(); renderSide(); };
    const back=$('#lback');
    if(back) back.onclick=()=>{ state.lesson=null; $('#hud').style.display='none';
      clearPaint(); clearLabels(); setActive(SOVEREIGN); resetView(); renderSide(); };
    const sh=$('#lshaky');
    if(sh) sh.onclick=()=>{ const again=[...(L.shaky||[])];
      startLesson(L.title+' — the tricky ones', again); renderSide(); };
    const drill=$('#ldrill');
    if(drill) drill.onclick=()=>{ const list=L.list.slice();
      state.lesson=null; $('#hud').style.display='none';
      state.view='play'; syncTabs(); startSession({pool:list}); };
  }
}

/* --------------------------------------------------------------- atlas */
function atlasPanel(){
  const q=norm(state.atlasQ);
  let list=SOVEREIGN.map(c=>C[c]).sort((a,b)=>a.name.localeCompare(b.name));
  if(q) list=list.filter(c=>norm(c.name).includes(q)||norm(c.capital||'').includes(q)||norm(c.code).includes(q));
  const sel=state.selected?C[state.selected]:null;
  return `<input class="search" id="q" placeholder="Search countries, capitals, codes…" value="${state.atlasQ.replace(/"/g,'&quot;')}">
  ${sel?`<div class="info" style="margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--line)">
    <div class="flag">${sel.flag}</div><h3>${sel.name}</h3><div class="off">${sel.official||''}</div>
    <div class="facts">${fact('Capital',sel.capital||'—')}${fact('Region',sel.sub||sel.region)}
      ${fact('Area',fmt(sel.area)+' km²')}${fact('Codes',sel.iso2+' · '+sel.code)}
      ${fact('Neighbours',sel.borders.length||'none')}
      ${store.mastery[sel.code]?fact('Mastery',Math.round(store.mastery[sel.code].m*100)+'%'):''}</div>
    ${sel.borders.length?`<div class="nbrs">${sel.borders.map(b=>`<button class="nbr" data-sel="${b}">${C[b].flag} ${C[b].name}</button>`).join('')}</div>`:''}
  </div>`:'<div class="hintbox">Click any country on the map, or search below. This is the whole world — no top-30 nonsense.</div>'}
  <div class="lst">${list.slice(0,400).map(c=>{
    const m=store.mastery[c.code]; const mv=m?Math.round(m.m*100):0;
    return `<button class="li ${state.selected===c.code?'on':''}" data-sel="${c.code}">
      <span class="fg">${c.flag}</span><span class="nm">${c.name}<br><span style="font-size:10.5px;color:var(--ink3)">${c.capital||'—'}</span></span>
      <span class="mini"><i style="width:${mv}%;background:${mv>66?'var(--good)':mv>33?'var(--amber)':'#3d4b5d'}"></i></span></button>`;
  }).join('')}</div>`;
}
function bindAtlas(){
  const q=$('#q');
  q.oninput=()=>{ state.atlasQ=q.value; const p=q.selectionStart; renderSide();
    const n=$('#q'); n.focus(); n.setSelectionRange(p,p); };
  q.onkeydown=e=>e.stopPropagation();
  $('#sideBody').querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>selectCountry(b.dataset.sel));
}

/* --------------------------------------------------------------- stats */
function statsPanel(){
  const codes=SOVEREIGN;
  const seen=codes.filter(c=>store.mastery[c]);
  const avg=codes.reduce((a,c)=>a+(store.mastery[c]?store.mastery[c].m:0),0)/codes.length;
  const mastered=codes.filter(c=>store.mastery[c]&&store.mastery[c].m>=0.8).length;
  const life=store.totals.q?Math.round(store.totals.c/store.totals.q*100):0;
  const rec=Array.isArray(store.recent)?store.recent:[];
  const acc=rec.length?Math.round(rec.reduce((a,b)=>a+b,0)/rec.length*100):life;
  const weak=codes.filter(c=>store.mastery[c]).sort((a,b)=>store.mastery[a].m-store.mastery[b].m).slice(0,15);
  const regions=REGIONS.map(r=>{
    const l=codes.filter(c=>C[c].region===r);
    const m=l.reduce((a,c)=>a+(store.mastery[c]?store.mastery[c].m:0),0)/Math.max(1,l.length);
    return {r,m,n:l.length};
  }).sort((a,b)=>b.m-a.m);
  return `<div class="statgrid">
    <div class="stat"><div class="v">${Math.round(avg*100)}%</div><div class="l">World mastery</div></div>
    <div class="stat"><div class="v">${mastered}<span style="font-size:14px;color:var(--ink3)">/${codes.length}</span></div><div class="l">Mastered</div></div>
    <div class="stat"><div class="v">${seen.length}</div><div class="l">Countries seen</div></div>
    <div class="stat"><div class="v">${acc}%</div><div class="l">Recent accuracy${rec.length?` · last ${rec.length}`:''}</div></div>
  </div>
  <div class="fset"><label>By continent</label>${regions.map(g=>`
    <div class="regrow"><div class="t"><span>${g.r}</span><b>${Math.round(g.m*100)}%</b></div>
    <div class="bar"><i style="width:${Math.round(g.m*100)}%;background:${g.m>.66?'var(--good)':g.m>.33?'var(--amber)':'var(--bad)'}"></i></div></div>`).join('')}
  </div>
  ${weak.length?`<div class="fset"><label>Weakest links</label><div class="lst">${
    weak.map(c=>`<button class="li" data-sel="${c}"><span class="fg">${C[c].flag}</span>
      <span class="nm">${C[c].name}</span><span class="mv">${Math.round(store.mastery[c].m*100)}%</span></button>`).join('')
  }</div><button class="bigbtn" id="drillweak" style="margin-top:10px">Drill these ${weak.length}</button></div>`
  :'<div class="hintbox">Play a round and your weak spots will show up here, ranked.</div>'}
  <div class="fset"><label>All time</label>
    <div style="font-family:var(--serif);font-size:30px">${fmt(store.totals.q)}</div>
    <div style="font-size:11.5px;color:var(--ink3);margin-top:2px">questions answered · ${life}% lifetime accuracy</div></div>
  <button class="bigbtn sec" id="reset">Reset all progress</button>`;
}
function bindStats(){
  $('#sideBody').querySelectorAll('[data-sel]').forEach(b=>b.onclick=()=>selectCountry(b.dataset.sel));
  const d=$('#drillweak'); if(d) d.onclick=()=>{
    const codes=SOVEREIGN.filter(c=>store.mastery[c]).sort((a,b)=>store.mastery[a].m-store.mastery[b].m).slice(0,15);
    state.view='play'; syncTabs(); startSession({pool:codes});
  };
  $('#reset').onclick=()=>{ if(confirm('Wipe all mastery data and stats?')){ store={mastery:{},totals:{q:0,c:0},best:{},recent:[]}; save(); renderSide(); } };
}

/* ================================================================== chrome */
function syncTabs(){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===state.view));
  document.body.classList.toggle('at-home', state.view==='home');
}
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{
  if(state.race && state.race.status==='live'){ return; }   // no wandering off mid-race
  if(state.race) leaveRace(true);
  state.view=b.dataset.v; syncTabs(); stopTimer();
  if(state.view==='warmer'){ Warmer.open(); } else { Warmer.close(); }
  const veil=$('#veil'); if(veil) veil.remove();
  if(state.view!=='play'){ state.session=null; clearDone(); }
  clearPaint(); clearLabels();
  if(state.view==='play')        state.setupStep = state.session ? null : 'mode';
  else if(state.view==='versus')  state.setupStep = state.race ? null : 'mode';
  else                            state.setupStep = null;
  renderSetup();
  if(state.view==='versus'){ setActive(SOVEREIGN); resetView(); }
  else if(state.view==='atlas'){ setActive(SOVEREIGN); }
  else if(state.view==='learn'){ if(state.lesson) advanceLearn(); else { setActive(SOVEREIGN); resetView(); } }
  else if(state.view==='play'){ refreshScope(); setActive(Array.from(state.scopeSet)); }
  else { setActive(SOVEREIGN); resetView(); }
  renderHUD(); renderStrip(); renderSide();
});
$('#mob').onclick=()=>$('#side').classList.toggle('open');
$('#fs').onclick=()=>{ if(!document.fullscreenElement) document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();
  else document.exitFullscreen(); };

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT') return;
  if(state.view==='warmer') return;
  const s=state.session;
  if(e.key==='h'||e.key==='H'){ if(s&&!s.done) hint(); }
  if(e.key==='s'||e.key==='S'){ if(s&&!s.done&&!s.race) reveal(); }   // no skipping in a race
  if(e.key==='Escape'){ if(state.race) return; const v=$('#veil'); if(v)v.remove(); state.session=null; stopTimer(); clearDone();
    clearPaint(); clearLabels(); state.view='play'; syncTabs(); refreshScope(); setActive(Array.from(state.scopeSet)); renderHUD(); renderStrip(); renderSide(); }
  if(e.key==='+'||e.key==='=') zoomAt(VW/2,VH/2,1.4);
  if(e.key==='-') zoomAt(VW/2,VH/2,1/1.4);
  if(e.key==='0') resetView();
});

/* =========================================================================
   IDENTITY, ACCOUNTS, CLOUD SYNC
   Everything below degrades gracefully: with no config.js the whole app still
   runs, progress lives in localStorage, and 1v1 works between tabs on this
   machine. Fill in Supabase keys and the same code goes online.
   ========================================================================= */
const IDKEY='mapdash.identity';
try{                                              // keep your display name through the rebrand
  if(!localStorage.getItem(IDKEY)){
    const old=localStorage.getItem('terra.identity');
    if(old) localStorage.setItem(IDKEY, old);
  }
}catch(e){}
let ME = {id:'', name:''};
try{ ME = Object.assign(ME, JSON.parse(localStorage.getItem(IDKEY)||'{}')); }catch(e){}
if(!ME.id) ME.id = 'p_'+Math.random().toString(36).slice(2,10);
function saveMe(){ try{ localStorage.setItem(IDKEY, JSON.stringify(ME)); }catch(e){} }
saveMe();

const cloudConfigured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
let sb=null, sbPromise=null, account=null;

function loadCloud(){
  if(sb) return Promise.resolve(sb);
  if(!cloudConfigured) return Promise.resolve(null);
  if(!sbPromise){
    sbPromise = import(CFG.sdkUrl || 'https://esm.sh/@supabase/supabase-js@2')
      .then(m=>{ sb=m.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
                 return sb.auth.getSession().then(({data})=>{ account=data.session?data.session.user:null;
                   sb.auth.onAuthStateChange((_e,sess)=>{ account=sess?sess.user:null; onAccountChange(); });
                   return sb; }); })
      .catch(e=>{ console.warn('[mapdash] cloud unavailable:', e.message); return null; });
  }
  return sbPromise;
}
if(cloudConfigured) loadCloud().then(()=>{ renderAccountBtn(); if(account) pullProgress(); });

function gateActive(){ return cloudConfigured && !account; }
function onAccountChange(){
  renderAccountBtn();
  if(account){
    pullProgress();
    pushDisplayName();        // sync a name chosen before signing in
    if(state.view==='auth'){                       // just signed in
      if(state.pendingJoin){ const c=state.pendingJoin; state.pendingJoin=null;
        state.view='versus'; syncTabs(); renderHome(); renderSide(); joinRace(c); return; }
      const go=state.pendingAction; state.pendingAction=null;
      if(go){ document.body.classList.remove('at-home'); $('#home').style.display='none'; stopDrift();
              svg.style.pointerEvents='auto'; enterApp(go); renderAccountBtn(); return; }
      goHome(); return;
    }
  } else if(cloudConfigured && state.view!=='auth' && state.view!=='home'){
    state.session=null; state.race=null; state.view='home'; syncTabs(); renderHome();
  }
  renderSide();
}
function renderAccountBtn(){
  const b=$('#acct'); if(!b) return;
  b.style.display='';
  if(account && account.email) b.textContent = ME.name || 'Set name';
  else if(cloudConfigured)     b.textContent = 'Sign in';
  else if(ME.name)             b.textContent = ME.name;
  else                         b.textContent = 'Set name';
}

/* ---- cloud progress sync (opportunistic; failures are silent) ---- */
let dirty=new Set(), pushT=null;
function markDirty(code){ if(!account) return; dirty.add(code); schedulePush(); }
function schedulePush(){ clearTimeout(pushT); pushT=setTimeout(pushProgress, 4000); }
function pushProgress(){
  if(!sb || !account || !dirty.size) return;
  const rows=[...dirty].map(code=>{ const r=store.mastery[code];
    return {user_id:account.id, country:code, m:r.m, seen:r.s, correct:r.c, streak:r.st}; });
  dirty.clear();
  sb.from('mastery').upsert(rows,{onConflict:'user_id,country'}).then(({error})=>{
    if(error) console.warn('[mapdash] progress push failed:', error.message);
  });
}
function pullProgress(){
  if(!sb || !account) return;
  sb.from('mastery').select('country,m,seen,correct,streak').eq('user_id',account.id).then(({data,error})=>{
    if(error||!data) return;
    let changed=false;
    for(const row of data){
      const cur=store.mastery[row.country];
      if(!cur || row.seen>cur.s){                       // whichever side has done more wins
        store.mastery[row.country]={m:row.m,s:row.seen,c:row.correct,st:row.streak}; changed=true;
      } else if(cur.s>row.seen) dirty.add(row.country);
    }
    for(const code in store.mastery) if(!data.find(r=>r.country===code)) dirty.add(code);
    if(changed){ save(); renderSide(); }
    if(dirty.size) schedulePush();
  });
}

/* ================================================================ LEADERBOARD */
/* Times are shown to a tenth: 17.0s, 1:08.4, 6:12.4 */
function fmtMs(ms){
  // Round to tenths FIRST, then split — otherwise 599999ms formats as "9:60.0"
  const tenths=Math.round(Math.max(0,ms)/100);
  if(tenths<600) return (tenths/10).toFixed(1)+'s';
  const m=Math.floor(tenths/600), r=(tenths-m*600)/10;
  return m+':'+(r<10?'0':'')+r.toFixed(1);
}
function regionKey(r){ return r||'all'; }
function regionName(r){ return r==='all'?'Whole world':r; }
const LB_REGIONS=['all'].concat(REGIONS);

let lbCache={};                                   // region -> {rows, at}
let lbState={region:'all', loading:false, err:''};

/* The public name. Never derived from the email address. */
function displayName(){ return (ME.name||'').trim().slice(0,18) || 'player'; }
function hasDisplayName(){ return !!(ME.name||'').trim(); }

/* Renaming rewrites every board you are already on, so the change shows up
   straight away instead of only on your next qualifying run. */
let dnT=null, dnLast='';
function pushDisplayName(){
  const name=(ME.name||'').trim().slice(0,18);
  if(!name || name===dnLast) return;
  clearTimeout(dnT);
  dnT=setTimeout(()=>{
    loadCloud().then(()=>{
      if(!sb || !account) return;
      sb.rpc('set_display_name',{p_display:name}).then(({error})=>{
        if(error){ console.warn('[mapdash] name sync failed:', error.message); return; }
        dnLast=name;
        lbCache={};                                  // force a fresh board
        if(state.view==='board'){ renderSetup(); renderSide(); }
      });
    });
  }, 350);
}

function submitRecord(region, ms, n, splits){
  const msg=t=>{ const e=$('#lbmsg'); if(e) e.textContent=t; };
  if(!cloudConfigured) return;
  loadCloud().then(()=>{
    if(!sb || !account){ msg('Sign in to put this on the leaderboard.'); return; }
    const display = displayName();
    sb.rpc('submit_record',{p_region:regionKey(region), p_ms:Math.round(ms),
                            p_countries:n, p_display:display,
                            p_splits:(splits||[]).map(x=>Math.round(x))})
      .then(({data,error})=>{
        if(error){ console.warn('[mapdash] record submit failed:', error.message);
                   msg('Could not reach the leaderboard.'); return; }
        delete lbCache[regionKey(region)];
        msg(data
          ? (hasDisplayName() ? 'New personal best — you are on the board.'
                              : 'On the board as "player" — set a display name and it updates instantly.')
          : 'Good run, but your record still stands.');
        if(!data) console.info('[mapdash] not recorded: slower than your PR, or the run failed validation.');
        const b=$('#lbflash'); if(b && data) b.classList.add('pb');
      });
  });
}

function loadBoard(region, cb){
  const key=regionKey(region);
  const hit=lbCache[key];
  if(hit && Date.now()-hit.at < 60000){ cb(null, hit.rows); return; }
  loadCloud().then(()=>{
    if(!sb){ cb('offline'); return; }
    sb.from('leaderboard').select('rank,display,ms,countries,set_at,user_id')
      .eq('region',key).order('rank',{ascending:true}).limit(10)
      .then(({data,error})=>{
        if(error){ cb(error.message); return; }
        lbCache[key]={rows:data||[], at:Date.now()};
        cb(null, data||[]);
      });
  });
}

/* Full-stage leaderboard. The sidebar is too narrow for ten rows plus a
   region picker, so the board takes the main area like the setup screens do. */
function boardScreen(){
  const hit=lbCache[regionKey(lbState.region)];
  const mine=account?account.id:null;
  let body;
  if(lbState.err)        body=`<div class="lbempty">Couldn't load the board — ${esc(lbState.err)}</div>`;
  else if(!hit)          body=`<div class="lbempty">Loading…</div>`;
  else if(!hit.rows.length) body=`<div class="lbempty">No times in ${regionName(lbState.region)} yet.<br><span>A flawless Classic run puts you straight at number one.</span></div>`;
  else body=`<div class="lbhead"><span>#</span><span>Player</span><span>Time</span></div>
    <ol class="lbrows big">${hit.rows.map(r=>{
      const me = mine && r.user_id===mine;
      return `<li class="lbrow${r.rank<=3?' m'+r.rank:''}${me?' me':''}">
        <span class="lbrank">${r.rank}</span>
        <span class="lbname">${esc(r.display)}${me?'<i>you</i>':''}</span>
        <span class="lbtime">${fmtMs(r.ms)}</span>
      </li>`;
    }).join('')}</ol>`;

  return `<div class="vcard wide board">
    <h2>Leaderboard</h2>
    <div class="lede">Get 100% accuracy, and see if you can hit the leaderboard!</div>
    <div class="lbtabs">${LB_REGIONS.map(r=>
      `<button class="lbtab ${regionKey(lbState.region)===regionKey(r)?'on':''}" data-lbr="${r}">${regionName(r)}</button>`
    ).join('')}</div>
    ${body}
    <button class="bigbtn sec" id="lbrefresh2" style="margin-top:16px">Refresh</button>
  </div>`;
}
function bindBoardScreen(){
  const box=$('#setup');
  box.querySelectorAll('[data-lbr]').forEach(b=>b.onclick=()=>{
    lbState.region=b.dataset.lbr; lbState.err=''; renderSetup(); renderSide(); fetchBoard();
  });
  const r=box.querySelector('#lbrefresh2');
  if(r) r.onclick=()=>{ delete lbCache[regionKey(lbState.region)]; lbState.err=''; renderSetup(); fetchBoard(); };
  if(!lbCache[regionKey(lbState.region)]) fetchBoard();
}

function boardPanel(){
  const rows=lbCache[regionKey(lbState.region)];
  const mine=account?account.id:null;
  let body;
  if(lbState.err) body=`<div class="hintbox">Couldn't load the board — ${lbState.err}</div>`;
  else if(!rows) body=`<div class="lbload">Loading…</div>`;
  else if(!rows.rows.length) body=`<div class="hintbox">No times yet in ${regionName(lbState.region)}. A perfect Classic run puts you straight at number one.</div>`;
  else body=`<ol class="lbrows">${rows.rows.map(r=>{
      const me = mine && r.user_id===mine;
      const medal = r.rank<=3 ? ` m${r.rank}` : '';
      return `<li class="lbrow${medal}${me?' me':''}">
        <span class="lbrank">${r.rank}</span>
        <span class="lbname">${esc(r.display)}${me?'<i>you</i>':''}</span>
        <span class="lbtime">${fmtMs(r.ms)}</span>
      </li>`;
    }).join('')}</ol>`;

  return `<div class="hintbox">Get 100% accuracy, and see if you can hit the leaderboard!</div>
  <div class="fset" style="margin-top:16px"><label>How to qualify</label>
    <div class="lbrule"><b>Classic</b> mode, whole region</div>
    <div class="lbrule">Every country <b>first try</b></div>
    <div class="lbrule">No hints, no reveals</div>
  </div>
  <button class="bigbtn" id="lbplay" style="margin-top:14px">Go for a run</button>`;
}
function bindBoard(){
  const p=$('#lbplay');
  if(p) p.onclick=()=>{                       // jump straight into a qualifying attempt
    state.mode='find';
    if(lbState.region!=='all' || state.region==='all') state.region=lbState.region;
    state.view='play'; state.session=null; state.setupStep=null;
    syncTabs(); refreshScope(); setActive(Array.from(state.scopeSet));
    renderSetup(); startSession(); renderSide();
  };
  if(!lbCache[regionKey(lbState.region)]) fetchBoard();
}
function fetchBoard(){
  if(lbState.loading) return;
  lbState.loading=true;
  loadBoard(lbState.region,(err)=>{
    lbState.loading=false;
    lbState.err = err ? (err==='offline'?'no connection':err) : '';
    if(state.view==='board'){ renderSetup(); renderSide(); }
  });
}
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ================================================================ ACCOUNT UI */
function openAccount(){
  const v=el('div'); v.className='veil'; v.id='veil';
  v.innerHTML=`<div class="card">
    <h2>Who are you?</h2>
    <div class="lede" style="text-align:center;color:var(--ink3);font-size:13px;margin-top:4px">
      Just a name for the 1v1 scoreboard. It never leaves this browser.</div>
    <div class="sect" style="font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink3);margin:18px 0 7px">Display name</div>
    <input class="field" id="dn" maxlength="18" placeholder="Pick a name" value="${(ME.name||'').replace(/"/g,'&quot;')}">
    <button class="bigbtn" id="adone" style="margin-top:14px">Done</button>
  </div>`;
  wrap.appendChild(v);
  const close=()=>{ ME.name=$('#dn').value.trim().slice(0,18); saveMe(); v.remove(); renderSide();
    if(state.joinCode && !state.race && state.view==='versus') joinRace(state.joinCode); };
  $('#adone').onclick=close;
  v.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter') close(); });
}

/* =========================================================================
   TRANSPORT — identical message shapes over two very different pipes.
   local : BroadcastChannel, two tabs on one machine, zero setup
   cloud : Supabase Realtime broadcast, anywhere in the world
   ========================================================================= */
const Net = {
  mode:null, code:null, chan:null, cb:null, peerSeen:false, closing:false,
  onMsg(cb){ this.cb=cb; },
  _deliver(msg){ if(msg && msg.from!==ME.id && this.cb) this.cb(msg); },

  async open(code, preferCloud){
    await this.close();
    this.code=code; this.closing=false;
    if(preferCloud && cloudConfigured){
      const c=await loadCloud();
      if(c){
        this.mode='cloud';
        this.chan=c.channel('mapdash:'+code, {config:{broadcast:{self:false}, presence:{key:ME.id}}});
        this.chan.on('broadcast',{event:'msg'},({payload})=>this._deliver(payload));
        this.chan.on('presence',{event:'leave'},()=>{ if(!this.closing && this.cb) this.cb({type:'peerleft',from:'*'}); });
        await new Promise(res=>this.chan.subscribe(st=>{ if(st==='SUBSCRIBED'){ this.chan.track({id:ME.id}); res(); } }));
        return 'cloud';
      }
    }
    if(typeof BroadcastChannel==='undefined') throw new Error('nolocal');
    this.mode='local';
    this.chan=new BroadcastChannel('mapdash:'+code);
    this.chan.onmessage=e=>this._deliver(e.data);
    return 'local';
  },
  send(type, payload){
    if(!this.chan) return;
    const msg=Object.assign({type, from:ME.id, name:ME.name||'Player'}, payload||{});
    if(this.mode==='cloud') this.chan.send({type:'broadcast', event:'msg', payload:msg});
    else this.chan.postMessage(msg);
  },
  async close(){
    this.closing=true;
    if(this.chan){
      try{ if(this.mode==='cloud'){ await this.chan.unsubscribe(); } else this.chan.close(); }catch(e){}
    }
    this.chan=null; this.mode=null; this.code=null;
  }
};

/* ======================================================================= RACE */
const DURATIONS=[{v:30,t:'30s'},{v:60,t:'1m'},{v:120,t:'2m'},{v:180,t:'3m'},{v:300,t:'5m'}];
function newCode(){ const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s='';
  for(let i=0;i<5;i++) s+=A[(Math.random()*A.length)|0]; return s; }
function mulberry(a){ return function(){ a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function seededShuffle(arr, seed){ const a=arr.slice(), r=mulberry(seed);
  for(let i=a.length-1;i>0;i--){ const j=(r()*(i+1))|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
function raceLink(code){ return location.origin+location.pathname+'#m='+code; }

function blankPlayer(name){ return {name:name||'Player', score:0, idx:0, doneAt:null, lastAt:0, here:false}; }

function newRace(role, code, cfg){
  return { role, code, cfg, status:'waiting', order:null,
           startAt:0, endsAt:0, tick:null,
           me:blankPlayer(ME.name||'You'), opp:blankPlayer('Waiting…'),
           result:null, transport:null };
}

async function hostRace(){
  state.setupStep=null; renderSetup();
  if(!ME.name){ ME.name='Host'; saveMe(); renderAccountBtn(); }
  const cfg={mode:state.mode, region:state.region, seconds:state.vsSeconds||120};
  const code=newCode();
  const R=newRace('host', code, cfg);
  state.race=R; state.view='versus'; syncTabs();
  try{ R.transport=await Net.open(code, true); }
  catch(e){ state.race=null; state.vsErr='Could not open a match channel in this browser.'; renderSide(); return; }
  Net.onMsg(onRaceMsg);
  R.me.here=true;
  renderStage(); renderSide();
}
async function joinRace(code){
  code=(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
  if(code.length<5){ state.vsErr='A join code is five characters.'; state.setupStep='join'; renderSetup(); return; }
  if(!ME.name){ ME.name='Challenger'; saveMe(); renderAccountBtn(); }
  const R=newRace('guest', code, null);
  state.race=R; state.view='versus'; state.setupStep=null; renderSetup(); syncTabs();
  try{ R.transport=await Net.open(code, true); }
  catch(e){ state.race=null; state.vsErr='Could not open a match channel in this browser.'; renderSide(); return; }
  Net.onMsg(onRaceMsg);
  R.me.here=true;
  Net.send('hello');
  R.hailT=setInterval(()=>{ if(state.race===R && R.status==='waiting') Net.send('hello'); }, 1500);
  setTimeout(()=>{ if(state.race===R && !R.opp.here){ R.noHost=true; renderStage(); } }, 6000);
  renderStage(); renderSide();
}

function onRaceMsg(m){
  const R=state.race; if(!R) return;
  switch(m.type){
    case 'hello':                                   // a guest is knocking
      R.opp.name=m.name||'Player'; R.opp.here=true; R.noHost=false;
      if(R.role==='host') Net.send('welcome',{cfg:R.cfg});
      renderStage(); renderSide(); break;
    case 'welcome':
      R.opp.name=m.name||'Player'; R.opp.here=true; R.noHost=false;
      R.cfg=m.cfg; clearInterval(R.hailT);
      renderStage(); renderSide(); break;
    case 'start':
      R.cfg=m.cfg; R.order=m.order; beginRace(m.startIn);
      break;
    case 'score':
      R.opp.score=m.score; R.opp.idx=m.idx; R.opp.lastAt=m.at;
      renderVsBar(); if(R.status==='over') renderStage(); break;
    case 'done':
      R.opp.score=m.score; R.opp.doneAt=m.at; R.opp.idx=m.idx;
      if(R.status==='live' && R.me.doneAt!=null) endRace('both');
      else renderVsBar();
      break;
    case 'rematch':                                 // guest is asking for another go
      R.oppWantsRematch=true; renderStage(); break;
    case 'reset':                                   // host reopened the room
      resetToLobby(); break;
    case 'peerleft':
    case 'bye':
      if(R.status==='live'){ R.opp.here=false; R.oppGone=true; renderVsBar(); }
      else { R.opp=blankPlayer('Waiting…'); R.oppGone=true; renderStage(); }
      break;
  }
}

function startRaceAsHost(){
  const R=state.race; if(!R||R.role!=='host'||!R.opp.here) return;
  state.mode=R.cfg.mode; state.region=R.cfg.region; refreshScope();
  let pool=Array.from(state.scopeSet);
  if(R.cfg.mode==='capital'||R.cfg.mode==='capname') pool=pool.filter(c=>C[c].capital);
  R.order=seededShuffle(pool, (Math.random()*1e9)|0);
  Net.send('start',{cfg:R.cfg, order:R.order, startIn:3000});
  beginRace(3000);
}

function beginRace(startIn){
  const R=state.race; if(!R) return;
  clearInterval(R.hailT);
  state.mode=R.cfg.mode; state.region=R.cfg.region;
  R.status='countdown'; R.startAt=Date.now()+startIn; R.endsAt=R.startAt+R.cfg.seconds*1000;
  R.me=blankPlayer(ME.name||'You'); R.me.here=true;
  R.opp.score=0; R.opp.idx=0; R.opp.doneAt=null;
  renderStage();
  clearInterval(R.tick);
  R.tick=setInterval(()=>{
    const R2=state.race; if(!R2){ clearInterval(R.tick); return; }
    if(R2.status==='countdown'){
      if(Date.now()>=R2.startAt){ R2.status='live'; $('#stage').style.display='none';
        startSession({pool:R2.order, order:R2.order, race:true}); renderSide(); }
      else renderStage();
    } else if(R2.status==='live'){
      renderVsBar();
      if(Date.now()>=R2.endsAt) endRace('time');
    }
  }, 200);
}

function raceScored(){
  const R=state.race, s=state.session; if(!R||!s) return;
  R.me.score=s.solved.size;                  // every country you actually found
  R.me.idx=s.i; R.me.lastAt=Date.now()-R.startAt;
  Net.send('score',{score:R.me.score, idx:R.me.idx, at:R.me.lastAt});
  renderVsBar();
}
function endRace(reason){
  const R=state.race, s=state.session; if(!R||R.status==='over') return;
  R.status='over'; clearInterval(R.tick); stopTimer();
  if(s){ s.done=true; R.me.score=s.solved.size; R.me.idx=s.i; }
  R.me.doneAt = R.me.doneAt!=null ? R.me.doneAt : (reason==='cleared' ? Date.now()-R.startAt : R.cfg.seconds*1000);
  Net.send('done',{score:R.me.score, idx:R.me.idx, at:R.me.doneAt});
  const a=R.me, b=R.opp;
  let verdict;
  if(a.score>b.score) verdict='win';
  else if(a.score<b.score) verdict='loss';
  else verdict='draw';                        // same score is a tie, full stop
  if(R.oppGone) verdict='win';
  R.result={verdict, reason};
  recordMatch(R);
  $('#hud').style.display='none'; $('#vsbar').style.display='none';
  renderStage(); renderSide();
}
function recordMatch(R){
  if(!sb || !account) return;
  sb.from('matches').insert({code:R.code, host:R.role==='host', mode:R.cfg.mode, region:R.cfg.region,
    seconds:R.cfg.seconds, my_score:R.me.score, opp_score:R.opp.score, opponent:R.opp.name,
    result:R.result.verdict, user_id:account.id}).then(({error})=>{ if(error) console.warn('[mapdash]',error.message); });
}
function leaveRace(silent){
  const R=state.race; if(!R) return;
  clearInterval(R.tick); clearInterval(R.hailT);
  if(!silent) Net.send('bye');
  Net.close();
  state.race=null; state.session=null; state.vsView='lobby';
  if(state.view==='versus') state.setupStep='mode';
  clearPaint(); clearLabels(); clearDone();
  $('#stage').style.display='none'; $('#vsbar').style.display='none'; $('#hud').style.display='none';
  if(!silent){ setActive(SOVEREIGN); resetView(); renderSide(); renderSetup(); }
}
function rematch(){
  const R=state.race; if(!R) return;
  if(R.role==='host'){ Net.send('reset'); resetToLobby(); }
  else { Net.send('rematch'); R.askedRematch=true; renderStage(); }
}
/* back to the waiting room with the same opponent, scores wiped */
function resetToLobby(){
  const R=state.race; if(!R) return;
  clearInterval(R.tick);
  R.status='waiting'; R.result=null; R.oppWantsRematch=false; R.askedRematch=false;
  R.me=blankPlayer(ME.name||'You'); R.me.here=true;
  R.opp.score=0; R.opp.idx=0; R.opp.doneAt=null; R.opp.lastAt=0;
  state.session=null;
  clearPaint(); clearLabels(); clearDone(); setActive(SOVEREIGN); resetView();
  $('#vsbar').style.display='none'; $('#hud').style.display='none';
  renderStage(); renderSide();
}

/* --------------------------------------------------------------- live bar */
function renderVsBar(){
  const bar=$('#vsbar'), R=state.race, s=state.session;
  if(!R || R.status!=='live' || !s){ bar.style.display='none'; return; }
  bar.style.display='flex';
  const left=Math.max(0, Math.ceil((R.endsAt-Date.now())/1000));
  const mm=Math.floor(left/60), ss=String(left%60).padStart(2,'0');
  const mine=s.solved.size, theirs=R.opp.score;
  bar.innerHTML=`
    <div class="box ${mine>=theirs?'lead':''}"><div class="k">You</div><div class="v">${mine}</div></div>
    <div class="box clock ${left<=10?'low':''}"><div class="k">Time</div><div class="v">${mm}:${ss}</div></div>
    <div class="box ${theirs>mine?'lead':''}"><div class="k">${R.oppGone?'Left':R.opp.name}</div><div class="v">${theirs}</div></div>`;
}

/* ------------------------------------------------------------ stage screens */
function renderStage(){
  const st=$('#stage'), R=state.race;
  if(!R || R.status==='live'){ st.style.display='none'; st.innerHTML=''; return; }
  st.style.display='grid';
  if(R.status==='countdown'){
    const n=Math.max(1, Math.ceil((R.startAt-Date.now())/1000));
    st.innerHTML=`<div style="text-align:center">
      <div class="count">${n}</div>
      <div style="color:var(--ink2);font-size:15px;margin-top:6px">${modeLabel(R.cfg.mode)} · ${regionLabel(R.cfg.region)} · ${fmtDur(R.cfg.seconds)}</div>
      <div style="color:var(--ink3);font-size:13px;margin-top:4px">${R.me.name} vs ${R.opp.name}</div></div>`;
    return;
  }
  if(R.status==='over'){ st.innerHTML=resultsCard(R); bindResults(); return; }
  st.innerHTML=waitingCard(R); bindWaiting();
}
function modeLabel(m){ const x=MODES.find(o=>o.id===m); return x?x.t:m; }
function regionLabel(r){ return r==='all'?'Whole world':r; }
function fmtDur(sec){ return sec<60?sec+' seconds':(sec/60)+' minute'+(sec>60?'s':''); }

function waitingCard(R){
  const host=R.role==='host';
  const cur=MODES.find(m=>m.id===(R.cfg&&R.cfg.mode))||MODES[0];
  return `<div class="vcard">
    <h2>${host?'Your match is open':'Joining '+R.code}</h2>
    <div class="lede">${host
      ? 'Send the link. The race starts when you say so.'
      : (R.opp.here ? 'You are in. Waiting for the host to start.'
                    : (R.noHost ? 'No one is hosting that code right now.' : 'Looking for the host…'))}</div>
    ${R.cfg?`<div class="summary">
      <span>${cur.t}</span><span>${regionLabel(R.cfg.region)}</span><span>${fmtDur(R.cfg.seconds)}</span>
    </div>`:''}
    ${host?`<div class="sect">Join code</div>
      <div class="code">${R.code}</div>
      <div class="linkrow"><input id="lnk" readonly value="${raceLink(R.code)}">
        <button class="pill solid" id="cpy">Copy</button></div>`:''}
    <div class="vsrow">
      <div class="pcard me"><div class="av">${(R.me.name||'?')[0].toUpperCase()}</div>
        <div class="nm">${R.me.name||'You'}</div><div class="st">${host?'Host':'Challenger'}</div></div>
      <div class="vsbadge">VS</div>
      <div class="pcard"><div class="av">${R.opp.here?(R.opp.name||'?')[0].toUpperCase():'·'}</div>
        <div class="nm">${R.opp.here?R.opp.name:'Empty seat'}</div>
        <div class="st">${R.opp.here?'Ready':'<span class="waitdot"></span>waiting'}</div></div>
    </div>
    ${host?`<button class="bigbtn" id="gostart" style="margin-top:20px" ${R.opp.here?'':'disabled style="margin-top:20px;opacity:.45"'}>
        ${R.opp.here?'Start the race':'Waiting for an opponent…'}</button>`:''}
    <button class="bigbtn sec" id="vleave" style="margin-top:10px">Leave</button>
    <div class="muted">${R.transport==='local'
      ? 'Local match — open the link in a second tab on this computer.'
      : 'Online match — the link works anywhere.'}</div>
  </div>`;
}
function bindWaiting(){
  if($('#gostart')) $('#gostart').onclick=startRaceAsHost;
  if($('#cpy')) $('#cpy').onclick=()=>{ const i=$('#lnk'); i.select();
    (navigator.clipboard?navigator.clipboard.writeText(i.value):Promise.reject())
      .catch(()=>document.execCommand('copy'))
      .then(()=>{ $('#cpy').textContent='Copied'; setTimeout(()=>{ if($('#cpy'))$('#cpy').textContent='Copy'; },1400); });
  };
  $('#vleave').onclick=()=>leaveRace();
}

function resultsCard(R){
  const s=state.session, v=R.result.verdict;
  const head = v==='win' ? 'You win' : v==='loss' ? 'You lost' : 'Dead heat';
  const why  = R.oppGone ? 'Your opponent left.'
             : R.result.reason==='cleared' ? 'Whole set cleared.'
             : R.me.score===R.opp.score ? 'Level on score — nothing between you.' : 'Time.';
  const missed=s?[...new Set(s.missed)]:[];
  return `<div class="vcard">
    <h2>${head}</h2><div class="lede">${why}</div>
    <div class="vsrow">
      <div class="pcard me ${v==='win'?'win':''}"><div class="av">${(R.me.name||'?')[0].toUpperCase()}</div>
        <div class="nm">${R.me.name}</div><div class="sc">${R.me.score}</div>
        <div class="st">${R.me.lastAt?(R.me.lastAt/1000).toFixed(1)+'s to last point':'—'}</div></div>
      <div class="vsbadge">VS</div>
      <div class="pcard ${v==='loss'?'win':''}"><div class="av">${(R.opp.name||'?')[0].toUpperCase()}</div>
        <div class="nm">${R.opp.name}</div><div class="sc">${R.opp.score}</div>
        <div class="st">${R.opp.lastAt?(R.opp.lastAt/1000).toFixed(1)+'s to last point':'—'}</div></div>
    </div>
    ${missed.length?`<div class="sect">You didn't get</div>
      <div class="miss">${missed.slice(0,24).map(c=>`<span>${C[c].flag} ${C[c].name}</span>`).join('')}</div>`:''}
    ${R.oppWantsRematch?'<div class="muted" style="color:var(--amber)">Your opponent wants a rematch.</div>':''}
    ${R.askedRematch?'<div class="muted">Rematch requested — waiting for the host to reopen.</div>':''}
    <div style="display:flex;gap:8px;margin-top:18px">
      ${R.role==='host'?'<button class="bigbtn" id="vre" style="flex:1">Rematch</button>':
        (R.askedRematch?'':'<button class="bigbtn sec" id="vre" style="flex:1">Ask for a rematch</button>')}
      <button class="bigbtn sec" id="vleave" style="flex:1">Leave</button>
    </div>
    ${missed.length?'<button class="bigbtn sec" id="vdrill" style="margin-top:8px">Drill what you missed, solo</button>':''}
  </div>`;
}
function bindResults(){
  if($('#vre')) $('#vre').onclick=rematch;
  $('#vleave').onclick=()=>leaveRace();
  if($('#vdrill')) $('#vdrill').onclick=()=>{
    const missed=[...new Set(state.session.missed)];
    leaveRace(true); state.view='play'; syncTabs(); startSession({pool:missed});
  };
}

/* ------------------------------------------------------------- side panel */
function versusPanel(){
  const R=state.race;
  if(R && R.status==='live'){
    const s=state.session;
    return `<div class="statgrid">
      <div class="stat"><div class="v" style="color:var(--good)">${s?s.solved.size:0}</div><div class="l">You</div></div>
      <div class="stat"><div class="v">${R.opp.score}</div><div class="l">${R.opp.name}</div></div>
    </div>
    <div class="actions"><button class="act" id="bhint">Hint <kbd>H</kbd></button></div>
    <div class="banner">One hint per country, and it only tells you the continent. No skipping — you stay on it until you get it, and the clock doesn't wait.</div>
    <button class="bigbtn sec" id="vquit">Forfeit</button>`;
  }
  if(R) return `<div class="banner">Match <b>${R.code}</b> — ${R.status}</div>
    <button class="bigbtn sec" id="vquit">Leave match</button>`;
  return `
  ${state.vsErr?`<div class="banner" style="border-left-color:var(--bad)">${state.vsErr}</div>`:''}
  <div class="banner">Same countries, same order, both of you at once. Most found when the clock runs out takes it —
  ties go to whoever got there first. One hint per country, continent only.</div>
  <div class="fset"><label>You are</label>
    <input class="field" id="vname" maxlength="18" placeholder="Your name" value="${(ME.name||'').replace(/"/g,'&quot;')}">
  </div>
  <div class="fset"><label>Clock</label>
    <div class="seg">${DURATIONS.map(d=>`<button class="${(state.vsSeconds||120)===d.v?'on':''}" data-sec="${d.v}">${d.t}</button>`).join('')}</div>
  </div>
  <button class="bigbtn" id="vhost">Create a match</button>
  <div class="fset" style="margin-top:18px"><label>Or join one</label>
    <input class="field" id="vcode" maxlength="5" placeholder="JOIN CODE" style="text-transform:uppercase;letter-spacing:.2em;text-align:center;font-family:var(--mono)" value="${state.joinCode}">
    <button class="bigbtn sec" id="vjoin">Join</button>
  </div>
  <div class="muted">${cloudConfigured
    ? 'Online matches are live — share the link with anyone.'
    : 'No backend configured yet, so matches run between two tabs on this computer. Add Supabase keys to config.js to play over the internet.'}</div>`;
}
function bindVersus(){
  const B=$('#sideBody');
  if($('#vquit')) $('#vquit').onclick=()=>leaveRace();
  if($('#bhint')){ $('#bhint').onclick=hint; renderHintBtn(); }
  const nm=$('#vname');
  if(nm){ nm.onkeydown=e=>e.stopPropagation();
    nm.oninput=()=>{ ME.name=nm.value.trim().slice(0,18); saveMe(); pushDisplayName(); renderAccountBtn(); }; }
  B.querySelectorAll('[data-sec]').forEach(b=>b.onclick=()=>{ state.vsSeconds=+b.dataset.sec; renderSide(); });
  if($('#vhost')) $('#vhost').onclick=()=>{ state.vsErr=''; if(!ME.name){ ME.name=(nm&&nm.value.trim())||'Host'; saveMe(); } hostRace(); };
  const cd=$('#vcode');
  if(cd){ cd.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') $('#vjoin').click(); };
    cd.oninput=()=>{ state.joinCode=cd.value.toUpperCase(); }; }
  if($('#vjoin')) $('#vjoin').onclick=()=>{ state.vsErr='';
    if(!ME.name){ ME.name=(nm&&nm.value.trim())||'Challenger'; saveMe(); }
    joinRace(cd?cd.value:state.joinCode); };
}

const ICO={
  flag  :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 21V3.6"/><path d="M5.5 4.4h11.8l-1.9 3.6 1.9 3.6H5.5z"/></svg>',
  pin   :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5s6.6-6.2 6.6-11a6.6 6.6 0 1 0-13.2 0c0 4.8 6.6 11 6.6 11z"/><circle cx="12" cy="10.3" r="2.4"/></svg>',
  keys  :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.4" y="6.2" width="19.2" height="11.6" rx="2.2"/><path d="M6.4 10h.01M9.6 10h.01M12.8 10h.01M16 10h.01M8 13.6h8"/></svg>',
  quill :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4.6-1.6"/><path d="M8.6 18.4c6-1.4 10.8-6.2 11.4-13.4-7.2.6-12 5.4-13.4 11.4z"/><path d="M11 16l4.6-4.6"/></svg>',
  target:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/><path d="M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2"/></svg>',
  clock :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9.4 2.2h5.2"/><path d="M12 2.2v2.4"/><circle cx="12" cy="13.4" r="8.4"/><path d="M12 9.1v4.6l3 1.9"/><path d="M19.2 5.6l1.7-1.7"/></svg>',
  book  :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.6h5.2c1.6 0 2.9.9 3.8 1.9.9-1 2.2-1.9 3.8-1.9H21v13.3h-5.2c-1.6 0-2.9.8-3.8 1.7-.9-.9-2.2-1.7-3.8-1.7H3z"/><path d="M12 6.5v13"/></svg>',
  globe :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3.2 12h17.6M4.6 6.8h14.8M4.6 17.2h14.8"/></svg>',
  chart :'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 20h17"/><path d="M6.5 20v-6.2M11 20V7.4M15.5 20v-9M20 20V4.2"/></svg>'
};

/* ================================================== SOLO SETUP (full screen) */
function renderSetup(){
  const box=$('#setup');
  const solo   = state.view==='play'   && !state.session;
  const versus = state.view==='versus' && !state.race;
  if(state.view==='board'){                       // the board gets the whole stage
    document.body.classList.add('picking');
    box.style.display='grid'; box.innerHTML=boardScreen(); bindBoardScreen();
    return;
  }
  if(!state.setupStep || !(solo||versus)){
    box.style.display='none'; box.innerHTML=''; document.body.classList.remove('picking'); return;
  }
  state.setupFor = state.view==='versus' ? 'versus' : 'solo';
  document.body.classList.add('picking');
  box.style.display='grid';
  box.innerHTML = state.setupStep==='join'  ? joinScreen()
                : state.setupStep==='where' ? whereScreen() : modeScreen();
  bindSetupScreen();
}
function modeScreen(){
  const vs = state.setupFor==='versus';
  return `<div class="vcard wide">
    <button class="backlink" id="su_back">← Back</button>
    <h2>${vs?'Pick the game':'Pick your game'}</h2>
    <div class="lede">${vs?'Both of you play the same one.':'Four ways to learn the same 195 countries.'}</div>
    <div class="setupgrid">
      ${MODES.map(m=>`<button class="pick" data-smode="${m.id}">
        <div class="ic">${ICO[m.k]}</div>
        <h3>${m.t}</h3><p>${m.d}</p>
        <div class="go">Choose <span>→</span></div></button>`).join('')}
    </div>
    ${vs?'<button class="sublink" id="su_join">Got a code? Join a friend\u2019s match</button>':''}
  </div>`;
}
function joinScreen(){
  return `<div class="vcard">
    <button class="backlink" id="su_back">← Back</button>
    <h2>Join a match</h2>
    <div class="lede">Type the five-character code your friend sent you.</div>
    <input class="field" id="su_code" maxlength="5" placeholder="CODE"
      style="margin-top:22px;text-transform:uppercase;letter-spacing:.34em;text-align:center;
             font-family:var(--mono);font-size:24px;padding:16px">
    <button class="bigbtn" id="su_dojoin">Join</button>
    <div class="err" id="su_err">${state.vsErr||''}</div>
  </div>`;
}
function whereScreen(){
  refreshScope();
  const vs=state.setupFor==='versus';
  const cur=MODES.find(m=>m.id===state.mode)||MODES[0];
  const opts=[{v:'all',t:'World',n:SOVEREIGN.length}]
    .concat(REGIONS.map(r=>({v:r,t:r,n:SOVEREIGN.filter(c=>C[c].region===r).length})));
  return `<div class="vcard wide">
    <button class="backlink" id="su_back">← Back</button>
    <h2>${cur.t}</h2>
    <div class="lede">${cur.d}</div>
    <div class="sect" style="text-align:center">Where in the world?</div>
    <div class="regiongrid">
      ${opts.map(o=>`<button class="rbtn ${state.region===o.v?'on':''}" data-sreg="${o.v}">
        <b>${o.t}</b><span>${o.n}</span></button>`).join('')}
    </div>
    ${vs?`<div class="sect" style="text-align:center">How long?</div>
      <div class="seg">${DURATIONS.map(d=>`<button class="${(state.vsSeconds||120)===d.v?'on':''}" data-ssec="${d.v}">${d.t}</button>`).join('')}</div>`:''}
    <button class="bigbtn" id="su_go" style="margin-top:22px">
      ${vs?`Create the match · ${state.scopeSet.size} countries`:`Start · ${state.scopeSet.size} countries`}</button>
    <div class="tips" style="margin-top:14px">${vs
      ? 'One hint each, continent only. Most found when the clock runs out wins.'
      : '<kbd>H</kbd> hint · <kbd>S</kbd> skip · drag to pan · pinch to zoom'}</div>
  </div>`;
}
function bindSetupScreen(){
  const box=$('#setup');
  box.querySelectorAll('[data-smode]').forEach(b=>b.onclick=()=>{
    state.mode=b.dataset.smode; state.setupStep='where'; renderSetup(); previewScope();
  });
  box.querySelectorAll('[data-sreg]').forEach(b=>b.onclick=()=>{
    state.region=b.dataset.sreg; refreshScope(); previewScope(); renderSetup();
  });
  box.querySelectorAll('[data-ssec]').forEach(b=>b.onclick=()=>{
    state.vsSeconds=+b.dataset.ssec; renderSetup();
  });
  if($('#su_go')) $('#su_go').onclick=()=>{
    if(state.setupFor==='versus'){ state.setupStep=null; renderSetup(); hostRace(); }
    else startSession();
  };
  if($('#su_join')) $('#su_join').onclick=()=>{ state.vsErr=''; state.setupStep='join'; renderSetup(); };
  if($('#su_dojoin')) $('#su_dojoin').onclick=()=>{
    const v=$('#su_code').value; state.setupStep=null; renderSetup(); joinRace(v);
  };
  if($('#su_code')){ const i=$('#su_code');
    i.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') $('#su_dojoin').click(); };
    setTimeout(()=>i.focus(),50); }
  $('#su_back').onclick=()=>{
    if(state.setupStep==='where'||state.setupStep==='join'){ state.setupStep='mode'; renderSetup(); }
    else goHome();
  };
}

/* ======================================================================= HOME
   The front door. Nothing starts until you pick a lane.                    */
function goHome(){
  if(state.race && state.race.status==='live') return;
  if(state.race) leaveRace(true);
  Warmer.close();
  stopTimer(); state.session=null; state.lesson=null; state.selected=null;
  const v=$('#veil'); if(v) v.remove();
  clearPaint(); clearLabels(); clearDone();
  $('#stage').style.display='none'; $('#vsbar').style.display='none'; $('#hud').style.display='none';
  $('#strip').innerHTML=''; $('#readout').style.display='none';
  state.view='home'; state.setupStep=null; renderSetup();
  setActive(SOVEREIGN); resetView(); syncTabs(); renderHome();
}
function enterApp(view, mode){
  state.view=view; if(mode) state.mode=mode;
  stopDrift(); $('#home').style.display='none'; document.body.classList.remove('at-home');
  svg.style.pointerEvents='auto';
  syncTabs(); resetView();
  if(view==='warmer'){ state.setupStep=null; renderSetup(); renderSide(); Warmer.open(); return; }
  if(view==='play'){ state.setupStep='mode'; refreshScope(); setActive(Array.from(state.scopeSet)); }
  else if(view==='versus'){ state.setupStep='mode'; setActive(SOVEREIGN); }
  else { state.setupStep=null; setActive(SOVEREIGN); }
  renderSide(); renderSetup();
}
function renderHome(){
  const h=$('#home');
  if(state.view!=='home'){ h.style.display='none'; document.body.classList.remove('at-home');
    svg.style.pointerEvents='auto'; stopDrift(); return; }
  document.body.classList.add('at-home');
  svg.style.pointerEvents='none';
  h.style.display='grid';
  const codes=SOVEREIGN;
  const avg=codes.reduce((a,c)=>a+(store.mastery[c]?store.mastery[c].m:0),0)/codes.length;
  const seen=codes.filter(c=>store.mastery[c]).length;
  const pct=Math.round(avg*100);
  h.innerHTML=`<div class="hero">
    <div class="word">MAP<i>DASH</i></div>
    <div class="rule"></div>
    <div class="tag">How much of the world can you actually find?</div>
    <div class="freeline">Free forever · No ads</div>

    <div class="picks">
      <button class="pick" data-home="solo">
        <div class="ic">${ICO.target}</div>
        <h3>Solo</h3>
        <p>195 countries, one at a time. The map fills in green as you go.</p>
        <div class="go">Play at your own pace <span>→</span></div>
      </button>
      <button class="pick" data-home="warmer">
        <div class="ic">${ICO.globe}</div>
        <h3>Warmer</h3>
        <p>One hidden country. Every guess runs hot or cold until you close in on it.</p>
        <div class="go">Hunt it down <span>&rarr;</span></div>
      </button>
      <button class="pick" data-home="versus">
        <div class="ic">${ICO.clock}</div>
        <h3>1v1</h3>
        <p>Send a link. Same countries, one clock, most found wins.</p>
        <div class="go">Race a friend <span>→</span></div>
      </button>
    </div>


    ${seen ? `<div class="hstat">
        <span>World mastery</span><div class="hbar"><i style="width:${pct}%"></i></div><b>${pct}%</b>
        <span class="dot">·</span><span><b>${seen}</b> of ${codes.length} countries met</span>
        ${store.totals.q?`<span class="dot">·</span><span><b>${fmt(store.totals.q)}</b> answered</span>`:''}
      </div>`
     : ''}
  </div>`;
  h.querySelectorAll('[data-home]').forEach(b=>b.onclick=()=>{
    const k = b.dataset.home==='solo' ? 'play' : b.dataset.home;
    enterApp(k);
  });
  startDrift();
}
/* slow parallax drift behind the landing copy */
let driftRAF=0, driftT0=0;
function startDrift(){
  if(driftRAF) return;
  driftT0=performance.now();
  view.k=1.32; clampView();
  const span=(VW*view.k-VW);
  const step=t=>{
    if(state.view!=='home'){ driftRAF=0; return; }
    const u=(t-driftT0)/44000;
    view.tx=-span*(0.5+0.42*Math.sin(u*Math.PI*2));
    view.ty=-(VH*view.k-VH)*0.46;
    clampView(); applyView();
    driftRAF=requestAnimationFrame(step);
  };
  driftRAF=requestAnimationFrame(step);
}
function stopDrift(){ if(driftRAF) cancelAnimationFrame(driftRAF); driftRAF=0; }

/* --------------------------------------------- deep link:  #m=ABCDE  */
function checkInviteLink(){
  const m=/[#&?]m=([A-Za-z0-9]{5})/.exec(location.hash||'');
  if(!m) return false;
  history.replaceState(null,'',location.pathname);
  state.view='versus'; state.joinCode=m[1].toUpperCase(); syncTabs();
  if(!ME.name){ renderSide(); openAccount(); return true; }
  joinRace(m[1]);
  return true;
}
window.addEventListener('beforeunload',()=>{ if(state.race) Net.send('bye'); });

/* ===================================================================== BOOT */
state.vsSeconds=120;
refreshScope(); setActive(SOVEREIGN); applyView();
$('#brand').onclick=goHome;
if(checkInviteLink()){
  document.body.classList.remove('at-home'); $('#home').style.display='none';
  renderSide(); syncTabs();
}else{
  state.view='home'; syncTabs(); renderHome(); renderSide();
}

/* service worker, only when actually served over http(s) */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
})();







