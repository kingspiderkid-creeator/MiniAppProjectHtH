(function(){
'use strict';

/* ---------- helpers ---------- */
const $=(id)=>document.getElementById(id);
const pad=(n)=>String(n).padStart(2,'0');
const dayKey=(d)=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parseKey=(k)=>{const p=k.split('-').map(Number);return new Date(p[0],p[1]-1,p[2]);};
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
const today0=()=>{const d=new Date();d.setHours(0,0,0,0);return d;};
const startOfWeek=(d)=>addDays(d,-d.getDay());
const clone=(o)=>JSON.parse(JSON.stringify(o));
const fmtMin=(m)=>{m=Math.round(m);if(m<60)return m+'m';const hh=Math.floor(m/60),r=m%60;return r?hh+'h '+pad(r)+'m':hh+'h';};
const fmtTime=(t)=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const BASE_TITLE='Study Timer';

function h(tag,props){
  const e=document.createElement(tag);
  if(props)for(const k in props){
    const v=props[k];
    if(v==null||v===false)continue;
    if(k==='class')e.className=v;
    else if(k==='text')e.textContent=v;
    else if(k==='style')e.style.cssText=v;
    else if(k.slice(0,2)==='on')e.addEventListener(k.slice(2),v);
    else e.setAttribute(k,v===true?'':v);
  }
  for(let i=2;i<arguments.length;i++){
    const list=[].concat(arguments[i]);
    for(const c of list){ if(c==null||c===false)continue; e.append(c.nodeType?c:document.createTextNode(c)); }
  }
  return e;
}
const NS='http://www.w3.org/2000/svg';
function sv(tag,attrs){
  const e=document.createElementNS(NS,tag);
  for(const k in (attrs||{})){
    const v=attrs[k]; if(v==null)continue;
    if(k==='text')e.textContent=v; else e.setAttribute(k,v);
  }
  for(let i=2;i<arguments.length;i++){ const c=arguments[i]; if(c)e.append(c); }
  return e;
}

/* ---------- state ---------- */
const DEFAULTS={focus:25,short:5,long:15,cycles:4,goal:120,auto:false,sound:true,
  subjects:[{n:'Math',c:1},{n:'Reading',c:2},{n:'Writing',c:3}],current:'Math',
  character:{name:'Hana',style:'twin',hair:'violet',eyes:'violet',skin:'light',acc:'sakura'}};
const state={settings:clone(DEFAULTS),days:{},tasks:[]};
const S=()=>state.settings;
let demo=false, demoDays={};
let settingsDirty=false, tasksDirty=false; const dirty=new Set();

function normDay(d){return {sessions:Array.isArray(d&&d.sessions)?d.sessions:[],plans:Array.isArray(d&&d.plans)?d.plans:[]};}
function normSettings(o){
  const s=Object.assign(clone(DEFAULTS),o||{});
  if(!Array.isArray(s.subjects))s.subjects=clone(DEFAULTS.subjects);
  s.subjects=s.subjects.filter(x=>x&&typeof x.n==='string').map(x=>({n:x.n,c:Math.min(6,Math.max(1,Math.round(x.c)||1))}));
  if(!s.subjects.some(x=>x.n===s.current))s.current=s.subjects.length?s.subjects[0].n:'';
  s.character=cleanChar(s.character);
  return s;
}
function mergeDay(a,b){
  const seen=new Set(), sessions=[];
  a.sessions.concat(b.sessions).forEach(x=>{const k=x.t+'|'+x.n+'|'+x.m;if(!seen.has(k)){seen.add(k);sessions.push(x);}});
  const pm=new Map(); a.plans.concat(b.plans).forEach(p=>pm.set(p.id,p));
  return {sessions:sessions,plans:Array.from(pm.values())};
}
const dayDoc=(key)=>state.days[key]||(state.days[key]=normDay(null));
const vd=()=>demo?demoDays:state.days;
const sessionsOn=(key)=>(vd()[key]&&vd()[key].sessions)||[];
const plansOn=(key)=>(state.days[key]&&state.days[key].plans)||[];
const minutesOn=(key)=>sessionsOn(key).reduce((a,x)=>a+(+x.m||0),0);
function colorVar(name){const s=S().subjects.find(x=>x.n===name);return s?'var(--c'+s.c+')':'var(--c0)';}

/* ---------- persistence ---------- */
const LS='study-timer:v1';
let mode='local', col=null, resolveReady; const ready=new Promise(r=>{resolveReady=r;});
const queues=new Map();
function setSync(msg){ $('sync').textContent=msg; }
function lsRead(){try{const r=localStorage.getItem(LS);return r?JSON.parse(r):null;}catch(e){return null;}}
function lsWrite(){try{localStorage.setItem(LS,JSON.stringify({settings:state.settings,days:state.days,tasks:state.tasks}));}catch(e){}}
function payload(id){ if(id==='settings')return clone(state.settings); if(id==='tasks')return {items:clone(state.tasks)}; return clone(state.days[id.slice(2)]||normDay(null)); }
function persist(id){
  const prev=queues.get(id)||ready;
  const next=prev.then(async function(){
    if(mode==='db'){
      try{ await col.doc(id).set(payload(id)); setSync('Saved to your Claude account'); }
      catch(e){ setSync('Your last change could not be saved. It stays on screen until you reload.'); }
    }else{ lsWrite(); }
  });
  queues.set(id,next);
}
function saveSettings(){ settingsDirty=true; persist('settings'); }
function saveDay(key){ dirty.add(key); persist('d_'+key); }

function applyLoaded(settingsObj,daysObj,tasksObj){
  if(tasksObj&&!tasksDirty&&Array.isArray(tasksObj.items))state.tasks=tasksObj.items.filter(x=>x&&typeof x.title==='string'&&x.id).map(x=>({id:String(x.id),title:x.title,n:x.n||'',done:!!x.done}));
  if(settingsObj&&!settingsDirty)state.settings=normSettings(settingsObj);
  for(const k in daysObj){
    const inc=normDay(daysObj[k]);
    state.days[k]=(dirty.has(k)&&state.days[k])?mergeDay(inc,state.days[k]):inc;
  }
  if(T.status==='idle'){T.total=durationFor(T.mode);T.remaining=T.total;}
}
async function initStore(){
  let db=null,uid=null;
  try{
    if(window.claude&&typeof window.claude.use==='function'){
      const r=await Promise.all([window.claude.use('db'),window.claude.use('user')]);
      db=r[0]; uid=r[1]?await r[1].id():null;
    }
  }catch(e){ db=null; }
  let loaded=false;
  if(db&&uid){
    try{
      col=db.collection('data/users/'+uid);
      const snap=await col.get();
      let sObj=null,tObj=null; const dObj={};
      snap.docs.forEach(function(doc){
        const id=doc.id, data=doc.data();
        if(!data)return;
        if(id==='settings')sObj=data; else if(id==='tasks')tObj=data; else if(id.indexOf('d_')===0)dObj[id.slice(2)]=data;
      });
      applyLoaded(sObj,dObj,tObj); mode='db'; loaded=true;
      setSync('Saved to your Claude account');
    }catch(e){ col=null; }
  }
  if(!loaded){
    mode='local';
    const saved=lsRead();
    if(saved)applyLoaded(saved.settings,saved.days||{},Array.isArray(saved.tasks)?{items:saved.tasks}:null);
    setSync('Stored in this browser only');
  }
  resolveReady(); renderAll();
}

/* ---------- timer ---------- */
const T={mode:'focus',status:'idle',total:0,remaining:0,endAt:0,cycle:0};
function durationFor(m){const s=S();return Math.round((m==='focus'?s.focus:m==='short'?s.short:s.long)*60);}
const MODE_NAME={focus:'Focus',short:'Short break',long:'Long break'};
const POT_LABEL={focus:'COOKING',short:'KEEP WARM',long:'RESTING'};
let potDone=false,potTimer=0;
T.total=durationFor('focus'); T.remaining=T.total;
let lastTxt='', lastElapsedTicks=-1, noticeTimer=0, actx=null;

function notice(msg){
  $('notice').textContent=msg;
  clearTimeout(noticeTimer);
  if(msg)noticeTimer=setTimeout(function(){$('notice').textContent='';},9000);
}
function ensureAudio(){
  try{
    if(!actx){const C=window.AudioContext||window.webkitAudioContext;if(C)actx=new C();}
    if(actx&&actx.state==='suspended')actx.resume();
  }catch(e){}
}
function chime(force){
  if((!S().sound&&!force)||!actx)return;
  try{
    const t0=actx.currentTime+0.05, notes=[1319,1568,1760,1568,1319,1760,2093];
    notes.forEach(function(f,i){
      const ts=t0+i*0.2;
      [[f,0.16,'triangle'],[f*2,0.05,'sine']].forEach(function(p){
        const o=actx.createOscillator(),g=actx.createGain();
        o.type=p[2];o.frequency.value=p[0];
        g.gain.setValueAtTime(0.0001,ts);
        g.gain.linearRampToValueAtTime(p[1],ts+0.01);
        g.gain.exponentialRampToValueAtTime(0.0001,ts+0.45);
        o.connect(g);g.connect(actx.destination);o.start(ts);o.stop(ts+0.5);
      });
    });
  }catch(e){}
}
function updatePot(){
  const d=$('dial');
  d.dataset.state=potDone?'done':(T.status==='running'?'running':'idle');
  d.dataset.mood=potDone?'done':(T.mode!=='focus'?'rest':(T.status==='running'?'focus':'idle'));
  $('potLabel').textContent=potDone?'READY!':POT_LABEL[T.mode];
}
function celebrate(){
  potDone=true;updatePot();
  clearTimeout(potTimer);
  potTimer=setTimeout(function(){potDone=false;updatePot();},9000);
}
function setMode(m){
  T.mode=m;T.total=durationFor(m);T.remaining=T.total;T.status='idle';T.endAt=0;
  renderTimer(true);
}
function start(){
  ensureAudio();potDone=false;
  T.endAt=Date.now()+T.remaining*1000;T.status='running';
  renderTimer(true);
}
function pause(){
  T.remaining=Math.max(0,Math.ceil((T.endAt-Date.now())/1000));
  T.status='paused';renderTimer(true);
}
function logSession(m){
  const now=Date.now(), key=dayKey(new Date(now));
  dayDoc(key).sessions.push({t:now,m:m,n:S().current||'Unsorted'});
  saveDay(key);
}
function complete(early){
  const wasFocus=T.mode==='focus';
  const elapsed=T.total-T.remaining;
  T.status='idle';T.endAt=0;
  if(wasFocus){
    const m=early?Math.round(elapsed/60):Math.round(T.total/60);
    if(m>=1){
      logSession(m);T.cycle++;
      notice((early?'Logged ':'Ding! '+S().character.name+"'s rice is ready. ")+fmtMin(m)+' of '+(S().current||'Unsorted')+'.');
    }
  }else if(!early){
    notice('Break over. Ready for the next session.');
  }
  if(!early){chime();celebrate();}
  const next=wasFocus?((T.cycle>0&&T.cycle%S().cycles===0)?'long':'short'):'focus';
  setMode(next);
  renderToday();renderPlansToday();
  if(active==='dashboard')renderDashboard();
  
  if(!early&&S().auto)start();
}
function tick(){
  if(T.status==='running'){
    const rem=Math.ceil((T.endAt-Date.now())/1000);
    T.remaining=Math.max(0,rem);
    if(rem<=0){complete(false);return;}
    renderTimer(false);
  }
}
setInterval(tick,250);
document.addEventListener('visibilitychange',tick);

/* rice cooker progress: one grain per twelfth of the session */
const GR=12, grains=Array.from(document.querySelectorAll('#potSvg .grain'));

function renderTimer(full){
  const rem=T.remaining, txt=pad(Math.floor(rem/60))+':'+pad(rem%60);
  if(full||txt!==lastTxt){
    $('dialTime').textContent=txt;$('potTime').textContent=txt;lastTxt=txt;
    document.title=(T.status==='running')?txt+' · '+(T.mode==='focus'?'Focus':'Break'):BASE_TITLE;
  }
  const et=Math.min(GR,Math.floor((1-rem/Math.max(1,T.total))*GR));
  if(full||et!==lastElapsedTicks){
    lastElapsedTicks=et;
    grains.forEach(function(g,i){g.classList.toggle('on',i<et);});
  }
  const elapsed=T.total-rem;
  $('btnFinish').hidden=!(T.mode==='focus'&&T.status!=='idle'&&elapsed>=60);
  if(!full)return;
  $('dial').dataset.mode=T.mode;
  updatePot();
  const ft=T.mode==='focus'?state.tasks.find(x=>x.id===focusTaskId&&!x.done):null;
  $('dialSub').textContent=T.mode==='focus'?(ft?ft.title:(S().current||'No subject')):(T.mode==='short'?'Stand up and stretch':'Step away from the desk');
  $('btnMain').textContent=T.status==='running'?'Pause':(T.status==='paused'?'Resume':'Start');
  $('btnReset').disabled=(T.status==='idle'&&T.remaining===T.total);
  $('btnSkip').hidden=T.mode==='focus';
  document.querySelectorAll('.modes .seg').forEach(function(b){
    b.setAttribute('aria-pressed',b.dataset.mode===T.mode?'true':'false');
    b.disabled=T.status==='running';
  });
  const per=S().cycles, filled=T.mode==='long'?per:(T.cycle%per), pips=$('pips');
  pips.replaceChildren();
  for(let i=0;i<per;i++)pips.append(h('i',{class:i<filled?'done':(T.mode==='focus'&&i===filled?'active':'')}));
}
$('btnMain').addEventListener('click',function(){ if(T.status==='running')pause(); else start(); });
$('btnReset').addEventListener('click',function(){ potDone=false; setMode(T.mode); });
$('btnFinish').addEventListener('click',function(){ if(T.status==='running')pause(); complete(true); });
$('btnSkip').addEventListener('click',function(){ complete(true); });
document.querySelectorAll('.modes .seg').forEach(function(b){
  b.addEventListener('click',function(){ if(T.status!=='running'){potDone=false;setMode(b.dataset.mode);} });
});

/* subjects */
function renderChips(){
  const box=$('chips');box.replaceChildren();
  S().subjects.forEach(function(sub){
    const on=sub.n===S().current;
    box.append(h('span',{class:'chip'+(on?' on':'')},
      h('button',{type:'button',class:'chip-main','aria-pressed':on?'true':'false',onclick:function(){
        S().current=sub.n;saveSettings();renderChips();renderTimer(true);
      }},h('i',{class:'dot',style:'background:var(--c'+sub.c+')'}),sub.n),
      h('button',{type:'button',class:'chip-x','aria-label':'Remove '+sub.n,onclick:function(){removeSubject(sub.n);}},'×')));
  });
  if(!S().subjects.length)box.append(h('span',{class:'muted',text:'Add a subject to tag your sessions.'}));
  const sel=$('planSubject'), keep=sel.value;
  sel.replaceChildren(h('option',{value:'',text:'No subject'}));
  S().subjects.forEach(function(s){sel.append(h('option',{value:s.n,text:s.n}));});
  sel.value=keep;
  const sel2=$('taskSubject'), keep2=sel2.value;
  sel2.replaceChildren(h('option',{value:'',text:'No subject'}));
  S().subjects.forEach(function(s){sel2.append(h('option',{value:s.n,text:s.n}));});
  sel2.value=keep2;
}
function removeSubject(n){
  const s=S();
  s.subjects=s.subjects.filter(x=>x.n!==n);
  if(s.current===n)s.current=s.subjects.length?s.subjects[0].n:'';
  saveSettings();renderChips();renderTimer(true);
}
function nextColor(){
  const used=new Set(S().subjects.map(x=>x.c));
  for(let c=1;c<=6;c++)if(!used.has(c))return c;
  return (S().subjects.length%6)+1;
}
$('subjForm').addEventListener('submit',function(e){
  e.preventDefault();
  const inp=$('subjInput'), name=inp.value.trim().slice(0,24);
  if(!name)return;
  const hit=S().subjects.find(x=>x.n.toLowerCase()===name.toLowerCase());
  if(hit){S().current=hit.n;}
  else if(S().subjects.length>=12){notice('You can keep up to 12 subjects.');return;}
  else{S().subjects.push({n:name,c:nextColor()});S().current=name;}
  inp.value='';saveSettings();renderChips();renderTimer(true);
});

/* today + plans on timer tab */
function sessionRow(x){
  return h('li',null,h('span',{class:'t',text:fmtTime(x.t)}),
    h('span',{class:'who'},h('i',{class:'dot',style:'background:'+colorVar(x.n)}),x.n),
    h('span',{class:'m',text:fmtMin(x.m)}));
}
function renderToday(){
  const key=dayKey(new Date()), list=state.days[key]?state.days[key].sessions.slice().sort((a,b)=>b.t-a.t):[];
  const total=list.reduce((a,x)=>a+x.m,0);
  $('todayTotal').textContent=fmtMin(total)+' of '+fmtMin(S().goal);
  const ul=$('todayList');ul.replaceChildren();
  if(!list.length)ul.append(h('li',{class:'empty-li',text:'No sessions yet today. Your first one will show up here.'}));
  list.forEach(function(x){ul.append(sessionRow(x));});
}
function togglePlan(key,id,done){
  const p=plansOn(key).find(x=>x.id===id);
  if(!p)return;
  p.done=done;saveDay(key);renderPlansToday();
  if(active==='dashboard')renderCalendar();
}
function planItem(key,p){
  return h('li',{class:'plan'+(p.done?' done':'')},
    h('input',{type:'checkbox',id:'pl-'+key+'-'+p.id,checked:p.done,onchange:function(e){togglePlan(key,p.id,e.target.checked);}}),
    h('label',{for:'pl-'+key+'-'+p.id,text:p.title}),
    (p.n||p.time)?h('span',{class:'meta',text:[p.time,p.n].filter(Boolean).join(' · ')}):null);
}
function renderPlansToday(){
  const key=dayKey(new Date()), plans=plansOn(key).slice();
  $('planCard').hidden=!plans.length;
  const ul=$('planToday');ul.replaceChildren();
  plans.sort((a,b)=>(a.time||'99').localeCompare(b.time||'99'));
  plans.forEach(function(p){ul.append(planItem(key,p));});
}

/* settings */
function bindNum(id,key,min,max){
  $(id).addEventListener('change',function(){
    let v=Math.round(Number($(id).value));
    if(!isFinite(v)||v<=0)v=DEFAULTS[key];
    v=Math.min(max,Math.max(min,v));
    $(id).value=v;S()[key]=v;saveSettings();
    if(T.status==='idle'){T.total=durationFor(T.mode);T.remaining=T.total;}
    renderTimer(true);renderToday();
    if(active==='dashboard')renderDashboard();
    
  });
}
bindNum('setFocus','focus',1,180);bindNum('setShort','short',1,60);bindNum('setLong','long',1,90);
bindNum('setCycles','cycles',2,8);bindNum('setGoal','goal',10,720);
$('setAuto').addEventListener('change',function(){S().auto=$('setAuto').checked;saveSettings();});
$('setSound').addEventListener('change',function(){S().sound=$('setSound').checked;saveSettings();});
$('testSound').addEventListener('click',function(){ensureAudio();chime(true);});
function syncSettingsInputs(){
  const s=S();
  $('setFocus').value=s.focus;$('setShort').value=s.short;$('setLong').value=s.long;
  $('setCycles').value=s.cycles;$('setGoal').value=s.goal;
  $('setAuto').checked=!!s.auto;$('setSound').checked=!!s.sound;
}

/* ---------- sample data (never saved) ---------- */
function rnd(x){const v=Math.sin(x*12.9898)*43758.5453;return v-Math.floor(v);}
function makeDemo(){
  const names=S().subjects.map(s=>s.n); if(!names.length)names.push('General');
  const out={}, t0=today0();
  for(let i=1;i<=35;i++){
    const d=addDays(t0,-i), r=rnd(i*7+3), dow=d.getDay();
    if(r<0.2||(dow===6&&r<0.6))continue;
    const n=1+Math.floor(rnd(i*13+5)*4), sessions=[];
    for(let k=0;k<n;k++){
      const m=[25,25,50,45][Math.floor(rnd(i*31+k*17)*4)], t=new Date(d);
      t.setHours(9+Math.floor(rnd(i*5+k)*11),Math.floor(rnd(k*3+i)*60));
      sessions.push({t:t.getTime(),m:m,n:names[Math.floor(rnd(i*11+k*29)*names.length)]});
    }
    out[dayKey(d)]={sessions:sessions,plans:[]};
  }
  return out;
}
function setDemo(on){
  demo=on;demoDays=on?makeDemo():{};
  updateDemoBar();
  if(active==='dashboard')renderDashboard();
  
}
function updateDemoBar(){ $('demoBar').hidden=!(demo&&active==='dashboard'); }
$('demoOn').addEventListener('click',function(){setDemo(true);});
$('demoOff').addEventListener('click',function(){setDemo(false);});

/* ---------- dashboard ---------- */
let range=14;
function tile(label,value,sub){
  return h('div',{class:'card tile'},h('div',{class:'tile-label',text:label}),h('div',{class:'tile-value',text:value}),sub);
}
function streakInfo(){
  const keys=Object.keys(vd()).filter(k=>minutesOn(k)>0).sort();
  const has=new Set(keys);
  let d=today0(); if(!has.has(dayKey(d)))d=addDays(d,-1);
  let cur=0; while(has.has(dayKey(d))){cur++;d=addDays(d,-1);}
  let best=0,run=0,prev=null;
  keys.forEach(function(k){
    const dt=parseKey(k);
    run=(prev&&Math.round((dt-prev)/86400000)===1)?run+1:1;
    if(run>best)best=run;prev=dt;
  });
  return {cur:cur,best:best};
}
function renderStats(){
  const t0=today0(), goal=S().goal, todayM=minutesOn(dayKey(t0));
  const ws=startOfWeek(t0); let wk=0,lw=0;
  for(let i=0;i<7;i++){wk+=minutesOn(dayKey(addDays(ws,i)));lw+=minutesOn(dayKey(addDays(ws,i-7)));}
  const st=streakInfo(); let total=0,count=0;
  Object.keys(vd()).forEach(function(k){sessionsOn(k).forEach(function(x){total+=+x.m||0;count++;});});
  const pct=Math.min(100,Math.round(todayM/goal*100));
  const box=$('stats');box.replaceChildren(
    tile('Today',fmtMin(todayM),h('div',{class:'tile-sub'},
      h('div',{class:'meter',role:'img','aria-label':pct+'% of daily goal'},h('span',{style:'width:'+pct+'%'})),
      h('span',{text:pct+'% of your '+fmtMin(goal)+' goal'}))),
    tile('This week',fmtMin(wk),h('div',{class:'tile-sub',text:'Last week '+fmtMin(lw)})),
    tile('Streak',st.cur+(st.cur===1?' day':' days'),h('div',{class:'tile-sub',text:'Best '+st.best+(st.best===1?' day':' days')})),
    tile('All time',fmtMin(total),h('div',{class:'tile-sub',text:count+(count===1?' session':' sessions')})));
}
function rangeDays(){
  const t0=today0(), out=[];
  for(let i=range-1;i>=0;i--){
    const date=addDays(t0,-i), key=dayKey(date), by={};
    let tot=0;
    sessionsOn(key).forEach(function(x){by[x.n]=(by[x.n]||0)+(+x.m||0);tot+=(+x.m||0);});
    out.push({date:date,key:key,by:by,total:tot});
  }
  return out;
}
function subjectOrder(days){
  const names=S().subjects.map(x=>x.n), extra=new Set();
  days.forEach(d=>Object.keys(d.by).forEach(n=>{if(names.indexOf(n)<0)extra.add(n);}));
  return names.concat(Array.from(extra).sort());
}
let lastW=0;
function axisLabel(v){return v===0?'0':v<60?v+'m':(v%60===0?(v/60)+'h':Math.floor(v/60)+'h '+(v%60)+'m');}
function renderChart(){
  const host=$('chart'), days=rangeDays(), n=days.length;
  const W=Math.max(280,Math.floor(host.clientWidth)||600), H=260; lastW=W;
  const M={l:42,r:8,t:14,b:30}, pw=W-M.l-M.r, ph=H-M.t-M.b, goal=S().goal;
  const maxV=Math.max(goal,30,...days.map(d=>d.total));
  const steps=[15,30,60,120,180,240,360,480,720];
  const step=steps.find(s=>maxV/s<=4)||720, yMax=Math.ceil(maxV/step)*step;
  const y=v=>M.t+ph-(v/yMax)*ph;
  const order=subjectOrder(days), slot=pw/n, bw=Math.min(30,slot*0.66);
  const svg=sv('svg',{width:'100%',height:H,viewBox:'0 0 '+W+' '+H,role:'group','aria-label':'Study minutes per day'});
  for(let v=0;v<=yMax;v+=step){
    svg.append(sv('line',{x1:M.l,x2:W-M.r,y1:y(v),y2:y(v),stroke:'var(--grid)','stroke-width':1}));
    svg.append(sv('text',{x:M.l-8,y:y(v)+4,'text-anchor':'end',text:axisLabel(v)}));
  }
  const readout=$('readout');
  const def='Last '+range+' days · '+fmtMin(days.reduce((a,d)=>a+d.total,0))+' total · '+fmtMin(days.reduce((a,d)=>a+d.total,0)/n)+' a day';
  readout.textContent=def;
  const showDay=function(i){
    const d=days[i];
    const parts=order.filter(k=>d.by[k]).map(k=>k+' '+fmtMin(d.by[k]));
    readout.textContent=d.date.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})+' · '+(d.total?fmtMin(d.total):'no study')+(parts.length?' · '+parts.join(', '):'');
  };
  days.forEach(function(d,i){
    const x0=M.l+i*slot+(slot-bw)/2; let acc=0;
    order.forEach(function(name){
      const v=d.by[name]; if(!v)return;
      const y1=y(acc+v), hgt=Math.max(1,y(acc)-y1);
      svg.append(sv('rect',{x:x0,y:y1,width:bw,height:hgt,rx:2,style:'fill:'+colorVar(name),stroke:'var(--surface)','stroke-width':1}));
      acc+=v;
    });
    const isToday=i===n-1;
    const label=range===7?d.date.toLocaleDateString([],{weekday:'short'}):String(d.date.getDate());
    if(range<=14||(n-1-i)%3===0){
      svg.append(sv('text',{x:M.l+i*slot+slot/2,y:H-10,'text-anchor':'middle','class':isToday?'today-lbl':'',text:label}));
    }
  });
  svg.append(sv('line',{x1:M.l,x2:W-M.r,y1:y(goal),y2:y(goal),stroke:'var(--ink-2)','stroke-width':1.25,'stroke-dasharray':'5 4'}));
  svg.append(sv('text',{x:W-M.r,y:y(goal)-5,'text-anchor':'end','class':'halo',text:'Goal '+fmtMin(goal)}));
  days.forEach(function(d,i){
    const hit=sv('rect',{x:M.l+i*slot,y:M.t,width:slot,height:H-M.t-4,'class':'hit',tabindex:0,role:'img',
      'aria-label':d.date.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})+', '+(d.total?fmtMin(d.total):'no study')});
    hit.addEventListener('pointerenter',function(e){if(e.pointerType==='mouse')showDay(i);});
    hit.addEventListener('pointerleave',function(e){if(e.pointerType==='mouse')readout.textContent=def;});
    hit.addEventListener('click',function(){showDay(i);});
    hit.addEventListener('focus',function(){showDay(i);});
    hit.addEventListener('blur',function(){readout.textContent=def;});
    svg.append(hit);
  });
  host.replaceChildren(svg);
  const present=order.filter(k=>days.some(d=>d.by[k]));
  $('legend').replaceChildren(...present.map(k=>h('span',null,h('i',{class:'dot',style:'background:'+colorVar(k)}),k)));
}
function renderSubjects(){
  const days=rangeDays(), tot={}; let all=0;
  days.forEach(d=>Object.keys(d.by).forEach(k=>{tot[k]=(tot[k]||0)+d.by[k];all+=d.by[k];}));
  $('subjRange').textContent='Last '+range+' days';
  const box=$('subjects');box.replaceChildren();
  const rows=Object.keys(tot).sort((a,b)=>tot[b]-tot[a]);
  if(!rows.length){box.append(h('p',{class:'muted',text:'Nothing logged in this range yet.'}));return;}
  rows.forEach(function(k){
    const pct=Math.round(tot[k]/all*100);
    box.append(h('div',{class:'bar-row'},
      h('div',{class:'top-line'},h('i',{class:'dot',style:'background:'+colorVar(k)}),h('span',{class:'name',text:k}),
        h('span',{class:'val',text:fmtMin(tot[k])+' · '+pct+'%'})),
      h('div',{class:'bar-track'},h('span',{style:'width:'+(tot[k]/tot[rows[0]]*100)+'%;background:'+colorVar(k)}))));
  });
}
function renderRecent(){
  const all=[];
  Object.keys(vd()).forEach(k=>sessionsOn(k).forEach(x=>all.push(x)));
  all.sort((a,b)=>b.t-a.t);
  const ul=$('recent');ul.replaceChildren();
  if(!all.length)ul.append(h('li',{class:'empty-li',text:'Finished sessions will be listed here.'}));
  all.slice(0,8).forEach(function(x){
    ul.append(h('li',null,
      h('span',{class:'t',style:'min-width:116px',text:new Date(x.t).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})+' '+fmtTime(x.t).replace(' ',' ')}),
      h('span',{class:'who'},h('i',{class:'dot',style:'background:'+colorVar(x.n)}),x.n),
      h('span',{class:'m',text:fmtMin(x.m)})));
  });
}
function renderDashboard(){
  renderStats();renderChart();renderSubjects();renderRecent();renderCalendar();
  let any=false; Object.keys(vd()).forEach(k=>{if(sessionsOn(k).length)any=true;});
  $('emptyNote').hidden=any||demo;
  document.querySelectorAll('#rangeSeg .seg').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.range===range)));
}
document.querySelectorAll('#rangeSeg .seg').forEach(function(b){
  b.addEventListener('click',function(){range=+b.dataset.range;renderDashboard();});
});
if(window.ResizeObserver){
  new ResizeObserver(function(){
    const w=Math.floor($('chart').clientWidth);
    if(w&&w!==lastW&&active==='dashboard')renderChart();
  }).observe($('chart'));
}

