const LessonReminders=(()=>{
 const e=v=>escapeHtml(v??'');
 async function panel(root,group){
  root.innerHTML='<p class="hint">Проверяем напоминания…</p>';
  try{const [state,config]=await Promise.all([callFunction('getLessonReminder',{groupId:group.id}),PushSettings.load()]);if(!root.isConnected)return;
   const active=state.enabled&&config?.device?.lessons;
   root.innerHTML=`<div class="lesson-reminder-panel"><button type="button" class="secondary" data-reminder-toggle>${active?'Отключить напоминания о парах':'Напоминать за 5 минут'}<span class="experimental-mark">Эксперимент</span></button><p class="hint">${active?'Напоминания включены для этой группы. ':''}Функция нестабильна: администрация может не успеть обновить расписание. Всегда сверяйтесь с официальным расписанием.</p>${state.timedLessons===0?'<p class="hint">Время начала занятий ещё не заполнено. Пока его нет, напоминания не отправляются.</p>':`<p class="hint">Время указано для ${state.timedLessons} из ${state.totalLessons} занятий. Одно напоминание перед всей парой, в том числе если внутри неё есть перерыв.</p>`}</div>`;
   root.querySelector('[data-reminder-toggle]').onclick=async event=>{
    if(active){const b=event.currentTarget;b.disabled=true;try{await callFunction('setLessonReminder',{groupId:group.id,enabled:false});Portal.toast('Напоминания о парах отключены','','success');await panel(root,group);}catch(error){Portal.toast('Не удалось изменить напоминания',error.message,'danger');b.disabled=false;}return;}
    document.getElementById('lessonReminderDialog')?.remove();const dialog=document.createElement('dialog');dialog.id='lessonReminderDialog';dialog.className='subscription-dialog';dialog.setAttribute('aria-labelledby','reminderTitle');
    dialog.innerHTML=`<div class="dialog-heading"><h2 id="reminderTitle">Напоминания · ${e(group.name)}</h2>${ActionMenu.icon('close','Закрыть напоминания','data-reminder-close','ui-icon-button icon-close')}</div><div class="reminder-warning"><strong>Экспериментальная и нестабильная функция</strong><p>Уведомление приходит примерно за 5 минут до начала всей пары. Расписание может быть устаревшим: администрация может не успеть внести замену или отмену. Уведомление может оказаться неправильным, задержаться или не прийти.</p><p>Проверяйте официальное расписание и сообщения учебной части. Часы — по времени Кызыла.</p></div><form><label class="check-label"><input type="checkbox" data-reminder-consent>Я понимаю, что напоминания могут ошибаться</label><p data-reminder-status role="status"></p><button type="submit" class="primary" disabled>Включить для этой группы</button></form>`;document.body.append(dialog);dialog.querySelector('[data-reminder-close]').onclick=()=>dialog.close();
    const button=dialog.querySelector('[type="submit"]');dialog.querySelector('[data-reminder-consent]').onchange=event=>button.disabled=!event.target.checked;
    dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();if(button.disabled)return;button.disabled=true;
     try{await PushSettings.enableLessons(config);await callFunction('setLessonReminder',{groupId:group.id,enabled:true,acknowledged:true});dialog.close();Portal.toast('Напоминания включены','Они могут ошибаться — сверяйтесь с официальным расписанием.','success');if(root.isConnected)await panel(root,group);}catch(error){dialog.querySelector('[data-reminder-status]').textContent=error.message;button.disabled=false;}
    };dialog.showModal();
   };
  }catch{if(root.isConnected)root.innerHTML='<p class="hint">Настройка напоминаний сейчас недоступна. Обновите расписание при работающем интернете.</p>';}
 }
 return {panel};
})();
