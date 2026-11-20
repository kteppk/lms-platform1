const OnlineHistory=(()=>{
 const e=v=>escapeHtml(v??''),ranges={'60m':'60 минут','7h':'7 часов','24h':'24 часа','3d':'3 дня','7d':'7 дней'},states=new WeakMap();let active=null,selectedRange='60m';
 const date=value=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Krasnoyarsk',dateStyle:'short',timeStyle:'short'}).format(new Date(value));
 function plot(root,data){
  const points=data.points,box=root.querySelector('[data-history-plot]');if(!box)return;
  const width=Math.max(260,Math.floor(box.clientWidth||600)),height=230,left=38,right=14,top=18,bottom=43,plotWidth=width-left-right,plotHeight=height-top-bottom;
  const known=points.filter(p=>p.accounts!==null),peak=known.length?Math.max(...known.map(p=>p.accounts)):null,guestPeak=known.length?Math.max(...known.map(p=>p.guestConnections)):null;
  root.querySelector('[data-history-summary]').innerHTML=known.length?`<span>Максимум аккаунтов: <strong>${peak}</strong></span><span>Максимум гостевых подключений: <strong>${guestPeak}</strong></span>`:'<span>За этот период ещё нет сохранённых измерений.</span>';
  root.querySelector('[data-history-note]').textContent=`Пиковые значения за ${data.stepMinutes===1?'каждую минуту':data.stepMinutes+' мин.'}. Время Кызыла. ${data.collectionStartedAt?'Сбор данных начат '+date(data.collectionStartedAt)+'. ':''}Пустые участки означают отсутствие измерений. Гости считаются по подключениям.`;
  const max=Math.max(1,Math.ceil(Math.max(peak||0,guestPeak||0)*1.15)),x=i=>left+(points.length>1?i/(points.length-1):.5)*plotWidth,y=n=>top+plotHeight-(n/max)*plotHeight;
  const grid=[0,Math.ceil(max/2),max].filter((v,i,a)=>a.indexOf(v)===i).map(v=>`<line x1="${left}" y1="${y(v)}" x2="${width-right}" y2="${y(v)}" class="history-grid"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${v}</text>`).join('');
  const ticks=width<500?3:5;let labels='';for(let i=0;i<ticks;i++){const index=Math.round(i*(points.length-1)/(ticks-1)),p=points[index];if(!p)continue;const long=['3d','7d'].includes(data.range),value=new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Krasnoyarsk',...(long?{day:'numeric',month:'short'}:{hour:'2-digit',minute:'2-digit'})}).format(new Date(p.at));labels+=`<text x="${x(index)}" y="${height-15}" text-anchor="${i===0?'start':i===ticks-1?'end':'middle'}">${e(value)}</text>`;}
  const series=key=>{let drawing=false,path='';points.forEach((p,i)=>{if(p[key]===null){drawing=false;return;}path+=(drawing?'L':'M')+x(i).toFixed(2)+' '+y(p[key]).toFixed(2)+' ';drawing=true;});return path;};
  box.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" tabindex="0" aria-label="График онлайна за ${e(ranges[data.range])}. Стрелки влево и вправо — выбрать время; данные также доступны таблицей."><title>Онлайн за ${e(ranges[data.range])}</title>${grid}${labels}<path d="${series('accounts')}" class="history-accounts"/><path d="${series('guestConnections')}" class="history-guests"/>${known.length<=2?points.map((p,i)=>p.accounts===null?'':`<circle cx="${x(i)}" cy="${y(p.accounts)}" r="3" class="history-dot"/>`).join(''):''}<line data-history-crosshair x1="0" x2="0" y1="${top}" y2="${height-bottom}" class="history-crosshair" visibility="hidden"/><circle data-history-marker r="4" class="history-dot" visibility="hidden"/></svg>`;
  const svg=box.querySelector('svg'),tooltip=root.querySelector('[data-history-tooltip]');let selected=Math.max(0,points.length-1);
  function select(index){selected=Math.max(0,Math.min(points.length-1,index));const p=points[selected];if(!p)return;
   tooltip.textContent=date(p.at)+(p.accounts===null?' — нет измерений':` · Аккаунты: ${p.accounts} · Гостевые подключения: ${p.guestConnections}`);
   const line=svg.querySelector('[data-history-crosshair]'),dot=svg.querySelector('[data-history-marker]');line.setAttribute('x1',x(selected));line.setAttribute('x2',x(selected));line.setAttribute('visibility','visible');dot.setAttribute('visibility',p.accounts===null?'hidden':'visible');if(p.accounts!==null){dot.setAttribute('cx',x(selected));dot.setAttribute('cy',y(p.accounts));}
  }
  svg.onpointermove=event=>{const r=svg.getBoundingClientRect();select(Math.round(((event.clientX-r.left)/r.width*width-left)/plotWidth*(points.length-1)));};svg.onpointerdown=svg.onpointermove;
  svg.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();select(event.key==='Home'?0:event.key==='End'?points.length-1:selected+(event.key==='ArrowLeft'?-1:1));}};
  const table=root.querySelector('[data-history-table]');table.innerHTML=`<div class="table-wrap"><table><caption>Пиковый онлайн за ${e(ranges[data.range])}</caption><thead><tr><th>Время</th><th>Аккаунты</th><th>Гостевые подключения</th></tr></thead><tbody>${points.map(p=>`<tr><td>${e(date(p.at))}</td><td>${p.accounts===null?'Нет данных':p.accounts}</td><td>${p.guestConnections===null?'Нет данных':p.guestConnections}</td></tr>`).join('')}</tbody></table></div>`;
  if(!tooltip.textContent)tooltip.textContent='Наведите на график или коснитесь его, чтобы посмотреть значения.';
 }
 async function refresh(root=active,force=false){
  const state=states.get(root);if(!root?.isConnected||!state||document.hidden)return;
  if(state.busy){state.queued=true;return;}if(!force&&Date.now()-state.checkedAt<5000)return;state.busy=true;const range=state.range,epoch=++state.epoch;
  root.querySelector('[data-history-status]').textContent=state.data?'Обновляем…':'Загрузка истории…';
  try{const response=await callFunction('getOnlineStats',{historyRange:range},undefined,{fresh:true});if(!root.isConnected||state.epoch!==epoch||state.range!==range)return;
   state.data=response.history;state.checkedAt=Date.now();plot(root,state.data);root.querySelector('[data-history-status]').textContent='Обновлено '+date(state.data.to);
  }catch(error){if(root.isConnected&&state.epoch===epoch)root.querySelector('[data-history-status]').textContent='Не удалось обновить график. '+(state.data?'Показаны ранее загруженные данные.':'Повторим при восстановлении связи.');}
  finally{state.busy=false;if(state.queued&&root.isConnected){state.queued=false;queueMicrotask(()=>refresh(root,true));}}
 }
 function render(root){
  active=root;const state={range:selectedRange,data:null,checkedAt:0,busy:false,queued:false,epoch:0};states.set(root,state);
  root.innerHTML=`<div class="history-heading"><h3>История онлайна</h3><label>Период<select data-history-range aria-label="Период графика активности">${Object.entries(ranges).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label></div><div class="history-legend"><span><i class="accounts-key"></i>Аккаунты</span><span><i class="guests-key"></i>Гостевые подключения</span></div><div data-history-summary class="history-summary"></div><div class="history-plot" data-history-plot></div><p class="history-tooltip" data-history-tooltip aria-live="polite"></p><p class="hint" data-history-note></p><p class="history-status" data-history-status role="status"></p><details class="history-data"><summary>Данные таблицей</summary><div data-history-table></div></details>`;
  root.querySelector('select').value=state.range;
  root.querySelector('select').onchange=event=>{state.range=event.target.value;selectedRange=state.range;state.epoch++;state.data=null;for(const key of ['plot','summary','tooltip','table','note'])root.querySelector('[data-history-'+key+']').replaceChildren();refresh(root,true);};
  if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>{if(!root.isConnected){observer.disconnect();return;}if(state.data)plot(root,state.data);});observer.observe(root.querySelector('[data-history-plot]'));}
  refresh(root,true);
 }
 document.addEventListener('lms-live-update',event=>{if(event.detail.topics.some(t=>['activity','resync'].includes(t)))refresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(undefined,true);});window.addEventListener('online',()=>refresh(undefined,true));setInterval(()=>refresh(),30000);
 return {render,refresh};
})();