/* ---------- calendar ---------- */
let calMonth=(function(){const d=today0();d.setDate(1);return d;})();
let selKey=dayKey(today0());
function renderCalendar(){
  const t0=today0(), tk=dayKey(t0), goal=S().goal;
  $('calTitle').textContent=calMonth.toLocaleDateString([],{month:'long',year:'numeric'});
  const first=new Date(calMonth), dim=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  const start=addDays(first,-first.getDay()), weeks=Math.ceil((first.getDay()+dim)/7);
  let mins=0,studyDays=0,planCount=0;
  for(let i=1;i<=dim;i++){
    const k=dayKey(new Date(first.getFullYear(),first.getMonth(),i)), m=minutesOn(k);
    mins+=m; if(m>0)studyDays++; planCount+=plansOn(k).length;
  }
  $('calSummary').textContent=mins?fmtMin(mins)+' across '+studyDays+(studyDays===1?' day':' days')+(planCount?' · '+planCount+(planCount===1?' plan':' plans'):''):'Nothing logged this month'+(planCount?' · '+planCount+(planCount===1?' plan':' plans'):'');
  const grid=$('calDays');grid.replaceChildren();
  for(let i=0;i<weeks*7;i++){
    const d=addDays(start,i), k=dayKey(d), m=minutesOn(k), plans=plansOn(k);
    const inten=m>0?Math.max(0.15,Math.min(1,m/goal)):0;
    const pp=h('span',{class:'pp'});
    plans.slice(0,4).forEach(p=>pp.append(h('i',{class:p.done?'d':''})));
    const cls=['cell'];
    if(d.getMonth()!==first.getMonth())cls.push('out');
    if(k===tk)cls.push('today');
    if(k===selKey)cls.push('sel');
    grid.append(h('button',{type:'button',class:cls.join(' '),style:'--i:'+inten.toFixed(2),'aria-pressed':k===selKey?'true':'false',
      'aria-label':d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'})+', '+(m?fmtMin(m)+' studied':'no study')+(plans.length?', '+plans.length+(plans.length===1?' plan':' plans'):''),
      onclick:function(){
        selKey=k;
        if(d.getMonth()!==first.getMonth()){calMonth=new Date(d.getFullYear(),d.getMonth(),1);}
        renderCalendar();
      }},
      h('span',{class:'num',text:String(d.getDate())}),
      h('span',{class:'mins',text:m?fmtMin(m):' '}),pp));
  }
  renderDayPanel();
}
function renderDayPanel(){
  const d=parseKey(selKey), tk=dayKey(today0()), m=minutesOn(selKey), goal=S().goal;
  $('dpTitle').textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
  $('dpSub').textContent=m>0?fmtMin(m)+' studied · '+Math.round(m/goal*100)+'% of your '+fmtMin(goal)+' goal':(selKey>tk?'Upcoming day.':'Nothing logged this day.');
  const ul=$('dpSessions');ul.replaceChildren();
  const ss=sessionsOn(selKey).map((x,i)=>({x:x,i:i})).sort((a,b)=>a.x.t-b.x.t);
  if(!ss.length)ul.append(h('li',{class:'empty-li',text:'No sessions.'}));
  ss.forEach(function(o){
    const li=sessionRow(o.x);
    if(!demo)li.append(h('button',{type:'button',class:'icon-btn','aria-label':'Delete this session',onclick:function(){
      state.days[selKey].sessions.splice(o.i,1);saveDay(selKey);renderDashboard();renderToday();
    }},'×'));
    ul.append(li);
  });
  const pl=$('dpPlans');pl.replaceChildren();
  const plans=plansOn(selKey).slice().sort((a,b)=>(a.time||'99').localeCompare(b.time||'99'));
  if(!plans.length)pl.append(h('li',{class:'empty-li',text:'Nothing planned.'}));
  plans.forEach(function(p){
    const li=planItem(selKey,p);
    li.append(h('button',{type:'button',class:'icon-btn','aria-label':'Delete plan '+p.title,onclick:function(){
      state.days[selKey].plans=state.days[selKey].plans.filter(x=>x.id!==p.id);
      saveDay(selKey);renderCalendar();renderPlansToday();
    }},'×'));
    pl.append(li);
  });
}
$('calPrev').addEventListener('click',function(){navMonth(-1);});
$('calNext').addEventListener('click',function(){navMonth(1);});
$('calToday').addEventListener('click',function(){
  const d=today0();calMonth=new Date(d.getFullYear(),d.getMonth(),1);selKey=dayKey(d);renderCalendar();
});
function navMonth(delta){
  calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()+delta,1);
  const t=today0();
  selKey=(t.getFullYear()===calMonth.getFullYear()&&t.getMonth()===calMonth.getMonth())?dayKey(t):dayKey(calMonth);
  renderCalendar();
}
$('planForm').addEventListener('submit',function(e){
  e.preventDefault();
  const title=$('planTitle').value.trim().slice(0,80);
  if(!title)return;
  dayDoc(selKey).plans.push({id:Math.random().toString(36).slice(2,9),title:title,n:$('planSubject').value,time:$('planTime').value,done:false});
  saveDay(selKey);
  $('planTitle').value='';$('planTime').value='';
  renderCalendar();renderPlansToday();$('planTitle').focus();
});

