const ActionMenu=(()=>{
 let serial=0,opened=null;
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const drawings={more:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>',refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>'};
 const svg=name=>`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${drawings[name]||drawings.more}</svg>`;
 function icon(name,label,attributes='',className='ui-icon-button'){return `<button type="button" class="${className}" aria-label="${e(label)}" title="${e(label)}" ${attributes}>${svg(name)}</button>`;}
 function render(items,label='Ещё действия'){
  if(!items?.trim())return '';
  const id='actionMenu-'+(++serial);
  return `<div class="action-menu" data-action-menu>${icon('more',label,`data-action-menu-toggle aria-expanded="false" aria-controls="${id}"`,'ui-icon-button action-menu-toggle')}<div class="action-menu-panel" id="${id}" role="group" aria-label="${e(label)}" hidden>${items}</div></div>`;
 }
 function close(restore=false){if(!opened)return;const old=opened;opened=null;old.panel.hidden=true;old.trigger.setAttribute('aria-expanded','false');if(restore&&old.trigger.isConnected)old.trigger.focus({preventScroll:true});}
 function position(){
  if(!opened)return;const {trigger,panel}=opened;if(!trigger.isConnected){close();return;}
  const viewport=window.visualViewport,width=viewport?.width||innerWidth,height=viewport?.height||innerHeight,offsetX=viewport?.offsetLeft||0,offsetY=viewport?.offsetTop||0;
  const rect=trigger.getBoundingClientRect(),nav=document.getElementById('mobileNavigation')?.getBoundingClientRect();
  const bottom=nav?.height&&nav.top<height?Math.min(height+offsetY-10,nav.top-8):height+offsetY-10;
  if(rect.bottom<offsetY||rect.top>bottom){close();return;}
  const available=Math.max(44,bottom-offsetY-10);panel.style.width=Math.min(272,width-24)+'px';panel.style.maxHeight=available+'px';
  const bounds=panel.getBoundingClientRect(),left=Math.max(offsetX+12,Math.min(rect.right-bounds.width,offsetX+width-bounds.width-12));
  let top=rect.bottom+6;if(top+bounds.height>bottom)top=rect.top-bounds.height-6;top=Math.max(offsetY+10,Math.min(top,bottom-bounds.height));
  panel.style.left=left+'px';panel.style.top=top+'px';
 }
 function items(){return opened?[...opened.panel.querySelectorAll('button:not(:disabled),a[href]')].filter(n=>n.getClientRects().length):[];}
 function show(host,last=false){close();const trigger=host.querySelector('[data-action-menu-toggle]'),panel=host.querySelector('.action-menu-panel');opened={host,trigger,panel};panel.hidden=false;trigger.setAttribute('aria-expanded','true');position();const list=items();(last?list.at(-1):list[0])?.focus({preventScroll:true});}
 document.addEventListener('click',event=>{
  const trigger=event.target.closest('[data-action-menu-toggle]');
  if(trigger){event.preventDefault();const host=trigger.closest('[data-action-menu]');if(opened?.host===host)close(true);else show(host);return;}
  if(opened&&!opened.host.contains(event.target)){close(false);return;}
  if(opened&&event.target.closest('button,a'))close(opened.panel.contains(document.activeElement));
 });
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&opened){event.preventDefault();event.stopPropagation();close(true);return;}
  const trigger=event.target.closest('[data-action-menu-toggle]');
  if(trigger&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show(trigger.closest('[data-action-menu]'),event.key==='ArrowUp');return;}
  if(opened&&opened.panel.contains(event.target)&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
   event.preventDefault();const list=items(),index=list.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?list.length-1:(index+(event.key==='ArrowDown'?1:-1)+list.length)%list.length;list[next]?.focus();
  }
 });
 document.addEventListener('focusin',event=>{if(opened&&!opened.host.contains(event.target))close(false);});
 document.addEventListener('close',event=>{if(opened&&event.target.contains(opened.host))close(false);},true);
 document.addEventListener('scroll',position,true);window.addEventListener('resize',position);window.visualViewport?.addEventListener('resize',position);
 return {render,icon,closeAll:close};
})();
