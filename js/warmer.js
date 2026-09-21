/* =========================================================================
   WARMER — hot-or-cold country hunt.

   One hidden country. Guess any country and it lights up on the globe in a
   colour that says how far it is from the answer: pale blue a world away,
   red hot when you are close, hottest of all when it shares a border.

   Runs on the same data/world-data.js the map uses, so it costs no extra
   download. Everything here is local: no server, no accounts, no limits.
   ========================================================================= */
window.Warmer = (function(){
"use strict";
var RAD=Math.PI/180, DEG=180/Math.PI, MAXKM=20000;
var built=false, live=false, root=null;
var COUNTRIES={}, CODES=[], DRAW=[];

/* ------------------------------------------------------------ text keys */
function norm(s){
  var t=String(s).normalize('NFD'), out='';
  for(var i=0;i<t.length;i++){ var c=t.charCodeAt(i); if(c>=768&&c<=879) continue; out+=t.charAt(i); }
  return out.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function lev(a,b,cap){
  if(Math.abs(a.length-b.length)>cap) return cap+1;
  var prev=[],cur=[],i,j;
  for(j=0;j<=b.length;j++) prev[j]=j;
  for(i=1;i<=a.length;i++){
    cur[0]=i; var best=i;
    for(j=1;j<=b.length;j++){
      cur[j]=Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1));
      if(cur[j]<best) best=cur[j];
    }
    if(best>cap) return cap+1;
    prev=cur.slice();
  }
  return prev[b.length];
}
function subseq(q,k){ var i=0; for(var j=0;j<k.length&&i<q.length;j++) if(k[j]===q[i]) i++; return i===q.length; }

/* --------------------------------------------------- geometry from topojson */
function build(){
  if(built) return; built=true;
  var W=window.MAPDASH_DATA, TOPO=W.t, META=W.m;
  var tf=TOPO.transform, sx=tf.scale[0], sy=tf.scale[1], tx=tf.translate[0], ty=tf.translate[1];
  var ARCS=TOPO.arcs.map(function(a){
    var x=0,y=0,out=new Array(a.length);
    for(var i=0;i<a.length;i++){ x+=a[i][0]; y+=a[i][1]; out[i]=[x*sx+tx, y*sy+ty]; }
    return out;
  });
  function stitch(idx){
    var pts=[];
    for(var i=0;i<idx.length;i++){
      var k=idx[i], rev=k<0, a=ARCS[rev?~k:k], j;
      if(rev){ for(j=a.length-1-(pts.length?1:0); j>=0; j--) pts.push(a[j]); }
      else   { for(j=pts.length?1:0; j<a.length; j++) pts.push(a[j]); }
    }
    return pts;
  }
  function pack(pts){
    var n=pts.length, d=new Float32Array(n*4);
    var cx=0,cy=0,cz=0,minx=999,maxx=-999,miny=999,maxy=-999;
    for(var i=0;i<n;i++){
      var lon=pts[i][0]*RAD, lat=pts[i][1]*RAD;
      var sl=Math.sin(lat), cl=Math.cos(lat), so=Math.sin(lon), co=Math.cos(lon);
      d[i*4]=sl; d[i*4+1]=cl; d[i*4+2]=so; d[i*4+3]=co;
      cx+=cl*co; cy+=sl; cz+=cl*so;
      if(pts[i][0]<minx)minx=pts[i][0]; if(pts[i][0]>maxx)maxx=pts[i][0];
      if(pts[i][1]<miny)miny=pts[i][1]; if(pts[i][1]>maxy)maxy=pts[i][1];
    }
    var m=Math.sqrt(cx*cx+cy*cy+cz*cz)||1; cx/=m; cy/=m; cz/=m;
    var r=0;
    for(var k=0;k<n;k++){
      var dot=d[k*4+1]*d[k*4+3]*cx + d[k*4]*cy + d[k*4+1]*d[k*4+2]*cz;
      var ang=Math.acos(Math.max(-1,Math.min(1,dot))); if(ang>r) r=ang;
    }
    return {d:d,n:n,cx:cx,cy:cy,cz:cz,sr:Math.sin(r),tiny:(maxx-minx)+(maxy-miny)<0.6};
  }
  TOPO.objects.countries.geometries.forEach(function(g){
    var c=COUNTRIES[g.id];
    if(!c){ c=COUNTRIES[g.id]={id:g.id,rings:[]}; CODES.push(g.id); }
    var polys = g.type==='Polygon' ? [g.arcs] : g.arcs;
    polys.forEach(function(p){ p.forEach(function(r){ var pts=stitch(r); if(pts.length>2) c.rings.push(pack(pts)); }); });
  });
  CODES.forEach(function(id){
    var m=META[id]||{}, c=COUNTRIES[id];
    c.name=m.n||id; c.flag=m.fl||''; c.region=m.sub||m.reg||''; c.cap=m.cap||'';
    c.area=m.ar||0; c.ind=!!m.ind; c.bd=m.bd||[];
    c.lat=(m.ll&&m.ll[0])||0; c.lon=(m.ll&&m.ll[1])||0;
    c.keys=[m.n,m.a2].concat(m.alt||[]).filter(Boolean).map(norm);
  });
  DRAW=CODES.slice().sort(function(a,b){ return COUNTRIES[b].area-COUNTRIES[a].area; });
}

/* --------------------------------------------------------------- distance */
function haversine(a1,o1,a2,o2){
  var p1=a1*RAD,p2=a2*RAD,dp=(a2-a1)*RAD,dl=(o2-o1)*RAD;
  var h=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function bearing(a1,o1,a2,o2){
  var p1=a1*RAD,p2=a2*RAD,dl=(o2-o1)*RAD;
  var y=Math.sin(dl)*Math.cos(p2), x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
  return (Math.atan2(y,x)*DEG+360)%360;
}
var ARROWS=['↑','↗','→','↘','↓','↙','←','↖'];
function arrow(b){ return ARROWS[Math.round(b/45)%8]; }
function proximity(km){ return Math.max(0,1-km/MAXKM); }
var RAMP=[[168,201,216],[226,214,178],[233,179,80],[219,126,64],[205,72,48],[150,28,26]];
function rampColor(t){
  t=Math.max(0,Math.min(1,t))*(RAMP.length-1);
  var i=Math.min(RAMP.length-2,Math.floor(t)), f=t-i, a=RAMP[i], b=RAMP[i+1];
  return 'rgb('+Math.round(a[0]+(b[0]-a[0])*f)+','+Math.round(a[1]+(b[1]-a[1])*f)+','+Math.round(a[2]+(b[2]-a[2])*f)+')';
}

/* ------------------------------------------------------------------ store */
var SK='mapdash.warmer.stats.v1', GK='mapdash.warmer.game.v1', OK='mapdash.warmer.opts.v1';
function ls(k,fb){ try{ var v=localStorage.getItem(k); return v?JSON.parse(v):fb; }catch(e){ return fb; } }
function put(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
var stats=ls(SK,{played:0,won:0,streak:0,best:0,total:0,dist:{}});
var opts=ls(OK,{hints:false,territories:false});
var game=null;

/* ------------------------------------------------------------------ markup */
var HTML=
'<div class="wm-stage">'+
  '<div class="wm-globe" id="wmWrap"><canvas id="wmCv"></canvas>'+
    '<div class="wm-tag" id="wmTag" style="display:none"></div></div>'+
'</div>'+
'<aside class="wm-side">'+
  '<div class="wm-top">'+
    '<div class="wm-title"><h2>Warmer</h2><span id="wmCount">0 guesses</span></div>'+
    '<div class="wm-combo" id="wmCombo">'+
      '<input id="wmIn" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"'+
      ' role="combobox" aria-expanded="false" aria-controls="wmSugg" aria-autocomplete="list"'+
      ' placeholder="Guess a country — spelling can be rough">'+
      '<ul class="wm-sugg" id="wmSugg" role="listbox" aria-label="Country suggestions" style="display:none"></ul>'+
    '</div>'+
    '<p class="wm-msg" id="wmMsg"></p>'+
  '</div>'+
  '<ol class="wm-list" id="wmList"></ol>'+
  '<p class="wm-empty" id="wmEmpty">Every guess paints its country by how close it is. Pale blue is a world away, red is nearly there, and anything touching the answer burns hottest.</p>'+
  '<div class="wm-legend"><div class="wm-bar"></div>'+
    '<div class="wm-ends"><span>Ice cold</span><span>Red hot</span></div></div>'+
  '<div class="wm-acts">'+
    '<button class="wm-btn" id="wmNew">New country</button>'+
    '<button class="wm-btn sec" id="wmGive">Give up</button>'+
    '<button class="wm-btn sec" id="wmOpts" title="Options">Options</button>'+
  '</div>'+
'</aside>';

/* --------------------------------------------------------------- elements */
var cv,ctx,wrap,inp,sugg,combo,msgEl,listEl,countEl,emptyEl,tagEl;
function $w(id){ return document.getElementById(id); }

/* ------------------------------------------------------------------- game */
function pool(){ return CODES.filter(function(id){ return opts.territories?true:COUNTRIES[id].ind; }); }
function newGame(){
  var p=pool(), id=p[Math.floor(Math.random()*p.length)];
  if(game && game.answer===id && p.length>1) id=p[(p.indexOf(id)+1)%p.length];
  game={answer:id,guesses:[],done:false,gaveUp:false};
  put(GK,game); say(''); if(inp){ inp.value=''; } closeSugg();
  spin=0.22; render(); flyTo(20,0,700);
}
function restore(){
  var g=ls(GK,null);
  if(g && g.answer && window.MAPDASH_DATA.m[g.answer] && Array.isArray(g.guesses)){
    g.guesses=g.guesses.filter(function(id){ return !!COUNTRIES[id]; });
    game=g; return true;
  }
  return false;
}
function info(id){
  var c=COUNTRIES[id], a=COUNTRIES[game.answer];
  var km=haversine(c.lat,c.lon,a.lat,a.lon);
  var border = id!==game.answer && (c.bd.indexOf(game.answer)>=0 || a.bd.indexOf(id)>=0);
  var t = id===game.answer ? 1 : (border?1:Math.pow(proximity(km),4));
  return {id:id,c:c,km:km,border:border,t:t,prox:id===game.answer?1:proximity(km),
          bear:bearing(c.lat,c.lon,a.lat,a.lon)};
}
function guess(id){
  if(!game||game.done) return;
  if(game.guesses.indexOf(id)>=0){ say(COUNTRIES[id].name+' is already on the board.','warn'); flyToCountry(id); return; }
  game.guesses.push(id);
  if(id===game.answer){
    game.done=true;
    var n=game.guesses.length;
    stats.played++; stats.won++; stats.total+=n; stats.streak++;
    if(stats.streak>stats.best) stats.best=stats.streak;
    stats.dist[n]=(stats.dist[n]||0)+1; put(SK,stats);
    say(COUNTRIES[id].name+' it is — found in '+n+' '+(n===1?'guess':'guesses')+'.','good');
  } else say('');
  put(GK,game); render(); flyToCountry(id);
  inp.value=''; closeSugg();
}
function giveUp(){
  if(!game||game.done) return;
  game.done=true; game.gaveUp=true;
  if(game.guesses.indexOf(game.answer)<0) game.guesses.push(game.answer);
  stats.played++; stats.streak=0; put(SK,stats); put(GK,game);
  say('It was '+COUNTRIES[game.answer].name+'.','warn');
  render(); flyToCountry(game.answer);
}

/* ----------------------------------------------------------------- search */
function search(raw){
  var q=norm(raw); if(!q) return [];
  var out=[];
  for(var i=0;i<CODES.length;i++){
    var c=COUNTRIES[CODES[i]], best=0;
    for(var k=0;k<c.keys.length;k++){
      var key=c.keys[k], s=0;
      if(key===q) s=1000;
      else if(key.indexOf(q)===0) s=700-Math.min(80,key.length-q.length);
      else if((' '+key).indexOf(' '+q)>0) s=560;
      else if(key.indexOf(q)>0) s=430;
      else{
        var cap=q.length<=4?1:(q.length<=6?2:3), d=lev(q,key,cap);
        if(d<=cap) s=380-d*45;
        else{
          var w=key.split(' ');
          for(var wi=0;wi<w.length;wi++) if(w[wi].length>3 && lev(q,w[wi],cap)<=cap) s=Math.max(s,330);
          if(!s && q.length>=4 && subseq(q,key)) s=200-Math.min(60,key.length-q.length);
        }
      }
      if(k>0 && s>0) s-=12;
      if(s>best) best=s;
    }
    if(best>0) out.push({id:CODES[i],s:best,c:c});
  }
  out.sort(function(a,b){ return b.s-a.s || a.c.name.length-b.c.name.length || a.c.name.localeCompare(b.c.name); });
  return out.slice(0,8);
}

/* ------------------------------------------------------------- suggestions */
var results=[], cursor=-1;
function esc(s){ return String(s).replace(/[&<>"]/g,function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]; }); }
function hilite(name,q){
  var nq=norm(q); if(!nq) return esc(name);
  var nn=norm(name), i=nn.indexOf(nq);
  if(i<0 || nn.length!==name.length) return esc(name);
  return esc(name.slice(0,i))+'<b>'+esc(name.slice(i,i+nq.length))+'</b>'+esc(name.slice(i+nq.length));
}
function openSugg(){
  var q=inp.value.trim();
  results=search(q); cursor=results.length?0:-1;
  var html='';
  if(!q) html='<li class="wm-hint">Type any country — close enough spelling still finds it.</li>';
  else if(!results.length) html='<li class="wm-hint">No country matches “'+esc(q)+'”.</li>';
  else for(var i=0;i<results.length;i++){
    var c=results[i].c, used=game&&game.guesses.indexOf(c.id)>=0;
    html+='<li role="option" id="wmo'+i+'" data-i="'+i+'" aria-selected="'+(i===cursor)+'">'+
      '<span class="fl">'+c.flag+'</span><span class="nm">'+hilite(c.name,q)+'</span>'+
      '<span class="rg">'+(used?'guessed':esc(c.region))+'</span></li>';
  }
  sugg.innerHTML=html; sugg.style.display='block'; inp.setAttribute('aria-expanded','true');
  syncCursor();
}
function closeSugg(){
  if(!sugg) return;
  sugg.style.display='none'; inp.setAttribute('aria-expanded','false');
  inp.removeAttribute('aria-activedescendant'); results=[]; cursor=-1;
}
function syncCursor(){
  var items=sugg.querySelectorAll('li[role="option"]');
  for(var i=0;i<items.length;i++) items[i].setAttribute('aria-selected', i===cursor);
  if(cursor>=0 && items[cursor]){
    inp.setAttribute('aria-activedescendant','wmo'+cursor);
    var e=items[cursor], top=e.offsetTop, bot=top+e.offsetHeight;
    if(top<sugg.scrollTop) sugg.scrollTop=top-4;
    else if(bot>sugg.scrollTop+sugg.clientHeight) sugg.scrollTop=bot-sugg.clientHeight+4;
  }
}
function say(t,cls){ if(msgEl){ msgEl.textContent=t; msgEl.className='wm-msg'+(cls?' '+cls:''); } }
function commit(){
  if(game&&game.done){ say('Round over — start a new country.','warn'); return; }
  var pick = cursor>=0&&results[cursor] ? results[cursor] : (search(inp.value)[0]||null);
  if(!pick){
    combo.classList.add('shake'); setTimeout(function(){ combo.classList.remove('shake'); },340);
    say(inp.value.trim()?'No country matches “'+inp.value.trim()+'”.':'Type a country first.','warn');
    return;
  }
  guess(pick.id);
}

/* ------------------------------------------------------------------ globe */
var view={lat:18,lon:6}, spin=0.22, anim=null, dpr=1, cw=0, ch=0, dragging=false, rafId=0;
var reduce=false;
try{ reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}

function resize(){
  if(!wrap) return;
  var r=wrap.getBoundingClientRect();
  dpr=Math.min(2,window.devicePixelRatio||1);
  cw=Math.max(1,Math.round(r.width)); ch=Math.max(1,Math.round(r.height));
  cv.width=cw*dpr; cv.height=ch*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  draw();
}
function limb(x,y,ox,oy,R){ var dx=x-ox,dy=y-oy,m=Math.hypot(dx,dy)||1; return [ox+dx/m*R, oy+dy/m*R]; }
function ring(rg,R,ox,oy,sA,cA,sO,cO){
  var d=rg.d,n=rg.n,started=false,prev=false,px=0,py=0,pc=0;
  for(var i=0;i<=n;i++){
    var k=(i%n)*4, sl=d[k],cl=d[k+1],so=d[k+2],co=d[k+3];
    var cd=co*cO+so*sO, sd=so*cO-co*sO;
    var cosc=sA*sl+cA*cl*cd;
    var x=ox+R*(cl*sd), y=oy-R*(cA*sl-sA*cl*cd), vis=cosc>0;
    if(i>0){
      if(vis&&prev) ctx.lineTo(x,y);
      else if(vis&&!prev){
        var t=pc/(pc-cosc), e=limb(px+(x-px)*t, py+(y-py)*t, ox,oy,R);
        if(started) ctx.lineTo(e[0],e[1]); else { ctx.moveTo(e[0],e[1]); started=true; }
        ctx.lineTo(x,y);
      } else if(!vis&&prev){
        var t2=pc/(pc-cosc), e2=limb(px+(x-px)*t2, py+(y-py)*t2, ox,oy,R);
        ctx.lineTo(e2[0],e2[1]);
      }
    } else if(vis){ ctx.moveTo(x,y); started=true; }
    px=x; py=y; pc=cosc; prev=vis;
  }
  if(started) ctx.closePath();
  return started;
}
function draw(){
  if(!cw||!ctx) return;
  var R=Math.min(cw,ch)/2-8, ox=cw/2, oy=ch/2;
  ctx.clearRect(0,0,cw,ch);
  var sA=Math.sin(view.lat*RAD), cA=Math.cos(view.lat*RAD),
      sO=Math.sin(view.lon*RAD), cO=Math.cos(view.lon*RAD);

  var g=ctx.createRadialGradient(ox-R*0.32,oy-R*0.36,R*0.06,ox,oy,R*1.08);
  g.addColorStop(0,'#1a4459'); g.addColorStop(1,'#0a1c28');
  ctx.beginPath(); ctx.arc(ox,oy,R,0,6.2832); ctx.fillStyle=g; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(ox,oy,R,0,6.2832); ctx.clip();

  ctx.strokeStyle='rgba(255,255,255,.09)'; ctx.lineWidth=0.7;
  var la,lo,on,X,Y,cl,sl,so,co,cd,sd;
  for(la=-60;la<=60;la+=30){
    ctx.beginPath(); on=false; cl=Math.cos(la*RAD); sl=Math.sin(la*RAD);
    for(lo=-180;lo<=180;lo+=3){
      so=Math.sin(lo*RAD); co=Math.cos(lo*RAD); cd=co*cO+so*sO; sd=so*cO-co*sO;
      if(sA*sl+cA*cl*cd<=0){ on=false; continue; }
      X=ox+R*(cl*sd); Y=oy-R*(cA*sl-sA*cl*cd);
      if(on) ctx.lineTo(X,Y); else { ctx.moveTo(X,Y); on=true; }
    }
    ctx.stroke();
  }
  for(lo=-180;lo<180;lo+=30){
    ctx.beginPath(); on=false; so=Math.sin(lo*RAD); co=Math.cos(lo*RAD);
    cd=co*cO+so*sO; sd=so*cO-co*sO;
    for(la=-90;la<=90;la+=3){
      cl=Math.cos(la*RAD); sl=Math.sin(la*RAD);
      if(sA*sl+cA*cl*cd<=0){ on=false; continue; }
      X=ox+R*(cl*sd); Y=oy-R*(cA*sl-sA*cl*cd);
      if(on) ctx.lineTo(X,Y); else { ctx.moveTo(X,Y); on=true; }
    }
    ctx.stroke();
  }

  var camx=cA*cO, camy=sA, camz=cA*sO;
  var moving = dragging || anim || (spin!==0 && !reduce);
  var colors={}, i;
  if(game) for(i=0;i<game.guesses.length;i++){ var gi=info(game.guesses[i]); colors[gi.id]=rampColor(gi.t); }
  ctx.lineJoin='round';
  for(i=0;i<DRAW.length;i++){
    var c=COUNTRIES[DRAW[i]], col=colors[c.id], any=false;
    ctx.beginPath();
    for(var r=0;r<c.rings.length;r++){
      var rg=c.rings[r];
      if(moving && rg.tiny && !col) continue;
      if(rg.cx*camx+rg.cy*camy+rg.cz*camz < -rg.sr) continue;
      if(ring(rg,R,ox,oy,sA,cA,sO,cO)) any=true;
    }
    if(!any) continue;
    ctx.fillStyle = col || '#2c3746'; ctx.fill('evenodd');
    ctx.lineWidth = col?0.9:0.55;
    ctx.strokeStyle = col?'rgba(255,255,255,.5)':'#3d4b5d';
    ctx.stroke();
    if(game && game.done && c.id===game.answer){ ctx.lineWidth=2.4; ctx.strokeStyle='#e9b350'; ctx.stroke(); }
  }
  ctx.restore();

  var sh=ctx.createRadialGradient(ox-R*0.3,oy-R*0.34,R*0.1,ox,oy,R);
  sh.addColorStop(0,'rgba(0,0,0,0)'); sh.addColorStop(.72,'rgba(0,0,0,0)'); sh.addColorStop(1,'rgba(2,10,16,.45)');
  ctx.beginPath(); ctx.arc(ox,oy,R,0,6.2832); ctx.fillStyle=sh; ctx.fill();
  ctx.lineWidth=1; ctx.strokeStyle='rgba(255,255,255,.13)'; ctx.stroke();
}
var last=0;
function frame(ts){
  if(!live){ rafId=0; return; }
  var dt=last?Math.min(48,ts-last):16; last=ts;
  var need=false;
  if(anim){
    anim.t+=dt;
    var k=Math.min(1,anim.t/anim.dur), e=1-Math.pow(1-k,3);
    view.lat=anim.fl+(anim.tl-anim.fl)*e;
    view.lon=anim.fo+(anim.to-anim.fo)*e;
    if(k>=1) anim=null;
    need=true;
  } else if(spin && !dragging && !reduce){ view.lon=(view.lon+spin*dt/16+540)%360-180; need=true; }
  if(need) draw();
  rafId=requestAnimationFrame(frame);
}
function flyTo(lat,lon,dur){
  var d=((lon-view.lon+540)%360)-180;
  anim={fl:view.lat,fo:view.lon,tl:Math.max(-72,Math.min(72,lat)),to:view.lon+d,t:0,dur:reduce?1:(dur||820)};
}
function flyToCountry(id){ var c=COUNTRIES[id]; if(c) flyTo(c.lat,c.lon); }

/* ------------------------------------------------------------------ render */
function render(){
  if(!listEl) return;
  var n=game?game.guesses.length:0;
  countEl.textContent = n+' '+(n===1?'guess':'guesses');
  emptyEl.style.display = n?'none':'block';
  var rows = game?game.guesses.map(info):[];
  rows.sort(function(a,b){ return b.prox-a.prox; });
  var html='';
  for(var i=0;i<rows.length;i++){
    var g=rows[i], win=(g.id===game.answer);
    html+='<li data-id="'+g.id+'"'+(win?' class="win"':'')+'>'+
      '<span class="sw" style="background:'+rampColor(g.t)+'"></span>'+
      '<span class="fl">'+g.c.flag+'</span><span class="nm">'+esc(g.c.name)+'</span>'+
      (opts.hints&&!win
        ? '<span class="pc">'+Math.round(g.km).toLocaleString()+' km</span><span class="dir">'+arrow(g.bear)+'</span>'
        : '<span class="pc">'+(win?'✓':Math.round(g.prox*100)+'%')+'</span>')+
      '</li>';
  }
  listEl.innerHTML=html;
  if(game&&game.done){
    var a=COUNTRIES[game.answer];
    tagEl.style.display='flex';
    tagEl.innerHTML='<span class="fl">'+a.flag+'</span><span>'+esc(a.name)+'</span>'+
      (a.cap?'<span class="cap">'+esc(a.cap)+'</span>':'');
  } else tagEl.style.display='none';
  var gv=$w('wmGive'); if(gv) gv.style.display = (game&&!game.done)?'':'none';
  draw();
}

/* ----------------------------------------------------------------- options */
function showOpts(){
  var avg = stats.won ? (stats.total/stats.won).toFixed(1) : '–';
  var v=document.createElement('div'); v.className='veil'; v.id='veil';
  v.innerHTML='<div class="card">'+
    '<h2>Warmer</h2>'+
    '<div class="lede" style="text-align:center;color:var(--ink3);font-size:13px;margin-top:4px">Kept on this device. No account, ever.</div>'+
    '<div class="statgrid" style="margin-top:18px">'+
      '<div class="stat"><div class="v">'+stats.played+'</div><div class="l">Rounds</div></div>'+
      '<div class="stat"><div class="v">'+(stats.played?Math.round(stats.won/stats.played*100):0)+'%</div><div class="l">Solved</div></div>'+
      '<div class="stat"><div class="v">'+avg+'</div><div class="l">Avg guesses</div></div>'+
      '<div class="stat"><div class="v">'+stats.streak+'</div><div class="l">Streak</div></div>'+
    '</div>'+
    '<label class="wm-opt"><span><b>Show distance and direction</b><i>Exact kilometres and an arrow on every guess. Much easier.</i></span>'+
      '<input type="checkbox" id="wmO1"'+(opts.hints?' checked':'')+'></label>'+
    '<label class="wm-opt"><span><b>Territories can be the answer</b><i>Adds Greenland, Puerto Rico, Hong Kong and 40 more to the 195 sovereign states. Applies next round.</i></span>'+
      '<input type="checkbox" id="wmO2"'+(opts.territories?' checked':'')+'></label>'+
    '<button class="bigbtn" id="wmDone" style="margin-top:16px">Done</button>'+
  '</div>';
  root.appendChild(v);
  v.addEventListener('keydown',function(e){ e.stopPropagation(); });
  v.querySelector('#wmO1').onchange=function(){ opts.hints=this.checked; put(OK,opts); render(); };
  v.querySelector('#wmO2').onchange=function(){ opts.territories=this.checked; put(OK,opts); };
  v.querySelector('#wmDone').onclick=function(){ v.remove(); };
}

/* -------------------------------------------------------------------- wire */
function mount(){
  root=document.getElementById('warmer');
  root.innerHTML=HTML;
  cv=$w('wmCv'); ctx=cv.getContext('2d'); wrap=$w('wmWrap');
  inp=$w('wmIn'); sugg=$w('wmSugg'); combo=$w('wmCombo'); msgEl=$w('wmMsg');
  listEl=$w('wmList'); countEl=$w('wmCount'); emptyEl=$w('wmEmpty'); tagEl=$w('wmTag');

  inp.addEventListener('input',openSugg);
  inp.addEventListener('focus',openSugg);
  inp.addEventListener('blur',function(){ setTimeout(closeSugg,140); });
  inp.addEventListener('keydown',function(e){
    e.stopPropagation();
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();
      if(sugg.style.display==='none') openSugg();
      if(!results.length) return;
      cursor=(cursor+(e.key==='ArrowDown'?1:results.length-1))%results.length;
      syncCursor();
    } else if(e.key==='Enter'){ e.preventDefault(); commit(); }
    else if(e.key==='Escape'){ closeSugg(); }
  });
  sugg.addEventListener('mousedown',function(e){
    var li=e.target.closest('li[data-i]'); if(!li) return;
    e.preventDefault(); cursor=+li.dataset.i; commit();
  });
  listEl.addEventListener('click',function(e){
    var li=e.target.closest('li[data-id]'); if(li) flyToCountry(li.dataset.id);
  });
  $w('wmNew').onclick=function(){ newGame(); inp.focus(); };
  $w('wmGive').onclick=giveUp;
  $w('wmOpts').onclick=showOpts;

  wrap.addEventListener('pointerdown',function(e){
    dragging=true; dragMoved=0; anim=null; wrap.classList.add('drag');
    dx0=e.clientX; dy0=e.clientY; vlat=view.lat; vlon=view.lon;
    try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
  });
  wrap.addEventListener('pointermove',function(e){
    if(!dragging) return;
    var R=Math.min(cw,ch)/2-8, f=90/Math.max(60,R);
    var dx=e.clientX-dx0, dy=e.clientY-dy0;
    dragMoved=Math.max(dragMoved,Math.abs(dx)+Math.abs(dy));
    view.lon=((vlon-dx*f)+540)%360-180;
    view.lat=Math.max(-85,Math.min(85,vlat+dy*f));
    draw();
  });
  function end(){ if(!dragging) return; dragging=false; wrap.classList.remove('drag'); if(dragMoved>6) spin=0; }
  wrap.addEventListener('pointerup',end);
  wrap.addEventListener('pointercancel',end);
  window.addEventListener('resize',function(){ if(live) resize(); });
}
var dx0=0,dy0=0,vlat=0,vlon=0,dragMoved=0;

return {
  open:function(){
    build();
    if(!root) mount();
    root.style.display='flex';
    document.body.classList.add('warming');
    live=true; last=0;
    if(!game && !restore()) newGame();
    render(); resize();
    if(!rafId) rafId=requestAnimationFrame(frame);
    setTimeout(function(){ resize(); if(window.innerWidth>820) inp.focus(); },30);
  },
  close:function(){
    live=false;
    document.body.classList.remove('warming');
    if(rafId){ cancelAnimationFrame(rafId); rafId=0; }
    if(root) root.style.display='none';
    closeSugg();
  }
};
})();
