(()=>{
 const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const days=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
 const schedules=AppConnection.savedSchedules(),select=document.getElementById('offlineGroup'),root=document.getElementById('offlineSchedule');
 select.innerHTML=schedules.map((item,i)=>`<option value="${i}">${e(item.value.group.name)}</option>`).join('');
 function render(){
  const item=schedules[Number(select.value)];if(!item){root.innerHTML='<p class="empty-state">Сохранённого расписания пока нет. Сначала откройте свою группу в кабинете при работающем интернете.</p>';return;}
  const {group,cells}=item.value;root.innerHTML=`<p class="cache-note stale">Копия от ${e(new Date(item.savedAt).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'}))}. Актуальность не подтверждена.</p><div class="schedule-week-grid">${days.slice(0,cells.some(c=>c.weekday===7)?7:6).map((day,d)=>`<section class="schedule-day-table"><h3>${day}</h3><table><caption class="schedule-sr-only">${day}, группа ${e(group.name)}</caption><thead><tr><th>№</th><th>Предмет · преподаватель · аудитория</th></tr></thead><tbody>${Array.from({length:group.lessons_per_day},(_,i)=>{const c=cells.find(c=>c.weekday===d+1&&c.lesson_number===i+1);return `<tr><th scope="row">${i+1}</th><td>${!c?'Не заполнено':c.status==='free'?'Нет пары':`<strong>${e(c.title)}</strong><p>${e(c.teacher_label)}</p>${c.room?`<p>Каб. ${e(c.room)}</p>`:''}${c.starts_at?`<p>${e(c.starts_at.slice(0,5))}–${e(c.ends_at.slice(0,5))}</p>`:''}${c.note?`<p>${e(c.note)}</p>`:''}`}</td></tr>`;}).join('')}</tbody></table></section>`).join('')}</div>`;
 }
 select.addEventListener('change',render);render();
})();