/* ---------- tasks ---------- */
let focusTaskId=null;
function saveTasks(){ tasksDirty=true; persist('tasks'); }
function refocus(id,prefs){
  for(const p of prefs){
    const b=document.querySelector('[data-mv="'+id+p+'"]');
    if(b&&!b.disabled){b.focus();return;}
  }
}
function moveTask(id,dir){
  const act=state.tasks.filter(t=>!t.done), i=act.findIndex(t=>t.id===id), j=i+dir;
  if(i<0||j<0||j>=act.length)return;
  const a=state.tasks.indexOf(act[i]), b=state.tasks.indexOf(act[j]), tmp=state.tasks[a];
  state.tasks[a]=state.tasks[b];state.tasks[b]=tmp;
  saveTasks();renderTasks();refocus(id,dir<0?['u','d']:['d','u']);
}
function topTask(id){
  const k=state.tasks.findIndex(x=>x.id===id); if(k<0)return;
  const t=state.tasks.splice(k,1)[0], f=state.tasks.findIndex(x=>!x.done);
  state.tasks.splice(f<0?0:f,0,t);
  saveTasks();renderTasks();refocus(id,['d','u']);
}
function setTaskDone(id,done){
  const k=state.tasks.findIndex(x=>x.id===id); if(k<0)return;
  const t=state.tasks[k]; t.done=done;
  if(done&&focusTaskId===id){focusTaskId=null;renderTimer(true);}
  if(!done){state.tasks.splice(k,1);state.tasks.push(t);}
  saveTasks();renderTasks();
}
function deleteTask(id){
  state.tasks=state.tasks.filter(x=>x.id!==id);
  if(focusTaskId===id){focusTaskId=null;renderTimer(true);}
  saveTasks();renderTasks();
}
function focusOn(id){
  const t=state.tasks.find(x=>x.id===id); if(!t)return;
  focusTaskId=id;
  if(t.n&&S().subjects.some(x=>x.n===t.n)&&S().current!==t.n){S().current=t.n;saveSettings();}
  if(T.mode!=='focus'&&T.status!=='running')setMode('focus');
  renderChips();renderTimer(true);
  try{$('dial').scrollIntoView({block:'center'});}catch(e){}
  notice('Focusing on: '+t.title+'.');
}
function taskMeta(t,top){
  return h('span',{class:'tmeta'},
    top?h('span',{class:'pill',text:'Top priority'}):null,
    t.n?h('span',{class:'subj'},h('i',{class:'dot',style:'background:'+colorVar(t.n)}),t.n):null);
}
function renderTasks(){
  const act=state.tasks.filter(t=>!t.done), dn=state.tasks.filter(t=>t.done);
  $('taskCount').textContent=act.length?act.length+(act.length===1?' task':' tasks')+' to do':'';
  const ul=$('taskList');ul.replaceChildren();
  if(!act.length)ul.append(h('li',{class:'empty-li',text:dn.length?'Everything is done. Add another task above.':'No tasks yet. Add one above, then move it up or down to set its priority.'}));
  act.forEach(function(t,i){
    const last=i===act.length-1;
    ul.append(h('li',{class:'task'},
      h('span',{class:'rank'+(i===0?' top':''),text:String(i+1),'aria-hidden':'true'}),
      h('input',{type:'checkbox',id:'tk-'+t.id,onchange:function(e){setTaskDone(t.id,e.target.checked);}}),
      h('span',{class:'tbody'},h('label',{class:'ttl',for:'tk-'+t.id,text:t.title}),taskMeta(t,i===0)),
      h('span',{class:'tact'},
        h('button',{type:'button',class:'btn small',onclick:function(){focusOn(t.id);},'aria-label':'Start a focus session for '+t.title,text:'Focus'}),
        h('button',{type:'button',class:'icon-btn','data-mv':t.id+'t','aria-label':'Move to top: '+t.title,disabled:i===0,onclick:function(){topTask(t.id);}},'⤒'),
        h('button',{type:'button',class:'icon-btn','data-mv':t.id+'u','aria-label':'Move up: '+t.title,disabled:i===0,onclick:function(){moveTask(t.id,-1);}},'▲'),
        h('button',{type:'button',class:'icon-btn','data-mv':t.id+'d','aria-label':'Move down: '+t.title,disabled:last,onclick:function(){moveTask(t.id,1);}},'▼'),
        h('button',{type:'button',class:'icon-btn','aria-label':'Delete '+t.title,onclick:function(){deleteTask(t.id);}},'×'))));
  });
  $('doneBox').hidden=!dn.length;
  $('doneSum').textContent='Completed ('+dn.length+')';
  const dl=$('doneList');dl.replaceChildren();
  dn.forEach(function(t){
    dl.append(h('li',{class:'task done'},
      h('input',{type:'checkbox',id:'tk-'+t.id,checked:true,onchange:function(e){setTaskDone(t.id,e.target.checked);}}),
      h('span',{class:'tbody'},h('label',{class:'ttl',for:'tk-'+t.id,text:t.title}),taskMeta(t,false)),
      h('span',{class:'tact'},h('button',{type:'button',class:'icon-btn','aria-label':'Delete '+t.title,onclick:function(){deleteTask(t.id);}},'×'))));
  });
}
$('taskForm').addEventListener('submit',function(e){
  e.preventDefault();
  const inp=$('taskInput'), title=inp.value.trim().slice(0,80);
  if(!title)return;
  if(state.tasks.length>=200){notice('You can keep up to 200 tasks. Clear some completed ones first.');return;}
  state.tasks.push({id:Math.random().toString(36).slice(2,9),title:title,n:$('taskSubject').value,done:false});
  inp.value='';saveTasks();renderTasks();inp.focus();
});
$('clearDone').addEventListener('click',function(){
  state.tasks=state.tasks.filter(t=>!t.done);saveTasks();renderTasks();
});

