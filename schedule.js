const Schedule = (() => {
  const days=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
  const e=value=>escapeHtml(value??'');
  let generation=0,current=null,pendingGroup=null;
  const key=actor=>'lms-schedule-group:'+actor.uid;
  function readGroup(actor){try{return AppConnection.draftStorage()?.getItem(key(actor))||'';}catch{return '';}}
  function remember(actor,id){try{AppConnection.draftStorage()?.setItem(key(actor),id);}catch{ /* Selection still works without storage. */ }}
  function week(){
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Krasnoyarsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    return Array.from({length:7},(_,i)=>new Date(date.getTime()+i*86400000).toISOString().slice(0,10));
  }
  const dateLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',timeZone:'UTC'});
  const input=(id,label,value='',extra='')=>`<label for="${id}">${label}<input id="${id}" value="${e(value)}" ${extra}></label>`;
  const button=(text,action,extra='',cls='secondary')=>`<button type="button" class="${cls}" data-schedule="${action}" ${extra}>${text}</button>`;
  function content(cell,admin){
    if(!cell)return `<span class="schedule-unfilled">Не заполнено${admin?'<small>Нажмите, чтобы заполнить</small>':''}</span><span class="schedule-room">—</span>`;
    if(cell.status==='free')return '<span class="schedule-free">Нет пары</span><span class="schedule-room">—</span>';
    return `<span class="schedule-lesson"><strong>${e(cell.title)}</strong>${cell.teacher_label?`<span class="schedule-teacher">${e(cell.teacher_label)}</span>`:''}${cell.starts_at?`<small>${e(ScheduleExport.timeLabel(cell.starts_at,cell.ends_at))}</small>`:''}${cell.note?`<small>${e(cell.note)}</small>`:''}</span><span class="schedule-room">${e(cell.room||'—')}</span>`;
  }
  function dayTable(day,ctx){
    const {group,cells,dates,actor}=ctx,admin=actor.role==='admin'&&!ctx.readOnly;
    return `<section class="schedule-day-table" id="schedule-day-${day}" aria-labelledby="schedule-day-title-${day}"><header><h3 id="schedule-day-title-${day}">${days[day-1]}</h3><span>${dateLabel(dates[day-1])}</span></header><table><caption class="schedule-sr-only">${days[day-1]}, группа ${e(group.name)}</caption><thead><tr><th scope="col">№</th><th scope="col" colspan="2"><span class="schedule-columns"><span>Предмет · преподаватель</span><span>Каб.</span></span></th></tr></thead><tbody>${Array.from({length:group.lessons_per_day},(_,i)=>{
      const number=i+1,cell=cells.find(c=>c.weekday===day&&c.lesson_number===number);
      const label=`${days[day-1]}, ${number} пара: ${cell?(cell.status==='free'?'Нет пары':cell.title):'Не заполнено'}`;
      return `<tr><th scope="row">${number}</th><td colspan="2">${admin?`<button class="schedule-cell" type="button" data-schedule="cell" data-day="${day}" data-number="${number}" aria-label="Изменить: ${e(label)}">${content(cell,true)}</button>`:`<div class="schedule-cell">${content(cell,false)}</div>`}</td></tr>`;
    }).join('')}</tbody></table></section>`;
  }
  async function render(root,actor,selected,fresh=false){
    const token=++generation;
    root.classList.add('weekly-schedule');
    root.innerHTML='<h2>Расписание</h2><p role="status">Загрузка групп…</p>';
    const groups=await callFunction('listScheduleGroups',{},undefined,{fresh});
    if(!root.isConnected||token!==generation)return;
    const requested=pendingGroup??(selected===undefined?readGroup(actor):selected);pendingGroup=null;
    const groupId=groups.some(g=>g.id===requested)?requested:'';
    const dates=week();
    const ctx={root,actor,groups,groupId,dates,cells:[],staff:[],subjects:[]};current=ctx;
    root.innerHTML=`<div class="schedule-heading"><div><h2>Расписание</h2><p class="section-lead">Выберите свою группу.</p></div>${ActionMenu.render(button('Скачать расписание группы · Excel','export-one',groupId?'':'disabled')+button('Скачать все группы · Excel','export-all')+(actor.role==='admin'?button('+ Добавить группу','add-group')+(groupId?button('Время пар группы','clocks','disabled')+button('Удалить группу','delete-group','disabled','danger-button'):''):''),'Действия с расписанием')}</div><div class="schedule-toolbar"><label for="scheduleGroupSelect">Группа<select id="scheduleGroupSelect"><option value="">Выберите группу</option>${groups.map(g=>`<option value="${e(g.id)}" ${g.id===groupId?'selected':''}>${e(g.name)}${g.course?' · '+e(g.course)+' курс':''}</option>`).join('')}</select></label><p>Неделя: <strong>${dateLabel(dates[0])} — ${dateLabel(dates[5])}</strong></p>${ActionMenu.icon('refresh','Обновить расписание','data-schedule="refresh"')}</div><p class="lite-links">Слабый интернет? <a href="lite/${groupId?'?group='+encodeURIComponent(groupId):''}" target="_blank" rel="noopener">Лёгкая версия ↗</a></p><div id="scheduleWeekBody" aria-live="polite">${groupId?'<p role="status">Загрузка расписания…</p>':'<p class="empty-state">Выберите группу, чтобы увидеть только её занятия.'+(groups.length?'':' Администратор может добавить первую группу.')+'</p>'}</div>`;
    if(!groupId)return;
    remember(actor,groupId);
    let data,legacy;
    try{[data,legacy]=await Promise.all([callFunction('getWeeklySchedule',{groupId},undefined,{fresh}),callFunction('listSchedule',{from:dates[0],to:dates[6],group:groups.find(g=>g.id===groupId).name},undefined,{fresh}).catch(()=>({rows:[],hasMore:false,failed:true}))]);}
    catch(error){if(error.code==='not-found'&&root.isConnected&&token===generation){remember(actor,'');await render(root,actor,'',true);Portal.toast('Группа больше не доступна','Выберите другое расписание.');return;}throw error;}
    if(!root.isConnected||token!==generation)return;
    Object.assign(ctx,data);ctx.readOnly=!AppConnection.online()||!!data._offline?.stale;
    const remove=root.querySelector('[data-schedule="delete-group"]');if(remove)remove.disabled=ctx.readOnly;const clocks=root.querySelector('[data-schedule="clocks"]');if(clocks)clocks.disabled=ctx.readOnly;
    const body=root.querySelector('#scheduleWeekBody');
    const sunday=data.cells.some(c=>c.weekday===7);
    body.innerHTML=`${AppConnection.note(groups,data,legacy)}${legacy.failed?'<p class="cache-note stale">Дополнительные занятия на эту неделю не удалось проверить. Повторите обновление при работающем интернете.</p>':''}<div class="schedule-group-heading"><div><h3>Группа ${e(data.group.name)}${data.group.course?' · '+e(data.group.course)+' курс':''}</h3>${data.group.program?`<p>${e(data.group.program)}</p>`:''}</div></div>${actor.role==='admin'?'<p class="schedule-tip">Нажмите на ячейку: укажите предмет или выберите «Нет пары». Изменения действуют каждую неделю и появляются в уведомлениях.</p>':''}<div class="schedule-subscriptions"></div><div class="schedule-week-grid">${Array.from({length:sunday?7:6},(_,i)=>dayTable(i+1,ctx)).join('')}</div>${actor.role==='admin'&&!sunday?`<details class="schedule-sunday"><summary>Воскресенье (при необходимости)</summary>${dayTable(7,ctx)}</details>`:''}<p class="schedule-legend">«Нет пары» — занятие не проводится. «Не заполнено» — расписание ещё не указано.</p>${legacy.rows.length?`<section class="schedule-legacy"><h3>Дополнительные занятия на эту неделю</h3><p>Ранее добавленные занятия с конкретной датой.</p>${legacy.rows.map(row=>`<article class="item"><strong>${e(row.title)}</strong><p>${dateLabel(row.lesson_date)} · ${e(row.starts_at.slice(0,5))}–${e(row.ends_at.slice(0,5))}${row.room?' · Каб. '+e(row.room):''}</p>${row.note?`<p>${e(row.note)}</p>`:''}</article>`).join('')}${legacy.hasMore?'<p>Показаны первые 500 занятий.</p>':''}</section>`:''}`;
    await Subscriptions.groupPanel(body.querySelector('.schedule-subscriptions'),data.group,data.cells);if(actor.role!=='guest'){const host=document.createElement('div');body.querySelector('.schedule-subscriptions').after(host);await LessonReminders.panel(host,data.group);}
  }
  function dialog(ctx,title,body){
    ctx.root.querySelector('dialog')?.remove();
    const node=document.createElement('dialog');node.className='schedule-dialog';
    node.setAttribute('aria-labelledby','scheduleDialogTitle');
    node.innerHTML=`<div class="dialog-heading"><h2 id="scheduleDialogTitle">${title}</h2>${ActionMenu.icon('close','Закрыть редактор расписания','data-schedule="close"','ui-icon-button icon-close')}</div>${body}<p class="schedule-error" role="alert" hidden></p>`;
    ctx.root.append(node);node.showModal();
    node.querySelector('input,select,textarea')?.focus();
    node.addEventListener('cancel',event=>{if(node.dataset.busy)event.preventDefault();});
    return node;
  }
  async function editCell(ctx,node){
    const weekday=Number(node.dataset.day),number=Number(node.dataset.number);
    const [staff,subjects]=await Promise.all([callFunction('listTeachers'),callFunction('listSubjects')]);
    if(!ctx.root.isConnected||current!==ctx)return;
    ctx.staff=staff;ctx.subjects=subjects;
    const cell=ctx.cells.find(c=>c.weekday===weekday&&c.lesson_number===number);
    ctx.editing={weekday,number,cell};
    const modal=dialog(ctx,`${days[weekday-1]} · ${number} пара`,
      `<p>Группа ${e(ctx.group.name)} · каждую неделю</p><form data-schedule-form="cell"><fieldset><legend class="schedule-sr-only">Ячейка расписания</legend><div class="schedule-status-choice"><label><input type="radio" name="scheduleStatus" value="lesson" ${cell?.status!=='free'?'checked':''}> Занятие</label><label><input type="radio" name="scheduleStatus" value="free" ${cell?.status==='free'?'checked':''}> Нет пары</label></div><div id="scheduleLessonFields" class="schedule-fields">${input('scheduleTitle','Предмет',cell?.title,'list="scheduleSubjects" maxlength="200" required placeholder="Выберите или впишите предмет"')}<datalist id="scheduleSubjects">${subjects.map(s=>`<option value="${e(s.title)}"></option>`).join('')}</datalist>${input('scheduleTeacher','Преподаватель',cell?.teacher_label,'list="scheduleTeachers" maxlength="800" placeholder="ФИО или инициалы"')}<datalist id="scheduleTeachers">${staff.map(t=>`<option value="${e(t.name)}"></option>`).join('')}</datalist>${input('scheduleRoom','Аудитория',cell?.room,'maxlength="100" placeholder="Например, 20"')}<details><summary>Время и примечание (необязательно)</summary><p class="hint">Оставьте время пустым, чтобы использовать часы группы. Заполненное время переопределяет его для этой ячейки.</p><div class="schedule-time-fields">${input('scheduleStart','Начало',cell?.custom_starts_at?.slice(0,5),'type="time"')}${input('scheduleEnd','Окончание',cell?.custom_ends_at?.slice(0,5),'type="time"')}</div><label for="scheduleNote">Примечание<textarea id="scheduleNote" maxlength="1000">${e(cell?.note)}</textarea></label></details></div><div class="actions"><button class="primary" type="submit">Сохранить</button></div></fieldset></form>`);
    updateStatus(modal);
  }
  function updateStatus(modal){
    const free=modal.querySelector('[name="scheduleStatus"]:checked')?.value==='free';
    modal.querySelector('#scheduleLessonFields').hidden=free;
    modal.querySelectorAll('#scheduleLessonFields input,#scheduleLessonFields textarea').forEach(input=>input.disabled=free);
  }
  async function submit(ctx,form){
    const modal=form.closest('dialog'),get=id=>modal.querySelector('#'+id).value.trim();
    if(form.dataset.scheduleForm==='clocks'){
      const times=[...form.querySelectorAll('[data-clock-slot]')].map(row=>({lessonNumber:Number(row.dataset.clockSlot),startsAt:row.querySelector('[data-clock-start]').value,endsAt:row.querySelector('[data-clock-end]').value})).filter(t=>t.startsAt||t.endsAt);
      await callFunction('saveGroupLessonTimes',{groupId:ctx.groupId,revision:ctx.group.revision,times});modal.close();await render(ctx.root,ctx.actor,ctx.groupId,true);Portal.toast('Время пар сохранено','','success');return;
    }
    if(form.dataset.scheduleForm==='delete-group'){

      const name=get('deleteGroupName');if(name!==ctx.group.name)throw new Error('Введите название выбранной группы без изменений.');
      await callFunction('deleteScheduleGroup',{groupId:ctx.groupId,revision:ctx.group.revision,name});remember(ctx.actor,'');modal.close();await render(ctx.root,ctx.actor,'',true);Portal.toast('Группа удалена',name,'success');return;
    }
    if(form.dataset.scheduleForm==='group'){
      const group=await callFunction('createScheduleGroup',{name:get('scheduleGroupName'),course:get('scheduleCourse'),program:get('scheduleProgram'),lessonsPerDay:Number(get('scheduleSlots'))});
      modal.close();await render(ctx.root,ctx.actor,group.id);Portal.toast('Группа добавлена','','success');return;
    }
    const {weekday,number,cell}=ctx.editing,status=modal.querySelector('[name="scheduleStatus"]:checked').value;
    const data={groupId:ctx.groupId,weekday,lessonNumber:number,id:cell?.id??null,revision:cell?.revision??0,status};
    if(status==='lesson'){
      Object.assign(data,{title:get('scheduleTitle'),teacherLabel:get('scheduleTeacher'),room:get('scheduleRoom'),note:get('scheduleNote'),startsAt:get('scheduleStart')||null,endsAt:get('scheduleEnd')||null});
      data.subjectId=ctx.subjects.find(s=>s.title===data.title)?.id??null;
      const matches=ctx.staff.filter(t=>t.name===data.teacherLabel);
      data.teacherId=matches.length===1?matches[0].id:null;
    }
    await callFunction('saveScheduleCell',data);
    modal.close();await render(ctx.root,ctx.actor,ctx.groupId);
    ctx.root.querySelector(`[data-day="${weekday}"][data-number="${number}"]`)?.focus({preventScroll:true});
    Portal.toast('Расписание сохранено',`${days[weekday-1]}, ${number} пара: ${status==='free'?'Нет пары':data.title}.`,'success');
  }
  document.addEventListener('change',event=>{
    const ctx=current;if(!ctx?.root.isConnected||!ctx.root.contains(event.target))return;
    if(event.target.id==='scheduleGroupSelect'){
      remember(ctx.actor,event.target.value);
      render(ctx.root,ctx.actor,event.target.value).catch(error=>Portal.toast('Не удалось загрузить расписание',error.message,'danger'));
    }
    if(event.target.name==='scheduleStatus')updateStatus(event.target.closest('dialog'));
  });
  document.addEventListener('click',async event=>{
    const node=event.target.closest('[data-schedule]'),ctx=current;
    if(!node||node.disabled||!ctx?.root.isConnected||!ctx.root.contains(node))return;
    if(ctx.actor.role!=='admin'&&!['refresh','export-one','export-all'].includes(node.dataset.schedule))return;
    node.disabled=true;
    try{
      if(['export-one','export-all'].includes(node.dataset.schedule)){const data=await callFunction('exportSchedule',{groupId:node.dataset.schedule==='export-one'?ctx.groupId:null,week:ctx.dates[0]},undefined,{fresh:true});if(data._offline?.stale)throw Error('Для актуальной выгрузки нужен интернет.');ScheduleExport.download(data);return;}
      if(node.dataset.schedule==='clocks'&&!ctx.readOnly&&ctx.group){
        const rows=await callFunction('getGroupLessonTimes',{groupId:ctx.groupId});if(current!==ctx||!ctx.root.isConnected)return;
        dialog(ctx,'Время пар · '+e(ctx.group.name),`<p>Укажите начало и окончание всей пары. Внутри пары — два урока по 45 минут и перерыв 5 минут. Отдельное время, указанное в ячейке, имеет приоритет.</p><form data-schedule-form="clocks"><fieldset>${Array.from({length:ctx.group.lessons_per_day},(_,i)=>{const time=rows.find(r=>r.lesson_number===i+1);return `<div class="clock-row" data-clock-slot="${i+1}"><strong>${i+1}</strong><label>Начало<input type="time" data-clock-start value="${e(time?.starts_at?.slice(0,5)||'')}"></label><label>Конец<input type="time" data-clock-end value="${e(time?.ends_at?.slice(0,5)||'')}"></label></div>`;}).join('')}<p class="hint">Оставьте оба поля пустыми, если время пока неизвестно. Напоминаний для таких пар не будет.</p><button type="submit" class="primary">Сохранить время пар</button></fieldset></form>`);return;
      }
      if(node.dataset.schedule==='refresh')await render(ctx.root,ctx.actor,ctx.groupId,true);
      if(node.dataset.schedule==='cell')await editCell(ctx,node);
      if(node.dataset.schedule==='close'&&!node.closest('dialog').dataset.busy)node.closest('dialog').close();
      if(node.dataset.schedule==='reload'){node.closest('dialog').close();await render(ctx.root,ctx.actor,ctx.groupId);}
      if(node.dataset.schedule==='delete-group'&&!ctx.readOnly&&ctx.group)dialog(ctx,'Удалить группу '+e(ctx.group.name)+'?',`<p>Будут удалены недельное расписание, дополнительные занятия этой группы и подписки на неё. Аккаунты, предметы и результаты тестов сохранятся.</p><form data-schedule-form="delete-group"><fieldset>${input('deleteGroupName','Введите название группы для подтверждения','','required autocomplete="off"')}<div class="actions"><button type="submit" class="danger-button">Удалить группу</button></div></fieldset></form>`);
      if(node.dataset.schedule==='add-group')dialog(ctx,'Добавить группу',`<form data-schedule-form="group"><fieldset><legend class="schedule-sr-only">Новая группа</legend><div class="schedule-fields">${input('scheduleGroupName','Номер / название группы','','required maxlength="100" placeholder="Например, 9241"')}${input('scheduleCourse','Курс','','maxlength="40" placeholder="Например, 4"')}${input('scheduleProgram','Специальность','','maxlength="200"')}${input('scheduleSlots','Пар в день','6','type="number" min="1" max="12" required')}</div><div class="actions"><button class="primary" type="submit">Добавить группу</button></div></fieldset></form>`);
    }catch(error){Portal.toast('Не удалось открыть редактор',error.message,'danger');}finally{node.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-schedule-form]'),ctx=current;if(!form||!ctx?.root.contains(form))return;
    event.preventDefault();const modal=form.closest('dialog');if(modal.dataset.busy)return;
    modal.dataset.busy='true';const fields=form.querySelector('fieldset');
    // Read radio values before disabling the fieldset; individual input values remain available.
    fields.disabled=true;const close=modal.querySelector('[data-schedule="close"]');close.disabled=true;const errorNode=modal.querySelector('.schedule-error');errorNode.hidden=true;
    try{await submit(ctx,form);}catch(error){
      errorNode.textContent=error.message;errorNode.hidden=false;
      if(error.code==='conflict'&&!modal.querySelector('[data-schedule="reload"]'))errorNode.insertAdjacentHTML('afterend',button('Обновить расписание','reload','title="Закрыть редактор и загрузить актуальные данные"'));
    }finally{fields.disabled=false;close.disabled=false;delete modal.dataset.busy;}
  });
  document.addEventListener('lms-reference-updated',event=>{const ctx=current;if(ctx?.root.isConnected&&ctx.readOnly&&!ctx.root.querySelector('dialog[open]')&&event.detail.action==='getWeeklySchedule'&&event.detail.data?.groupId===ctx.groupId)render(ctx.root,ctx.actor,ctx.groupId).catch(()=>{});});
  return {render,selectGroup:id=>{pendingGroup=id;}};
})();
