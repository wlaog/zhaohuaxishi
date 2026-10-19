import {MOODS,WEATHERS,chosen,dayIcon,dayGradient,dayHasDetails,memoriesOn} from './day-model.js';
const $ = selector => document.querySelector(selector);
const paths = {
  search:'m21 21-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus:'M12 5v14M5 12h14', home:'m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
  bookmark:'M6 3h12v18l-6-4-6 4z', image:'M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M8 7h.01',
  clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  filter:'M4 6h16M7 12h10M10 18h4', book:'M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1',
  folder:'M3 5h6l2 3h10v12H3z', external:'M14 3h7v7M21 3 11 13M10 3H3v18h18v-7',
  sun:'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  menu:'M3 6h18M3 12h18M3 18h18', sort:'M8 3v18m-4-4 4 4 4-4M15 5h6M15 10h4M15 15h2',
  text:'M4 5h16M12 5v15M8 20h8', code:'m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
  arrow:'M4 12h16m-6-6 6 6-6 6', left:'m15 5-7 7 7 7', right:'m9 5 7 7-7 7', down:'m5 9 7 7 7-7', up:'m5 15 7-7 7 7',
  shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6', close:'m6 6 12 12M6 18 18 6',
  list:'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01', quote:'M4 5h6v8H4v-8zm0 8v5l5-5M14 5h6v8h-6v-8zm0 8v5l5-5',
  undo:'M3 10h11a7 7 0 0 1 0 14M3 10l5-5M3 10l5 5', redo:'M21 10H10a7 7 0 0 0 0 14M21 10l-5-5M21 10l-5 5',
  download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', eye:'M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] ?? paths.book}"></path></svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const uid = () => crypto.randomUUID().replaceAll('-','');