/* ---------- character ---------- */
const HAIR_STYLES=[['twin','Twin tails'],['pony','Ponytail'],['bob','Bob'],['buns','Buns']];
const ACCS=[['sakura','Sakura'],['bow','Bow'],['cat','Cat ears'],['glasses','Glasses'],['none','None']];
const HAIR_COL={violet:['Violet','#5A3C8A','#8366BD'],black:['Black','#2B2433','#5A5068'],brown:['Brown','#6B4630','#9A6E4F'],auburn:['Auburn','#8A3B2A','#C06A4E'],
  pink:['Pink','#D9588D','#F08DB4'],blue:['Blue','#3F5FB0','#6F8FE0'],silver:['Silver','#9AA3B5','#CBD2E0'],blonde:['Blonde','#D9A93C','#F1CE75']};
const EYE_COL={violet:['Violet','#7B5CD6','#B9A5F5'],blue:['Blue','#3A7BD5','#8DB8F2'],green:['Green','#2E9E6B','#8EDDB5'],amber:['Amber','#D9892B','#F3C98A'],rose:['Rose','#D6467F','#F59AB9']};
const SKIN_COL={light:['Light','#FFE6D8','#F0BDA6'],peach:['Peach','#F9D2B8','#E3A98B'],tan:['Tan','#E3B08A','#C98F68'],brown:['Brown','#B97F5A','#9A6243'],deep:['Deep','#8A5A40','#6E4430']};
const hasKey=(m,k)=>Object.prototype.hasOwnProperty.call(m,k);
function cleanChar(c){
  const d=DEFAULTS.character, o=Object.assign({},d,c||{});
  o.name=String(o.name==null?'':o.name).replace(/[\u0000-\u001f<>]/g,'').trim().slice(0,16)||d.name;
  if(!HAIR_STYLES.some(x=>x[0]===o.style))o.style=d.style;
  if(!ACCS.some(x=>x[0]===o.acc))o.acc=d.acc;
  if(!hasKey(HAIR_COL,o.hair))o.hair=d.hair;
  if(!hasKey(EYE_COL,o.eyes))o.eyes=d.eyes;
  if(!hasKey(SKIN_COL,o.skin))o.skin=d.skin;
  return o;
}
function applyChar(){
  const c=S().character, svg=$('potSvg'), d=$('dial');
  d.dataset.hair=c.style; d.dataset.acc=c.acc;
  svg.style.setProperty('--hair',HAIR_COL[c.hair][1]); svg.style.setProperty('--hair-hi',HAIR_COL[c.hair][2]);
  svg.style.setProperty('--iris',EYE_COL[c.eyes][1]); svg.style.setProperty('--iris-lite',EYE_COL[c.eyes][2]);
  svg.style.setProperty('--skin',SKIN_COL[c.skin][1]); svg.style.setProperty('--skin-shade',SKIN_COL[c.skin][2]);
  svg.setAttribute('aria-label',c.name+', an anime-style character, peeking over a rice cooker. The cooker display shows the timer.');
  $('charName').textContent=c.name;
  $('charReset').textContent='Reset to '+DEFAULTS.character.name;
}
function syncCharPanel(){
  const c=S().character;
  document.querySelectorAll('#charCard [data-key]').forEach(function(b){
    b.setAttribute('aria-pressed',String(c[b.dataset.key]===b.dataset.val));
  });
  const inp=$('charNameInput'); if(document.activeElement!==inp)inp.value=c.name;
}
function setChar(key,val){
  const c=S().character; c[key]=val; S().character=cleanChar(c);
  applyChar();syncCharPanel();saveSettings();
}
function renderCharPanel(){
  const seg=function(box,list,key){
    $(box).replaceChildren(...list.map(it=>h('button',{type:'button',class:'seg','data-key':key,'data-val':it[0],onclick:function(){setChar(key,it[0]);}},it[1])));
  };
  const sw=function(box,map,key){
    $(box).replaceChildren(...Object.keys(map).map(k=>h('button',{type:'button',class:'swatch','data-key':key,'data-val':k,'aria-label':map[k][0],title:map[k][0],style:'--sw:'+map[k][1],onclick:function(){setChar(key,k);}})));
  };
  seg('optStyle',HAIR_STYLES,'style');seg('optAcc',ACCS,'acc');
  sw('optHair',HAIR_COL,'hair');sw('optEyes',EYE_COL,'eyes');sw('optSkin',SKIN_COL,'skin');
  syncCharPanel();
}
function openChar(){
  $('charCard').hidden=false;$('charBtn').setAttribute('aria-expanded','true');syncCharPanel();
  try{$('charCard').scrollIntoView({block:'nearest',behavior:'smooth'});}catch(e){}
  $('charNameInput').focus({preventScroll:true});
}
function closeChar(){
  $('charCard').hidden=true;$('charBtn').setAttribute('aria-expanded','false');
  $('charBtn').focus({preventScroll:true});
}
$('charBtn').addEventListener('click',function(){ if($('charCard').hidden)openChar(); else closeChar(); });
document.querySelector('.girl-hit').addEventListener('click',openChar);
$('charDone').addEventListener('click',closeChar);
$('charCard').addEventListener('keydown',function(e){ if(e.key==='Escape')closeChar(); });
$('charNameInput').addEventListener('input',function(e){
  S().character.name=cleanChar({name:e.target.value}).name;applyChar();
});
$('charNameInput').addEventListener('change',function(e){
  e.target.value=S().character.name;saveSettings();
});
$('charReset').addEventListener('click',function(){
  S().character=clone(DEFAULTS.character);applyChar();syncCharPanel();saveSettings();
});

