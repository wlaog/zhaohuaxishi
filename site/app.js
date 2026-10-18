/* Offline reader. No external services, fonts, or network requests. */
(()=>{
'use strict';
const data=window.NOTEBOOK,$=id=>document.getElementById(id);
const pages=data.pages,byKey=new Map(pages.map(p=>[p.key,p])),sections=new Map(data.sections.map(s=>[s.key,s]));
const active=pages.filter(p=>!p.recycle),current={page:null};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sectionName=p=>[...sections.get(p.sectionKey).groups,sections.get(p.sectionKey).name].map(x=>x==='OneNote_RecycleBin'?'回收站':x).join(' / ');
function tree(ps){const roots=[],stack=[];for(const p of ps){const n={p,children:[]};while(stack.length&&stack.at(-1).p.level>=p.level)stack.pop();(stack.length?stack.at(-1).children:roots).push(n);stack.push(n)}return roots}
function nodes(ns){return ns.map(({p,children})=>{const a=`<a class="page-link" data-key="${p.key}" href="#${p.key}" title="${esc(p.title)}">${esc(p.title||'无标题页')}</a>`;return children.length?`<details class="page-node"><summary>${a}</summary><div class="page-children">${nodes(children)}</div></details>`:`<div class="page-node leaf">${a}</div>`}).join('')}
function renderTree(){
  $('tree').innerHTML=data.sections.filter(s=>s.pageCount).map(s=>`<details class="section" data-section="${s.key}"><summary>${s.recycle?'↳ ':''}${esc(s.name)}<span class="section-count">${s.pageCount}</span></summary>${nodes(tree(pages.filter(p=>p.sectionKey===s.key)))}</details>`).join('');
  $('nav-label').textContent='笔记本目录';highlight();
}
function highlight(){document.querySelectorAll('.page-link').forEach(a=>{const on=a.dataset.key===current.page?.key;a.classList.toggle('active',on);if(on){a.setAttribute('aria-current','page');let p=a.parentElement;while(p){if(p.tagName==='DETAILS')p.open=true;p=p.parentElement}}else a.removeAttribute('aria-current')})}
function home(){
  const recent=active.slice().sort((a,b)=>b.modified.localeCompare(a.modified)).slice(0,5);
  $('home').innerHTML=`<div class="eyebrow">THE PERSONAL ARCHIVE</div><h1>日子，都在这里。</h1><p class="intro">从一页日记，到一段时光。<br>沿着原来的目录，重新翻开 朝花夕拾 里的生活记录。</p><div class="stats"><div class="stat"><strong>${active.length}</strong><span>篇页面</span></div><div class="stat"><strong>${active.reduce((s,p)=>s+p.images,0).toLocaleString()}</strong><span>张原始图片</span></div><div class="stat"><strong>${data.sections.filter(s=>!s.recycle).length}</strong><span>个分区</span></div></div><div class="section-heading"><h2>按年份翻阅</h2><span>时光篇章</span></div><div class="year-grid">${data.sections.filter(s=>!s.recycle).map(s=>{const p=active.find(p=>p.sectionKey===s.key);return `<a class="year-card" href="${p?'#'+p.key:'#'}"><div class="card-top"><strong>${esc(s.name)}</strong><span class="arrow">↗</span></div><p>${s.pageCount} 篇页面 · 保留原有层级</p></a>`}).join('')}</div><div class="section-heading"><h2>最近编辑的记录</h2><span>RECENT PAGES</span></div><div class="recent-list">${recent.map(p=>`<a href="#${p.key}"><span class="year-tag">${esc(sections.get(p.sectionKey).name)}</span><span>${esc(p.title)}</span><small>${p.modified.slice(0,10)}</small></a>`).join('')}</div><p class="home-note">导出于 ${new Date(data.exportedAt).toLocaleString('zh-CN')} · 原始 HTML 与图片保存在本地 · 保留原有目录与页面层级</p>`;
}
function route(){
 const key=location.hash.slice(1),p=byKey.get(key);current.page=p??null;
 $('home').hidden=!!key;$('reader').hidden=!p;$('empty').hidden=!key||!!p;$('native-link').hidden=!p;$('zoom-label').hidden=!p;$('originals-link').hidden=!p?.images;
 if(!p){$('breadcrumb').innerHTML='朝花夕拾 <span>/</span> 总览';document.title='朝花夕拾 · 日记档案';highlight();return}
 document.title=p.title+' · 朝花夕拾';$('page-title').textContent=p.title;$('breadcrumb').textContent='朝花夕拾 / '+sectionName(p);
 $('page-info').textContent=`${p.images} 张图片${p.attachments?' · '+p.attachments+' 个附件':''} · 修改于 ${p.modified.slice(0,10)}${p.recycle?' · 回收站归档':''}`;
 const ps=pages.filter(x=>x.sectionKey===p.sectionKey),i=ps.findIndex(x=>x.key===p.key);
 $('page-position').textContent=`${i+1} / ${ps.length}`;$('previous').disabled=i===0;$('next').disabled=i===ps.length-1;
 $('previous').onclick=()=>{if(i>0)location.hash=ps[i-1].key};$('next').onclick=()=>{if(i<ps.length-1)location.hash=ps[i+1].key};
 $('native-link').href=p.url.replace('index.html','native.htm');$('originals-link').href=p.url.replace('index.html','originals.html');$('page-frame').src=p.url;
 $('sidebar').classList.remove('visible');highlight();
 try{localStorage.setItem('life.lastPage',p.key)}catch{}
}
function zoom(){
 const f=$('page-frame');f.contentWindow?.postMessage({type:'life-zoom',value:$('zoom').value,width:f.clientWidth},'*');
}
$('page-frame').addEventListener('load',zoom);$('zoom').addEventListener('change',zoom);window.addEventListener('resize',zoom);
$('search').addEventListener('input',()=>{const q=$('search').value.trim().toLocaleLowerCase();if(!q)return renderTree();const matches=pages.filter(p=>(p.title+' '+p.search).toLocaleLowerCase().includes(q));$('nav-label').textContent=`搜索结果 · ${matches.length}`;$('tree').innerHTML=matches.map(p=>`<div class="search-result"><small>${esc(sectionName(p))}</small><a href="#${p.key}" data-key="${p.key}" class="page-link">${esc(p.title)}</a></div>`).join('')||'<p class="search-note">没有匹配的记录，试试其他关键词。</p>';highlight()});
$('collapse').onclick=()=>document.querySelectorAll('#tree details').forEach(d=>d.open=false);
$('menu').onclick=()=>$('sidebar').classList.toggle('visible');
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus()}if(e.key==='Escape')$('sidebar').classList.remove('visible')});
window.addEventListener('hashchange',route);home();renderTree();route();
})();
