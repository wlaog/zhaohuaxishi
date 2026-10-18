// postMessage works for both an HTTP preview and a double-clicked file:// archive.
window.addEventListener('message',event=>{
 if(event.source!==parent||event.data?.type!=='life-zoom')return;
 const {value,width}=event.data;
 document.body.style.zoom='1';
 const natural=Math.max(document.body.scrollWidth,document.documentElement.scrollWidth);
 const scale=value==='fit'?Math.min(1,(Math.max(100,Number(width))-12)/natural):Number(value);
 if(Number.isFinite(scale)&&scale>0&&scale<=4)document.body.style.zoom=String(scale);
});
