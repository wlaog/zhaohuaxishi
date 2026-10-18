const layer=document.querySelector('#petals-layer');
const toggle=document.querySelector('#petals-toggle');
const storageKey='zhaohuaxishi-petals';
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const mobile=matchMedia('(max-width: 660px)');
let preference;
try { preference=localStorage.getItem(storageKey); } catch { /* The switch also works when browser storage is unavailable. */ }
let enabled=preference===null||preference===undefined?!reduced.matches:preference==='on';
let config;
const between=([min,max])=>min+Math.random()*(max-min);

function render() {
  toggle.setAttribute('aria-checked',String(enabled));
  toggle.title=enabled?'关闭花瓣飘落':'开启花瓣飘落';
  layer.replaceChildren();layer.hidden=!enabled||!config;
  layer.dataset.paused=String(document.hidden);
  if(layer.hidden)return;
  const petals=document.createDocumentFragment();
  const count=mobile.matches?config.mobileCount:config.desktopCount;
  for(let i=0;i<count;i++) {
    const track=document.createElement('span');track.className='petal-track';
    const sway=document.createElement('span');sway.className='petal-sway';
    const petal=document.createElement('span');petal.className='petal';
    const duration=between(config.durationSeconds);
    // Even spacing keeps the effect sparse; negative delays begin gently across the viewport.
    track.style.setProperty('--left',`${(i+.15+Math.random()*.7)/count*100}%`);
    track.style.setProperty('--fall-duration',`${duration}s`);
    track.style.setProperty('--fall-delay',`${-Math.random()*duration}s`);
    track.style.setProperty('--sway-duration',`${between(config.swaySeconds)}s`);
    track.style.setProperty('--sway-delay',`${-Math.random()*10}s`);
    track.style.setProperty('--drift',`${between(config.driftPixels)}px`);
    track.style.setProperty('--size',`${between(config.sizePixels)}px`);
    track.style.setProperty('--petal-opacity',between(config.opacity).toFixed(2));
    track.style.setProperty('--turn',`${Math.random()*360}deg`);
    petal.classList.toggle('petal-warm',i%3===0);
    sway.append(petal);track.append(sway);petals.append(track);
  }
  layer.append(petals);
}

toggle.addEventListener('click',()=>{
  enabled=!enabled;preference=enabled?'on':'off';
  try { localStorage.setItem(storageKey,preference); } catch { /* Keep the current page preference in memory. */ }
  render();
});
mobile.addEventListener('change',render);
reduced.addEventListener('change',()=>{if(preference===null||preference===undefined){enabled=!reduced.matches;render();}});
document.addEventListener('visibilitychange',()=>{layer.dataset.paused=String(document.hidden);});
window.addEventListener('storage',event=>{
  if(event.key!==storageKey&&event.key!==null)return;
  preference=event.key===null?null:event.newValue;
  enabled=preference===null?!reduced.matches:preference==='on';render();
});
render();
try {
  const response=await fetch('/petals.json',{signal:AbortSignal.timeout(10_000)});
  if(!response.ok)throw Error('Animation settings unavailable');
  config=await response.json();render();
} catch {
  // Decoration never prevents diary loading or editing, including during a lost connection.
  layer.hidden=true;toggle.disabled=true;toggle.setAttribute('aria-checked','false');toggle.title='花瓣效果暂不可用，刷新页面后重试';
}
