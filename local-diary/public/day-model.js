// Shared, fixed choices keep saved metadata portable and icons available offline.
export const MOODS=[
  {id:'happy',label:'开心',color:'#F0CF87',face:'smile'},
  {id:'calm',label:'平静',color:'#B8D3B8',face:'calm'},
  {id:'excited',label:'兴奋',color:'#EAB28D',face:'excited'},
  {id:'grateful',label:'感激',color:'#E8B2BE',face:'smile'},
  {id:'thoughtful',label:'沉思',color:'#C2C2DD',face:'think'},
  {id:'tired',label:'疲惫',color:'#CFC4B4',face:'tired'},
  {id:'sad',label:'低落',color:'#AACBDD',face:'sad'},
  {id:'anxious',label:'焦虑',color:'#CBB9D8',face:'anxious'},
  {id:'angry',label:'烦躁',color:'#DFA79C',face:'angry'},
];
export const WEATHERS=[
  {id:'sunny',label:'晴',color:'#F2D894'},
  {id:'cloudy',label:'多云',color:'#D4DFC8'},
  {id:'overcast',label:'阴',color:'#C7CED5'},
  {id:'rainy',label:'雨',color:'#B6CFDF'},
  {id:'thunder',label:'雷雨',color:'#C5BDDA'},
  {id:'snowy',label:'雪',color:'#D2E4E7'},
  {id:'foggy',label:'雾',color:'#D3D7CE'},
  {id:'windy',label:'风',color:'#BCD8CC'},
];
export const choices=kind=>kind==='moods'?MOODS:WEATHERS;
export const chosen=(kind,ids=[])=>ids.map(id=>choices(kind).find(item=>item.id===id)).filter(Boolean);
export const dayHasDetails=day=>!!(day?.moods?.length||day?.weather?.length);
export function dayGradient(items){
  return `linear-gradient(135deg,${items.map((item,i)=>`${item.color} ${i/items.length*100}% ${(i+1)/items.length*100}%`).join(',')})`;
}
export function dayIcon(kind,id){
  const item=choices(kind).find(choice=>choice.id===id);if(!item)return '';
  let drawing;
  if(kind==='moods'){
    const mouths={smile:'M7.5 13.5Q12 19 16.5 13.5',calm:'M8.5 14.5Q12 16.5 15.5 14.5',excited:'M9 13h6v2a3 3 0 0 1-6 0z',think:'M9 15h6',tired:'M9 15h6',sad:'M8 16Q12 11.5 16 16',anxious:'m8 15 2-1 2 1 2-1 2 1',angry:'M8 16Q12 13 16 16'};
    const eyes=item.face==='calm'||item.face==='tired'?'<path d="m6.5 10 3 0m5 0h3"/>':item.face==='angry'?'<path d="m6.5 8.5 3 1.5m8-1.5-3 1.5"/>':'<circle cx="8.5" cy="10" r=".8" fill="currentColor"/><circle cx="15.5" cy="10" r=".8" fill="currentColor"/>';
    drawing=`<circle cx="12" cy="12" r="10" fill="${item.color}" stroke="none"/>${eyes}<path d="${mouths[item.face]}"/>`;
  }else{
    const sun='<circle cx="9" cy="8" r="3.5"/><path d="M9 1v1M9 14v1M2 8H1m15 0h1M4 3l1 1m8 8 1 1M4 13l1-1m8-8 1-1"/>';
    const cloud='<path d="M6 17a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.7 1.3A3.4 3.4 0 1 1 18 17Z" fill="var(--symbol-cloud,#f8faf6)"/>';
    const drawings={sunny:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',cloudy:sun+cloud,overcast:cloud,rainy:cloud+'<path d="m8 20-1 2m6-2-1 2m6-2-1 2"/>',thunder:cloud+'<path d="m13 17-3 4h3l-1 3 5-5h-4"/>',snowy:cloud+'<path d="M8 20v3m-1.5-2.3 3 1.5m0-1.5-3 1.5M17 20v3m-1.5-2.3 3 1.5m0-1.5-3 1.5"/>',foggy:cloud+'<path d="M4 20h16M7 23h10"/>',windy:'<path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M5 17h5a3 3 0 1 1-3 3"/>'};
    drawing=`<rect x="0.5" y="0.5" width="23" height="25" rx="6" fill="${item.color}" stroke="none"/>`+drawings[id];
  }
  return `<svg class="day-icon" viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawing}</svg>`;
}
export function memoriesOn(entries,monthDay,year=new Date().getFullYear()){
  return entries.filter(e=>!e.deleted&&!e.group&&/^20\d{2}-\d{2}-\d{2}$/.test(e.date??'')&&e.date.slice(5)===monthDay&&Number(e.date.slice(0,4))<year)
    .sort((a,b)=>b.date.localeCompare(a.date)||String(a.created??'').localeCompare(String(b.created??''))||a.id.localeCompare(b.id));
}
