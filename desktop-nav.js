const DesktopNavigation=(()=>{
 let initialized=false;
 function init(){
  if(initialized)return;const nav=document.querySelector('main > .tabs');if(!nav)return;initialized=true;
  const scroll=document.createElement('div');scroll.className='desktop-nav-scroll';const footer=document.createElement('div');footer.className='desktop-nav-footer';
  for(const node of [...nav.children]){if(node.dataset.tab==='profile'||node.matches('[data-site-version]'))footer.append(node);else scroll.append(node);}nav.append(scroll,footer);
  let queued=false;const measure=()=>{queued=false;if(matchMedia('(min-width:1025px)').matches)nav.style.setProperty('--nav-top',Math.max(16,nav.getBoundingClientRect().top)+'px');};
  const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(measure);}};window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});measure();
 }
 return {init};
})();