/* ---------- tabs ---------- */
const TABS=['timer','dashboard'];
let active='timer';
function showTab(name){
  active=name;
  TABS.forEach(function(t){
    $('panel-'+t).hidden=t!==name;
    const b=$('tab-'+t);
    b.setAttribute('aria-selected',String(t===name));
    b.tabIndex=t===name?0:-1;
  });
  updateDemoBar();
  if(name==='dashboard')renderDashboard();
  try{history.replaceState(null,'','#'+name);}catch(e){}
}
TABS.forEach(function(t,i){
  const b=$('tab-'+t);
  b.addEventListener('click',function(){showTab(t);});
  b.addEventListener('keydown',function(e){
    if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;
    const nx=TABS[(i+(e.key==='ArrowRight'?1:TABS.length-1))%TABS.length];
    showTab(nx);$('tab-'+nx).focus();
  });
});

/* ---------- boot ---------- */
function renderAll(){
  syncSettingsInputs();renderChips();renderTimer(true);renderToday();renderPlansToday();renderTasks();applyChar();renderCharPanel();
  if(active==='dashboard')renderDashboard();
  
}
const startTab=(location.hash||'').slice(1);
showTab(TABS.indexOf(startTab)>=0?startTab:'timer');
renderAll();
initStore();
})();
