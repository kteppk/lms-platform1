const DesktopNavigation=(()=>{
 let close=()=>{};
 function init(){
  const nav=document.querySelector('main > .tabs');
  if(!nav||nav.querySelector('.desktop-nav-toggle'))return;
  const desktop=matchMedia('(min-width:1025px)');
  const toggle=document.createElement('button');
  toggle.type='button';toggle.className='desktop-nav-toggle ui-icon-button';
  toggle.setAttribute('aria-label','Разделы сайта');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','desktopNavigation');
  toggle.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  const panel=document.createElement('div');panel.id='desktopNavigation';panel.className='desktop-nav-panel';panel.hidden=true;
  const links=document.createElement('div');links.className='desktop-nav-scroll';
  const footer=document.createElement('div');footer.className='desktop-nav-footer';
  for(const node of [...nav.children]){
   (node.dataset.tab==='profile'||node.matches('[data-site-version]')?footer:links).append(node);
  }
  panel.append(links,footer);nav.append(toggle,panel);
  document.body.classList.add('has-desktop-navigation');
  let pinned=false,timer;
  close=(restore=false)=>{
   clearTimeout(timer);pinned=false;
   if(panel.hidden)return;
   panel.hidden=true;toggle.setAttribute('aria-expanded','false');
   if(restore)toggle.focus({preventScroll:true});
  };
  const fit=()=>{
   if(!panel.hidden)panel.style.maxHeight=Math.max(90,Math.min(580,innerHeight-toggle.getBoundingClientRect().bottom-18))+'px';
  };
  const show=()=>{
   if(!desktop.matches)return;
   clearTimeout(timer);
   panel.hidden=false;toggle.setAttribute('aria-expanded','true');
   fit();
  };
  toggle.addEventListener('pointermove',event=>{if(event.pointerType==='mouse'&&panel.hidden)show();});
  nav.addEventListener('pointerenter',()=>clearTimeout(timer));
  nav.addEventListener('pointerleave',()=>{
   if(!pinned&&!panel.contains(document.activeElement))timer=setTimeout(()=>close(),180);
  });
  toggle.addEventListener('click',()=>{
   if(pinned){close();return;}
   pinned=true;show();
  });
  toggle.addEventListener('keydown',event=>{
   if(event.key!=='ArrowDown')return;
   event.preventDefault();pinned=true;show();panel.querySelector('[data-tab]')?.focus();
  });
  panel.addEventListener('click',event=>{if(event.target.closest('[data-tab]'))close();});
  document.addEventListener('click',event=>{if(!nav.contains(event.target))close();});
  nav.addEventListener('focusout',event=>{if(event.relatedTarget&&!nav.contains(event.relatedTarget))close();});
  document.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&!event.defaultPrevented&&!panel.hidden){event.preventDefault();close(true);}
  });
  desktop.addEventListener('change',()=>close());
  window.addEventListener('resize',fit,{passive:true});
  window.addEventListener('scroll',fit,{passive:true});
 }
 return {init,close:()=>close()};
})();