const labels = {all:'全部日记',pinned:'我的收藏',images:'图片记忆',recent:'最近编辑',trash:'回收站'};
const state = { entries:[], token:'', changeVersion:null, syncing:false, view:'all', query:'', date:'', month:'', tag:'', limit:20, ascending:false, calendar:new Date(), current:null, dirty:0, saved:0, saving:null, saveTimer:null, activeText:null, conflicts:false };
state.days={};state.dayDraft=null;state.daySaving=false;
state.calendarMode=['records','moods','weather'].includes(localStorage.getItem('diary-calendar-mode'))?localStorage.getItem('diary-calendar-mode'):'records';
state.today=localDate();state.memoryDay=state.today.slice(5);state.memoryOldest=false;
let toastTimer;
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,4500); }
function status(message,error=false) { $('#save-status').textContent=message; $('#save-status').classList.toggle('error',error); }
async function api(url, options={}) {
  const headers={...options.headers};
  if(options.method && options.method!=='GET') headers['X-Diary-Token']=state.token;
  if(options.body && typeof options.body==='string') headers['Content-Type']='application/json';
  let response;
  try { response=await fetch(url,{...options,headers}); }
  catch { throw new Error('无法连接电脑，请检查网络；未保存的草稿暂留此页，请勿关闭。'); }
  const data=await response.json();
  if(response.status===401 && !$('#auth-dialog').open) $('#auth-dialog').showModal();
  if(!response.ok) { const error=new Error(data.error || '本地服务连接失败'); error.status=response.status; throw error; }
  return data;
}
function renderIcons(root=document) { root.querySelectorAll('[data-icon]').forEach(el=>el.outerHTML=icon(el.dataset.icon)); }
function resource(entry,file) { return `/archive/${entry.folder}/${file}`; }
function updateSummary(entry) {
  const plain = entry.search??entry.title;
  const row={...entry,search:plain,excerpt:plain.slice(0,220),blockTypes:entry.blocks.map(b=>b.type)};
  row.media=entry.blocks.filter(b=>b.type==='image').map(b=>b.file);
  const index=state.entries.findIndex(e=>e.id===entry.id);
  if(index<0) state.entries.push(row); else state.entries[index]=row;
}
async function reloadData() {
  const data=await api('/api/bootstrap'); state.entries=data.entries; state.days=Object.fromEntries((data.days??[]).map(day=>[day.date,day])); state.token=data.token; state.changeVersion=data.changeVersion; $('#data-path').textContent=data.root;
  $('#remote-logout').hidden=!data.remoteSession;
  renderAll();
}
function connectionStatus(online) {
  if(online&&$('#connection-status').classList.contains('disconnected')){clearTimeout(toastTimer);$('#toast').hidden=true;}
  $('#connection-status').classList.toggle('disconnected',!online);
  $('#connection-label').textContent=online?'已连接电脑':'连接中断';
  $('#connection-status').title=online?'点击检查其他设备的更新':'电脑需要在线且日记服务运行，点击重试连接';
}
function showConflict() {
  state.conflicts=true;clearTimeout(state.saveTimer);
  $('#remote-update').hidden=false;
  status('其他设备已更新，当前草稿未覆盖',true);
}
async function syncRemote() {
  if(state.today!==localDate()){
    const previous=state.today;state.today=localDate();
    if(state.memoryDay===previous.slice(5))state.memoryDay=state.today.slice(5);
    if(!state.date&&localDate(state.calendar).slice(0,7)===previous.slice(0,7))state.calendar=new Date();
    $('#today-label').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});renderAll();
  }
  if(state.syncing||state.saving||document.visibilityState==='hidden')return;
  state.syncing=true;
  const priorVersion=state.changeVersion;
  let connected=false;
  try {
    const latest=await api('/api/changes',{signal:AbortSignal.timeout(10_000)});connected=true;connectionStatus(true);
    if(latest.changeVersion===state.changeVersion)return;
    await reloadData();
    const current=state.current,summary=current&&state.entries.find(e=>e.id===current.id);
    if(!current||!summary||summary.revision<=current.revision)return;
    if(state.dirty!==state.saved||state.saving||state.conflicts){showConflict();return;}
    const revision=current.revision;
    const fresh=await api(`/api/entries/${current.id}`);
    // Input may have arrived while the new version was being fetched.
    if(state.current!==current||current.revision!==revision)return;
    if(state.dirty!==state.saved||state.saving||state.conflicts){showConflict();return;}
    state.current=fresh;fillEditor();status('已更新为电脑上的最新版本');
  }catch{
    connected=false;
    state.changeVersion=priorVersion;
    connectionStatus(false);
    if(state.current&&state.dirty>state.saved)status('连接中断，草稿暂留此页，请勿关闭',true);
  }finally{
    state.syncing=false;
    if(connected&&state.current&&state.dirty>state.saved&&!state.conflicts&&!state.saving)flush().catch(()=>{});
  }
}
function filtered() {
  const query=state.query.trim().toLocaleLowerCase();
  return state.entries.filter(e=>{
    if((state.view==='trash')!==!!e.deleted) return false;
    if(e.group && !query && !state.month) return false;
    if(state.view==='pinned' && !e.pinned) return false;
    if(state.view==='images' && !e.imageCount) return false;
    if(state.view==='recent' && !e.revision) return false;
    if(state.date && e.date!==state.date) return false;
    if(state.month && !(e.date??e.folder.replace(/^source\/(\d{2})\/(\d{2}).*/, '20$1-$2')).startsWith(state.month)) return false;
    if(state.tag && !e.tags.includes(state.tag)) return false;
    return !query || e.search.toLocaleLowerCase().includes(query);
  }).sort((a,b)=>Number(b.pinned)-Number(a.pinned) || (state.ascending?1:-1)*String(state.view==='recent'?a.updated:a.date??a.created).localeCompare(String(state.view==='recent'?b.updated:b.date??b.created)) || b.id.localeCompare(a.id));
}
function renderFeed() {
  const rows=filtered();
  const day=state.date||localDate(),existing=dailyEntry(day);
  $('#daily-write-label').textContent=existing?'继续记录':'开始记录';
  $('#quick-write').textContent=state.date?`${day}，有什么想记下来的？`:'今天，有什么想记下来的？';
  $('#view-label').textContent=labels[state.view];
  $('#heading').textContent=state.query?'找到记忆中的片刻。':state.date?`${state.date} 的记录`:state.month?`${state.month.replace('-',' 年 ')} 月`:state.tag?`# ${state.tag}`:({all:'生活，值得被记住。',pinned:'把喜欢的日子，留下来。',images:'有些瞬间，一眼就记得。',recent:'接着上次的思绪。',trash:'暂时收起的片刻。'}[state.view]);
  $('#subtitle').textContent=state.view==='trash'?'移出的日记可以恢复，原始归档仍保留。':state.query?'从标题、正文和标签中，找回你的日常。':'写下此刻，也翻翻从前。';
  $('#feed-label').textContent=state.date||state.month||state.tag?'筛选结果':state.view==='all'?'所有片刻':labels[state.view];
  $('#result-count').textContent=`${rows.length} 篇${state.ascending?' · 由早到晚':''}`;
  $('#quick-compose').hidden=state.view==='trash';
  document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el.dataset.view===state.view));
  if(!rows.length) {
    $('#feed').innerHTML=`<div class="empty">${icon(state.view==='trash'?'trash':'book')}<strong>${state.query?'没有找到匹配的记录':state.view==='trash'?'回收站是空的':'这里还没有日记'}</strong><span>${state.query?'换个关键词，或清除日期和标签筛选。':'从一段文字、一张照片开始，留下今天。'}</span><br><button class="primary compact" data-action="daily">写这一天</button></div>`;
  } else $('#feed').innerHTML=rows.slice(0,state.limit).map(e=>{
    const date=e.date??'目录页', title=e.title, excerpt=(e.previewText??(e.legacy?'':e.excerpt)??'').replace(title,'').trim();
    let media='';
    if(e.thumbnail) media=`<img class="memo-thumbnail" src="${esc(resource(e,e.thumbnail))}" alt="${esc(title)} · 原图预览" loading="lazy" data-lightbox="${esc(resource(e,e.thumbnail))}">`;
    else if(e.media?.length) media=`<div class="card-image-grid">${e.media.slice(0,3).map(file=>`<img class="memo-thumbnail" src="${esc(resource(e,file))}" alt="日记原图" loading="lazy" data-lightbox="${esc(resource(e,file))}">`).join('')}</div>`;
    return `<article class="memo-card" data-id="${e.id}"><div class="memo-meta"><span class="avatar">拾</span><span>朝花夕拾</span><span>·</span><time>${esc(date)}</time><span class="origin">${e.legacy?'OneNote':e.importSources?.length?'导入资料':'本地日记'}</span><button data-pin="${e.id}" title="${e.pinned?'取消收藏':'收藏'}" aria-label="${e.pinned?'取消收藏':'收藏'}" class="${e.pinned?'pinned-mark':''}">${icon('bookmark')}</button></div><button class="memo-title" data-open="${e.id}">${esc(title)}</button>${excerpt?`<p class="memo-excerpt">${esc(excerpt)}</p>`:''}${media}<div class="memo-footer">${e.tags.slice(0,3).map(t=>`<button class="pill" data-tag="${esc(t)}"># ${esc(t)}</button>`).join('')}${e.imageCount?`<span>${icon('image')} ${e.imageCount}</span>`:''}${e.blockTypes?.includes('html')?`<span>${icon('code')} HTML</span>`:''}${e.legacy||e.importSources?.length?`<span>${icon('shield')} 原始资料保留</span>`:''}<button class="read-action" data-open="${e.id}">${e.deleted?'查看与恢复':'打开日记'} ${icon('arrow')}</button></div></article>`;
  }).join('');
  $('#load-more').hidden=rows.length<=state.limit;
}
function renderDirectory() {
  const counts=new Map();
  for(const e of state.entries) if(e.date&&!e.deleted) { const key=e.date.slice(0,7); counts.set(key,(counts.get(key)??0)+1); }
  const years=[...new Set([...counts.keys()].map(k=>k.slice(0,4)))].sort().reverse();
  const openYears=new Set([...document.querySelectorAll('#directory details[open]')].map(e=>e.dataset.year));
  $('#directory').innerHTML=years.map((year,index)=>`<details data-year="${year}" ${openYears.has(year)||!openYears.size&&index===0?'open':''}><summary><span class="chevron">›</span>${icon('folder')}<span>${year}</span><small>${[...counts].filter(([m])=>m.startsWith(year)).reduce((n,[,count])=>n+count,0)}</small></summary>${[...counts].filter(([month])=>month.startsWith(year)).sort(([a],[b])=>b.localeCompare(a)).map(([month,count])=>`<button class="month-row ${state.month===month?'active':''}" data-month="${month}"><span>${Number(month.slice(5))} 月</span><small>${count}</small></button>`).join('')}</details>`).join('');
  const tags=new Map();
  for(const e of state.entries) if(!e.deleted) for(const tag of e.tags) tags.set(tag,(tags.get(tag)??0)+1);
  $('#tags').innerHTML=tags.size?[...tags].sort((a,b)=>b[1]-a[1]).map(([tag])=>`<button class="tag ${state.tag===tag?'active':''}" data-tag="${esc(tag)}"># ${esc(tag)}</button>`).join(''):'<span class="no-tags">写下日记，添加你的第一个标签</span>';
}
function renderCalendar() {
  const y=state.calendar.getFullYear(),m=state.calendar.getMonth();
  const years=[...state.entries.filter(e=>e.date&&!e.deleted).map(e=>Number(e.date.slice(0,4))),...Object.values(state.days).filter(dayHasDetails).map(d=>Number(d.date.slice(0,4)))];
  const first=Math.min(new Date().getFullYear(),y,...years),last=Math.max(new Date().getFullYear()+5,y,...years);
  $('#calendar-year').innerHTML=Array.from({length:last-first+1},(_,i)=>`<option value="${first+i}" ${first+i===y?'selected':''}>${first+i} 年</option>`).join('');
  $('#calendar-month').innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i===m?'selected':''}>${i+1} 月</option>`).join('');
  const dates=new Set([...state.entries.filter(e=>!e.deleted).map(e=>e.date),...Object.values(state.days).filter(dayHasDetails).map(d=>d.date)]);
  const mode=state.calendarMode;
  $('#calendar').dataset.mode=mode;
  document.querySelectorAll('[data-calendar-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarMode===mode)));
  $('#calendar-legend-text').textContent=mode==='records'?'有记录的日子':mode==='moods'?'多种心情，以分色相伴':'多种天气，以分色相伴';
  const offset=(new Date(y,m,1).getDay()+6)%7,days=new Date(y,m+1,0).getDate();
  $('#calendar').innerHTML='<span></span>'.repeat(offset)+Array.from({length:days},(_,i)=>{
    const date=`${y}-${String(m+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;
    const selected=mode==='records'?[]:chosen(mode,state.days[date]?.[mode]??[]);
    const label=`${date}${dates.has(date)?' · 有记录':''}${selected.length?' · '+selected.map(item=>item.label).join('、'):''}`;
    return `<button data-date="${date}" title="${esc(label)}" aria-label="${esc(label)}" class="${mode==='records'&&dates.has(date)?'recorded':''} ${selected.length?'day-filled':''} ${date===localDate()?'today':''} ${date===state.date?'selected':''}" ${selected.length?`style="background:${dayGradient(selected)}"`:''}><span class="calendar-number">${i+1}</span>${selected.length?`<span class="calendar-symbols">${selected.slice(0,2).map(item=>dayIcon(mode,item.id)).join('')}${selected.length>2?`<small>+${selected.length-2}</small>`:''}</span>`:''}</button>`;
  }).join('');
}
function renderStats() {
  const entries=state.entries.filter(e=>!e.group&&!e.deleted), dates=new Set([...entries.map(e=>e.date),...Object.values(state.days).filter(dayHasDetails).map(d=>d.date)]);
  $('#all-count').textContent=entries.length; $('#stat-days').textContent=dates.size; $('#stat-notes').textContent=entries.length;
  $('#stat-images').textContent=state.entries.filter(e=>!e.deleted).reduce((sum,e)=>sum+(e.imageCount??0),0).toLocaleString();
  $('#activity').innerHTML=Array.from({length:91},(_,index)=>{ const day=new Date(); day.setDate(day.getDate()-90+index); const date=localDate(day); return `<i title="${date}${dates.has(date)?' · 有记录':''}" class="${dates.has(date)?'has-entry':''}"></i>`; }).join('');
  renderMemories();
}
function renderAll() { renderFeed();renderDirectory();renderCalendar();renderStats();renderDaySummaries(); }
function daySummary(date,followToday=false){
  const day=state.days[date],items=[...chosen('moods',day?.moods).map(item=>({...item,kind:'moods'})),...chosen('weather',day?.weather).map(item=>({...item,kind:'weather'}))];
  return `<button class="day-summary" data-day-details="${followToday?'today':date}" aria-label="编辑 ${date} 的心情与天气">${items.length?items.map(item=>`<span>${dayIcon(item.kind,item.id)}${item.label}</span>`).join(''):'<span class="day-summary-empty">'+dayIcon('moods','calm')+'心情与天气，随心记一点</span>'}<small>${items.length?'编辑':'可多选 · 可留空'}</small></button>`;
}
function renderDaySummaries(){
  $('#quick-day-meta').innerHTML=daySummary(state.date||localDate(),!state.date);
  const date=state.current?.date;$('#entry-day-meta').hidden=!date||!!state.current?.group;
  if(date)$('#entry-day-meta').innerHTML=daySummary(date);
}
async function openDayDetails(date){
  try{
    const day=await api(`/api/days/${date}`);state.days[date]=day;state.dayDraft={...day,dirty:false};
    $('#day-date').textContent=date;$('#day-save-status').textContent='';$('#reload-day').hidden=true;
    renderDayChoices();$('#day-dialog').showModal();
  }catch(error){toast(error.message);}
}
function renderDayChoices(){
  const draft=state.dayDraft;if(!draft)return;
  for(const [kind,list,target] of [['moods',MOODS,'mood-choices'],['weather',WEATHERS,'weather-choices']]){
    $('#'+target).innerHTML=list.map(item=>`<button type="button" data-day-kind="${kind}" data-day-choice="${item.id}" aria-pressed="${draft[kind].includes(item.id)}" style="--choice-color:${item.color}">${dayIcon(kind,item.id)}<span>${item.label}</span><i aria-hidden="true">✓</i></button>`).join('');
  }
}
function cancelDay(){
  if(state.daySaving)return;
  if(state.dayDraft?.dirty&&!confirm('放弃尚未保存的心情和天气选择？'))return;
  $('#day-dialog').close();state.dayDraft=null;
}
async function saveDay(){
  if(state.daySaving||!state.dayDraft)return;
  if(!state.dayDraft.dirty){$('#day-dialog').close();state.dayDraft=null;return;}
  state.daySaving=true;$('#save-day').disabled=true;$('#day-save-status').textContent='正在保存…';
  const draft=state.dayDraft;
  try{
    const saved=await api(`/api/days/${draft.date}`,{method:'PUT',body:JSON.stringify({revision:draft.revision,moods:draft.moods,weather:draft.weather})});
    state.days[saved.date]=saved;state.dayDraft=null;$('#day-dialog').close();renderAll();toast('这一天的心情与天气已保存');
  }catch(error){$('#day-save-status').textContent=error.message;$('#reload-day').hidden=error.status!==409;}
  finally{state.daySaving=false;$('#save-day').disabled=false;}
}
function memoryControls(){
  const [month,day]=state.memoryDay.split('-').map(Number),days=new Date(2000,month,0).getDate();
  return `<button data-memory-step="-1" aria-label="回顾前一天">${icon('left')}</button><label><span class="sr-only">回顾月份</span><select data-memory-month>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===month?'selected':''}>${i+1} 月</option>`).join('')}</select></label><label><span class="sr-only">回顾日期</span><select data-memory-date>${Array.from({length:days},(_,i)=>`<option value="${i+1}" ${i+1===day?'selected':''}>${i+1} 日</option>`).join('')}</select></label><button data-memory-step="1" aria-label="回顾后一天">${icon('right')}</button><button data-memory-today class="memory-today">今天</button>`;
}
function memoryCard(entry){
  const ago=new Date().getFullYear()-Number(entry.date.slice(0,4));
  const excerpt=(entry.previewText||entry.excerpt||'').replace(entry.title,'').trim().slice(0,100);
  return `<button class="memory-card" data-open="${entry.id}"><span class="memory-year">${entry.date.slice(0,4)}<small>${ago} 年前</small></span><span class="memory-body"><strong>${esc(entry.title)}</strong>${excerpt?`<span>${esc(excerpt)}</span>`:''}<small>${esc(entry.date)} · 打开这段回忆 ${icon('arrow')}</small></span></button>`;
}
function renderMemories(){
  let entries=memoriesOn(state.entries,state.memoryDay);if(state.memoryOldest)entries=entries.toReversed();
  const count=`${new Set(entries.map(e=>e.date.slice(0,4))).size} 个年份 · ${entries.length} 篇记录`;
  const empty='<p class="memory-empty">这一天还没有往年的记录。<br>翻翻相邻日子，或随手拾起一段回忆。</p>';
  $('#on-this-day').innerHTML=`<div class="memory-heading"><strong>${icon('clock')} 那年今日</strong><button data-memory-random title="随机选择一个有回忆的日期">随手翻一天</button></div><div class="memory-controls">${memoryControls()}</div><p class="memory-count">${count}</p>${entries.length?entries.slice(0,2).map(memoryCard).join(''):empty}<button class="memory-expand" data-memory-expand>展开往年回顾 ${icon('arrow')}</button>`;
  $('#memories-controls').innerHTML=memoryControls()+`<button data-memory-random class="quiet">随手翻一天</button>`;
  $('#memories-count').textContent=count;$('#memory-sort').textContent=state.memoryOldest?'最早年份在前':'最近年份在前';
  $('#memories-list').innerHTML=entries.length?entries.map(memoryCard).join(''):empty;
}
function changeMemory(month,day){
  const last=new Date(2000,month,0).getDate();state.memoryDay=`${String(month).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;renderMemories();
}
function closeOverview(){if($('#overview-dialog').open)$('#overview-dialog').close();}
function clearFilters() { state.date='';state.month='';state.tag='';state.limit=20; }
function setView(view) { state.view=view;clearFilters();state.query='';$('#search').value='';renderAll();$('#sidebar').classList.remove('open'); }

