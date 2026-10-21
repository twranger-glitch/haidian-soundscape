// The host deliberately hides Leaflet's top-right corner. Keep this entry in
// the document body so an ancestor display:none cannot make it unreachable.
export function createEstimatedLauncher(panel,L,{document:doc=globalThis.document}={}){
 const button=doc.createElement('button');button.type='button';button.id='astra-gba-launcher';button.className='astra-gba-toggle';
 button.textContent='GBA 估計';button.title='開啟建築與樹蔭估計';
 button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded',String(!panel.hidden));
 function setOpen(open){panel.hidden=!open;button.setAttribute('aria-expanded',String(open));if(open)panel.querySelector('[data-gba-close]')?.focus?.({preventScroll:true});else button.focus?.({preventScroll:true});}
 const keydown=e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopPropagation();setOpen(false);}};panel.addEventListener('keydown',keydown);
 const toggle=()=>setOpen(panel.hidden);button.addEventListener('click',toggle);
 L.DomEvent.disableClickPropagation(button);L.DomEvent.disableScrollPropagation(button);doc.body.append(button);
 return {element:button,open:()=>setOpen(true),close:()=>setOpen(false),remove(){button.removeEventListener('click',toggle);panel.removeEventListener('keydown',keydown);button.remove();}};
}