function capture() {
  const e=state.current;if(!e)return;
  e.title=$('#entry-title').value;
  if(!e.revision&&!e.legacy)e.date=$('#entry-date').value;
  e.tags=$('#entry-tags').value.split(/[\s,，]+/).map(t=>t.replace(/^#/,'')).filter(Boolean);
  for(const b of e.blocks) {
    const el=document.querySelector(`[data-block="${b.id}"]`);
    if(!el)continue;
    if(b.type==='text') b.html=el.querySelector('.text-editor').innerHTML;
    if(b.type==='html') b.html=el.querySelector('.html-source').value;
    if(b.type==='image') b.caption=el.querySelector('.image-caption').value;
  }
}
function changed() {
  if(!state.current)return;
  capture();state.dirty++;status('等待保存…');clearTimeout(state.saveTimer);
  state.saveTimer=setTimeout(()=>flush().catch(()=>{}),650);
}
async function flush() {
  clearTimeout(state.saveTimer);
  if(state.saving) { await state.saving; if(state.saved<state.dirty)return flush(); return; }
  if(!state.current||state.saved===state.dirty)return;
  if(state.conflicts)throw new Error('存在版本冲突，请先导出草稿，再重新加载。');
  const run=async()=>{
    while(state.current&&state.saved<state.dirty) {
      capture();const version=state.dirty;const payload=structuredClone(state.current);status('正在保存…');
      try {
        const result=await api(`/api/entries/${payload.id}`,{method:'PUT',body:JSON.stringify(payload)});
        if(state.current?.id!==payload.id)return;
        for(const key of ['revision','folder','created','updated','archiveUrl'])if(result[key]!==undefined)state.current[key]=result[key];
        state.saved=version;$('#entry-date').disabled=true;updateSummary(result);renderAll();
        connectionStatus(true);status(state.saved===state.dirty?'已保存到电脑':'正在保存新修改…');
      }catch(error){if(error.status===409)showConflict();else if(!error.status)connectionStatus(false);status(error.message,true);toast(error.message);throw error;}
    }
  };
  state.saving=run();
  try{await state.saving;}finally{state.saving=null;}
}
async function closeEditor() {
  try{await flush();}catch{return;}
  $('#editor-dialog').close();state.current=null;state.activeText=null;clearTimeout(state.saveTimer);
  const url=new URL(location.href);url.hash='';history.replaceState(null,'',url);
}
function fillEditor() {
  const e=state.current;
  $('#remote-update').hidden=!state.conflicts;
  $('#entry-title').value=e.title==='无标题日记'?'':e.title;
  $('#entry-date').value=e.date??'';$('#entry-date').disabled=!!e.revision||!!e.legacy;
  $('#entry-tags').value=e.tags.map(t=>'#'+t).join(' ');
  $('#entry-origin').textContent=e.legacy?'OneNote · 保留原始资料':e.importSources?.length?'导入资料 · 原件保留':'本地日记';
  $('#import-sources').hidden=!e.importSources?.length;
  $('#import-sources').innerHTML=(e.importSources??[]).map(s=>`<div><span>${esc(s.source)}${s.ranged?' · '+esc(s.rangeStart)+'～'+esc(s.rangeEnd):''}</span><a href="/archive/${esc(s.originalPath)}" download>下载原件</a>${s.viewPath?`<a href="/archive/${esc(s.viewPath)}" target="_blank" rel="noopener">独立查看 ↗</a>`:''}</div>`).join('');
  $('#entry-date').hidden=!!e.group;
  renderDaySummaries();
  $('#editor-label').textContent=e.deleted?'回收站中的日记':'日记';
  $('#pin-entry').classList.toggle('pinned',e.pinned);
  $('#trash-entry').innerHTML=icon(e.deleted?'undo':'trash')+(e.deleted?'恢复日记':'移入回收站');
  renderBlocks();
}
async function openEntry(id) {
  if($('#editor-dialog').open){await closeEditor();if($('#editor-dialog').open)return;}
  try {
    closeOverview();$('#memories-dialog').close();
    state.current=await api(`/api/entries/${id}`);state.dirty=state.saved=0;state.conflicts=false;
    fillEditor();status('已保存到电脑');$('#editor-dialog').showModal();
    history.replaceState(null,'',`#entry=${id}`);
  }catch(error){toast(error.message);}
}
function dailyEntry(date) {
  return state.entries.filter(e=>e.date===date&&!e.deleted&&!e.group)
    .sort((a,b)=>String(a.created).localeCompare(String(b.created))||a.id.localeCompare(b.id))[0];
}
async function writeDaily(type='text',date=state.date||localDate()) {
  if($('#editor-dialog').open){await closeEditor();if($('#editor-dialog').open)return;}
  $('#sidebar').classList.remove('open');
  try{await reloadData();}catch(error){toast(error.message);return;}
  const existing=dailyEntry(date);
  if(!existing){await newEntry(type,date);return;}
  await openEntry(existing.id);
  if(state.current?.id!==existing.id||!$('#editor-dialog').open)return;
  if(type==='image'||type==='html')addBlock(type);
  else {
    const text=document.querySelector('.text-editor');
    if(text){text.focus();text.scrollIntoView({block:'nearest'});}
    else addBlock('text');
  }
}
async function newEntry(type='text',date=state.date||localDate()) {
  if($('#editor-dialog').open){await closeEditor();if($('#editor-dialog').open)return;}
  $('#sidebar').classList.remove('open');
  state.current={id:'n-'+uid().slice(0,24),date,title:'',tags:[],pinned:false,deleted:false,revision:0,blocks:[]};
  state.dirty=state.saved=0;state.conflicts=false;fillEditor();status('尚未输入内容');$('#editor-dialog').showModal();
  if(type==='image') $('#image-input').click();
  else if(type==='html') addBlock('html');
  else { state.current.blocks.push({id:uid(),type:'text',html:''});renderBlocks();document.querySelector('.text-editor')?.focus(); }
}
function blockTools(block,index) {
  return `<div class="block-tools">${block.type==='html'?`<button data-toggle-source="${block.id}">${icon('code')} 源码</button>`:''}<button data-move="${block.id}" data-direction="-1" title="上移内容块" aria-label="上移内容块" ${index===0?'disabled':''}>${icon('up')}</button><button data-move="${block.id}" data-direction="1" title="下移内容块" aria-label="下移内容块" ${index===state.current.blocks.length-1?'disabled':''}>${icon('down')}</button><button data-remove="${block.id}" title="移除内容块" aria-label="移除内容块">${icon('close')}</button></div>`;
}
function htmlDocument(html) {
  const base=state.current?.folder?location.origin+'/archive/'+state.current.folder+'/':location.origin+'/';
  const policy=`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'self'"><base href="${esc(base)}">`;
  if(/<html\b|<!doctype\b/i.test(html)) return /<head\b[^>]*>/i.test(html)?html.replace(/<head\b[^>]*>/i,head=>head+policy):policy+html;
  return `<!doctype html><html><head>${policy}<style>body{margin:16px;font:14px/1.8 system-ui,sans-serif;color:#292e2a;overflow-wrap:anywhere}img{max-width:100%;height:auto}*{box-sizing:border-box}</style></head><body>${html}</body></html>`;
}
function fitArchive(frame) {
  try {
    const doc=frame.contentDocument;if(!doc?.body)return;
    doc.body.style.zoom='1';
    const width=Math.max(doc.body.scrollWidth,doc.documentElement.scrollWidth);
    const scale=Math.min(1,(frame.clientWidth-12)/width);
    if(scale>0)doc.body.style.zoom=String(scale);
    frame.style.height=Math.max(180,Math.min(1300,doc.documentElement.scrollHeight+12))+'px';
  }catch{ /* The frame remains readable at its default size if browser isolation changes. */ }
}
function renderBlocks() {
  const e=state.current;
  $('#blocks').innerHTML=e.blocks.map((b,index)=>{
    let content='';
    if(b.type==='text')content=`<div class="text-editor" contenteditable="true" role="textbox" aria-label="日记文本区" aria-multiline="true" data-placeholder="在这里写下你的日常…">${b.html}</div>`;
    if(b.type==='html')content=`<textarea class="html-source" aria-label="HTML 源码" spellcheck="false">${esc(b.html)}</textarea><iframe class="html-preview" sandbox="allow-same-origin" title="HTML 内容预览"></iframe>`;
    if(b.type==='image')content=`<img class="block-image" src="${esc(resource(e,b.file))}" data-lightbox="${esc(resource(e,b.file))}" alt="${esc(b.caption||'日记原图')}"><input class="image-caption" aria-label="图片说明" placeholder="添加图片说明…" value="${esc(b.caption)}">`;
    if(b.type==='archive')content=`<div class="archive-actions"><span>原始 HTML 内容 · 保留排版和原图</span><a href="${esc(e.archiveUrl)}" target="_blank" rel="noopener">独立打开 ↗</a><a href="/archive/${esc(e.folder)}/originals.html" target="_blank" rel="noopener">查看原图 ↗</a><button data-reload-frame="${b.id}">适配宽度</button><button data-edit-archive="${b.id}">编辑 HTML 副本</button></div><iframe class="archive-frame" sandbox="allow-same-origin allow-downloads" title="OneNote 原始页面" src="${esc(e.archiveUrl)}"></iframe>`;
    return `<section class="content-block" data-block="${b.id}" data-type="${b.type}"><div class="block-label">${icon({text:'text',html:'code',image:'image',archive:'book'}[b.type])}<span>${{text:'文本区',html:'HTML 区域',image:'图片',archive:'OneNote 原始 HTML'}[b.type]}</span>${blockTools(b,index)}</div>${content}</section>`;
  }).join('');
  document.querySelectorAll('.html-preview').forEach(frame=>{const b=e.blocks.find(b=>b.id===frame.closest('[data-block]').dataset.block);frame.srcdoc=htmlDocument(b.html);frame.addEventListener('load',()=>fitArchive(frame));});
  document.querySelectorAll('.archive-frame').forEach(frame=>frame.addEventListener('load',async()=>{
    try { await Promise.all([...frame.contentDocument.images].map(i=>i.decode().catch(()=>{}))); }catch{}
    fitArchive(frame);
  }));
}
function addBlock(type) {
  if(!state.current)return;
  if(type==='image') {$('#image-input').click();return;}
  capture();
  state.current.blocks.push({id:uid(),type,html:type==='html'?'<section style="padding: 20px; background: #f1f5ee; border-radius: 10px;">\n  <h2>这一刻的小记</h2>\n  <p>在这里编辑你的 HTML 内容。</p>\n</section>':''});
  renderBlocks();changed();
  const last=$('#blocks').lastElementChild;last?.scrollIntoView({block:'nearest'});last?.querySelector('.text-editor,.html-source')?.focus();
}
async function uploadImages(files) {
  if(!state.current)return;
  const accepted=[...files].filter(f=>f.type.startsWith('image/'));
  if(!accepted.length){toast('请选择图片文件');return;}
  try {
    if(!state.current.revision){changed();await flush();}
    const id=state.current.id;
    for(const file of accepted) {
      status(`正在保存原图：${file.name}…`);
      const image=await api(`/api/entries/${id}/images`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      if(state.current?.id!==id)throw new Error('日记已关闭，原图已保存在对应日期目录。');
      capture();state.current.blocks.push({id:uid(),type:'image',file:image.file,caption:''});renderBlocks();changed();await flush();
    }
    toast(`已保存 ${accepted.length} 张原图`);
  }catch(error){status(error.message,true);toast(error.message);}
}
function lightbox(url) { $('#lightbox-image').src=url;$('#lightbox-download').href=url;$('#image-dialog').showModal(); }
async function pin(id) {
  try{const e=await api(`/api/entries/${id}`);const saved=await api(`/api/entries/${id}`,{method:'PUT',body:JSON.stringify({...e,pinned:!e.pinned})});updateSummary(saved);renderAll();}
  catch(error){toast(error.message);}
}
function downloadDraft() {
  capture();const data=JSON.stringify(state.current,null,2),url=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`朝花夕拾-${state.current.date??'目录'}-${state.current.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function showHistory() {
  try {
    await flush();const versions=await api(`/api/entries/${state.current.id}/history`);
    $('#history-list').innerHTML=versions.length?versions.map(v=>`<div><span>版本 ${v.revision} · ${esc(v.title)}<small>${esc(new Date(v.updated).toLocaleString('zh-CN'))}</small></span><button data-restore="${v.revision}">恢复此版本</button></div>`).join(''):'<p>还没有历史版本。保存修改后，会保留上一个版本。</p>';
    $('#history-dialog').showModal();
  }catch(error){toast(error.message);}
}

document.addEventListener('click',async event=>{
  const button=event.target.closest('button,a,img');if(!button)return;
  if(button.dataset.dayDetails){await openDayDetails(button.dataset.dayDetails==='today'?localDate():button.dataset.dayDetails);return;}
  if(button.dataset.dayChoice){
    if(state.daySaving)return;
    const draft=state.dayDraft,kind=button.dataset.dayKind,id=button.dataset.dayChoice;
    if(!draft)return;draft[kind]=draft[kind].includes(id)?draft[kind].filter(value=>value!==id):[...draft[kind],id];draft.dirty=true;
    // Keep the clicked button focused for keyboard and touch selection.
    button.setAttribute('aria-pressed',String(draft[kind].includes(id)));return;
  }
  if(button.dataset.calendarMode){state.calendarMode=button.dataset.calendarMode;localStorage.setItem('diary-calendar-mode',state.calendarMode);renderCalendar();return;}
  if(button.dataset.memoryStep){const [m,d]=state.memoryDay.split('-').map(Number),next=new Date(2000,m-1,d+Number(button.dataset.memoryStep));changeMemory(next.getMonth()+1,next.getDate());return;}
  if(button.hasAttribute('data-memory-today')){state.memoryDay=localDate().slice(5);renderMemories();return;}
  if(button.hasAttribute('data-memory-random')){const dates=[...new Set(state.entries.filter(e=>!e.deleted&&!e.group&&e.date&&Number(e.date.slice(0,4))<new Date().getFullYear()).map(e=>e.date.slice(5)))];if(dates.length){state.memoryDay=dates[Math.floor(Math.random()*dates.length)];renderMemories();}else toast('慢慢记录，让今天成为以后的回忆。');return;}
  if(button.hasAttribute('data-memory-expand')){closeOverview();$('#memories-dialog').showModal();return;}
  if(button.dataset.view)setView(button.dataset.view);
  if(button.dataset.action==='new')await newEntry();
  if(button.dataset.action==='daily')await writeDaily();
  if(button.dataset.action==='today')await writeDaily('text',localDate());
  if(button.dataset.create)await writeDaily(button.dataset.create);
  if(button.dataset.open)await openEntry(button.dataset.open);
  if(button.dataset.pin)await pin(button.dataset.pin);
  if(button.dataset.month){clearFilters();state.month=button.dataset.month;state.calendar=new Date(state.month+'-01T12:00:00');renderAll();}
  if(button.dataset.tag){clearFilters();state.tag=button.dataset.tag;renderAll();}
  if(button.dataset.date){const date=button.dataset.date;clearFilters();state.date=date;renderAll();closeOverview();}
  if(button.dataset.lightbox)lightbox(button.dataset.lightbox);
  if(button.dataset.close)$('#'+button.dataset.close).close();
  if(button.dataset.insert)addBlock(button.dataset.insert);
  if(button.dataset.remove){
    const block=state.current.blocks.find(b=>b.id===button.dataset.remove);capture();
    if((block.type==='archive'||block.type==='html'&&block.html||block.type==='text'&&block.html)&&!confirm('移除此内容块？已保存的内容可以从历史版本恢复，原始资料仍保留。'))return;
    state.current.blocks=state.current.blocks.filter(b=>b.id!==button.dataset.remove);renderBlocks();changed();
  }
  if(button.dataset.move){capture();const i=state.current.blocks.findIndex(b=>b.id===button.dataset.move),j=i+Number(button.dataset.direction);if(j>=0&&j<state.current.blocks.length){[state.current.blocks[i],state.current.blocks[j]]=[state.current.blocks[j],state.current.blocks[i]];renderBlocks();changed();}}
  if(button.dataset.toggleSource){const textarea=document.querySelector(`[data-block="${button.dataset.toggleSource}"] .html-source`);textarea.hidden=!textarea.hidden;}
  if(button.dataset.reloadFrame)fitArchive(document.querySelector(`[data-block="${button.dataset.reloadFrame}"] iframe`));
  if(button.dataset.editArchive){
    if(!confirm('创建可编辑的 HTML 副本？修改副本可能影响排版；原始文件和图片会继续保留，也可通过历史版本恢复引用。'))return;
    try{const entryId=state.current.id;const response=await fetch(state.current.archiveUrl);if(!response.ok)throw new Error('无法读取原始 HTML');const html=await response.text();if(state.current?.id!==entryId)return;capture();const block=state.current.blocks.find(b=>b.id===button.dataset.editArchive);block.type='html';block.html=html;block.originPageKey=entryId;delete block.pageKey;renderBlocks();changed();toast('现在可以编辑 HTML 源码，原始文件继续保留');}catch(error){toast(error.message);}
  }
  if(button.dataset.restore!==undefined){
    try{const e=await api(`/api/entries/${state.current.id}/restore`,{method:'POST',body:JSON.stringify({revision:state.current.revision,restoreRevision:Number(button.dataset.restore)})});state.current=e;state.dirty=state.saved=0;fillEditor();status('已恢复并保存');updateSummary(e);renderAll();$('#history-dialog').close();toast('历史版本已恢复，替换前的版本仍保留');}catch(error){toast(error.message);}
  }
});
document.addEventListener('change',event=>{
  const [month,day]=state.memoryDay.split('-').map(Number);
  if(event.target.hasAttribute('data-memory-month'))changeMemory(Number(event.target.value),day);
  if(event.target.hasAttribute('data-memory-date'))changeMemory(month,Number(event.target.value));
});
$('#memory-sort').onclick=()=>{state.memoryOldest=!state.memoryOldest;renderMemories();};
$('#save-day').onclick=saveDay;$('#cancel-day').onclick=cancelDay;$('#cancel-day-x').onclick=cancelDay;
$('#day-dialog').addEventListener('cancel',event=>{event.preventDefault();cancelDay();});
$('#clear-day').onclick=()=>{if(state.daySaving)return;state.dayDraft.moods=[];state.dayDraft.weather=[];state.dayDraft.dirty=true;renderDayChoices();};
$('#reload-day').onclick=async()=>{if(state.daySaving)return;try{const draft=await api(`/api/days/${state.dayDraft.date}`);state.dayDraft={...draft,dirty:false};state.days[draft.date]=draft;renderDayChoices();renderDaySummaries();$('#day-save-status').textContent='已载入最新记录，可以继续修改。';$('#reload-day').hidden=true;}catch(error){$('#day-save-status').textContent=error.message;}};
$('#show-overview').onclick=()=>{$('#overview-content').appendChild($('.rightbar'));$('#overview-dialog').showModal();};
$('#overview-dialog').addEventListener('close',()=>$('.columns').appendChild($('.rightbar')));
window.addEventListener('resize',()=>{if(innerWidth>980)closeOverview();});
$('#search').addEventListener('input',()=>{state.query=$('#search').value;state.limit=20;$('#clear-search').hidden=!state.query;renderFeed();});
$('#clear-search').onclick=()=>{$('#search').value='';state.query='';$('#clear-search').hidden=true;renderFeed();};
$('#focus-search').onclick=()=>{$('#search').focus();$('#sidebar').classList.remove('open');};
$('#clear-filter').onclick=()=>{clearFilters();renderAll();};
$('#sort').onclick=()=>{state.ascending=!state.ascending;renderFeed();};
$('#load-more').onclick=()=>{state.limit+=20;renderFeed();};
$('#quick-write').onclick=()=>writeDaily();
$('#prev-month').onclick=()=>{state.calendar=new Date(state.calendar.getFullYear(),state.calendar.getMonth()-1,1);renderCalendar();};
$('#next-month').onclick=()=>{state.calendar=new Date(state.calendar.getFullYear(),state.calendar.getMonth()+1,1);renderCalendar();};
$('#calendar-year').onchange=()=>{state.calendar=new Date(Number($('#calendar-year').value),state.calendar.getMonth(),1);renderCalendar();};
$('#calendar-month').onchange=()=>{state.calendar=new Date(state.calendar.getFullYear(),Number($('#calendar-month').value)-1,1);renderCalendar();};
$('#calendar-today').onclick=()=>{state.calendar=new Date();clearFilters();renderAll();};
$('#theme').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('life-theme',theme);};
document.documentElement.dataset.theme=localStorage.getItem('life-theme')??'light';
$('#menu').onclick=()=>$('#sidebar').classList.toggle('open');$('#shade').onclick=()=>$('#sidebar').classList.remove('open');
$('#about').onclick=()=>$('#about-dialog').showModal();
$('#today-label').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});
$('#close-editor').onclick=closeEditor;$('#save-entry').onclick=closeEditor;
$('#editor-dialog').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
$('#entry-title').oninput=changed;$('#entry-tags').oninput=changed;$('#entry-date').onchange=()=>{changed();renderDaySummaries();};
$('#pin-entry').onclick=()=>{state.current.pinned=!state.current.pinned;$('#pin-entry').classList.toggle('pinned',state.current.pinned);changed();};
$('#trash-entry').onclick=async()=>{
  if(!state.current.deleted&&!confirm('将这篇日记移入回收站？之后可以恢复，原始资料仍保留。'))return;
  state.current.deleted=!state.current.deleted;changed();await closeEditor();
};
$('#download-entry').onclick=downloadDraft;$('#entry-history').onclick=showHistory;
$('#connection-status').onclick=syncRemote;
$('#reload-entry').onclick=async()=>{
  if(state.dirty!==state.saved&&!confirm('重新加载会替换此页尚未保存的草稿，请先点击“导出”保留需要的内容。继续重新加载？'))return;
  const current=state.current;if(!current||state.saving)return;
  const version=state.dirty;
  try{
    const fresh=await api(`/api/entries/${current.id}`);
    if(state.current!==current||state.dirty!==version){toast('加载期间有新输入，草稿已保留，请再次操作');return;}
    state.current=fresh;state.dirty=state.saved=0;state.conflicts=false;fillEditor();updateSummary(fresh);renderAll();status('已重新加载电脑上的版本');
  }catch(error){toast(error.message);}
};
$('#blocks').addEventListener('input',event=>{
  changed();
  if(event.target.classList.contains('html-source')){
    const frame=event.target.parentElement.querySelector('iframe');clearTimeout(frame._timer);frame._timer=setTimeout(()=>frame.srcdoc=htmlDocument(event.target.value),450);
  }
});
$('#blocks').addEventListener('focusin',event=>{if(event.target.classList.contains('text-editor'))state.activeText=event.target;});
$('#format-bar').addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
$('#format-bar').addEventListener('click',event=>{
  const button=event.target.closest('[data-command]');if(!button||!state.activeText?.isConnected)return;
  state.activeText.focus();document.execCommand(button.dataset.command,false,button.dataset.value??null);changed();
});
$('#image-input').onchange=async()=>{await uploadImages($('#image-input').files);$('#image-input').value='';};
$('#editor-dialog').addEventListener('paste',event=>{
  const files=[...event.clipboardData.files];
  if(files.some(f=>f.type.startsWith('image/'))){event.preventDefault();uploadImages(files);return;}
  if(event.target.closest('.text-editor')){
    event.preventDefault();const text=event.clipboardData.getData('text/plain');document.execCommand('insertText',false,text);changed();
  }
});
$('#editor-dialog').addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();$('#editor-dialog').classList.add('drop-target');}});
$('#editor-dialog').addEventListener('dragleave',()=>$('#editor-dialog').classList.remove('drop-target'));
$('#editor-dialog').addEventListener('drop',event=>{if(event.dataTransfer.files.length){event.preventDefault();$('#editor-dialog').classList.remove('drop-target');uploadImages(event.dataTransfer.files);}});
document.addEventListener('keydown',event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!$('#editor-dialog').open)$('#search').focus();}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&$('#editor-dialog').open){event.preventDefault();flush().catch(()=>{});}
});
window.addEventListener('beforeunload',event=>{if(state.dirty>state.saved||state.saving||state.dayDraft?.dirty||state.daySaving){event.preventDefault();event.returnValue='';}});
window.addEventListener('resize',()=>document.querySelectorAll('.archive-frame').forEach(fitArchive));
window.addEventListener('hashchange',()=>{const id=location.hash.match(/^#entry=([\w-]+)$/)?.[1];if(id&&state.current?.id!==id)openEntry(id);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&state.dirty>state.saved)flush().catch(()=>{});else if(document.visibilityState==='visible')syncRemote();});
window.addEventListener('focus',syncRemote);
window.addEventListener('online',syncRemote);
window.addEventListener('offline',()=>connectionStatus(false));
$('#auth-cancel').onclick=()=>$('#auth-dialog').close();
$('#reauth-form').onsubmit=async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector('button');button.disabled=true;
  try{
    const response=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('#reauth-password').value})});
    const data=await response.json();if(!response.ok)throw Error(data.error);
    $('#reauth-password').value='';$('#reauth-status').textContent='';$('#auth-dialog').close();
    // Refresh the write token after service restarts without replacing an unsaved draft.
    state.changeVersion=null;await syncRemote();toast('已重新登录，可以继续记录。');
  }catch(error){$('#reauth-status').textContent=error.message;}finally{button.disabled=false;}
};
$('#remote-logout').onclick=async()=>{
  if(state.dirty!==state.saved||state.saving||state.dayDraft?.dirty||state.daySaving){toast('请先保存或导出当前草稿，再退出登录。');return;}
  try{
    const response=await fetch('/auth/logout',{method:'POST'});
    if(!response.ok && response.status!==401)throw Error('退出未完成，请重试');
    location.replace('/login');
  }catch(error){toast(error.message);}
};
setInterval(syncRemote,15_000);
renderIcons();
try{await reloadData();connectionStatus(true);const id=location.hash.match(/^#entry=([\w-]+)$/)?.[1];if(id)await openEntry(id);}
catch(error){connectionStatus(false);$('#feed').innerHTML=`<div class="empty"><strong>暂时无法打开日记空间</strong>${esc(error.message)}<br>请确认电脑在线且日记服务正在运行，连接恢复后会自动重试。</div>`;}
