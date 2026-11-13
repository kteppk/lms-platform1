const Gradebook = (() => {
  let state,pendingTest=null;
  const memory=new Map(),e=value=>escapeHtml(value??'');
  const date=value=>ResultsExport.date(value);
  const status=row=>row.status==='pending_review'?'Ожидает проверки':`${row.score} из ${row.total} (${row.percentage}%)`;
  const button=(label,action,extra='',cls='secondary')=>`<button type="button" class="${cls}" data-grade="${action}" ${extra}>${label}</button>`;
  const percent=row=>row.status==='graded'&&row.total>0?(row.score*100/row.total).toLocaleString('ru-RU',{maximumFractionDigits:2})+'%':'—';
  const alive=current=>state===current&&current.root.isConnected;
  const showError=error=>{showStatus(error.message);if(typeof Portal!=='undefined')Portal.toast('Не удалось выполнить действие',error.message,'danger');};
  async function render(root,teacher){
    root.innerHTML='<section class="test-results-page"></section>';root=root.firstElementChild;
    const key=auth.currentUser.uid+':'+teacher,old=memory.get(key);
    const current={root,teacher,key,offset:0,filters:{testId:pendingTest||old?.testId||'',mode:old?.mode||(teacher?'latest':'all'),sort:old?.sort||(teacher?'name':'date'),status:'',studentName:''},token:{}};
    pendingTest=null;state=current;
    root.innerHTML=`<h2>${teacher?'Результаты тестов':'Мои результаты'}</h2><p role="status">Загрузка тестов…</p>`;
    try{
      current.catalog=await callFunction('listResultTests');if(!alive(current))return;
      if(!current.catalog.some(t=>t.id===current.filters.testId))current.filters.testId=current.catalog.length===1?current.catalog[0].id:'';
      await draw(current);
    }catch(error){if(alive(current)){root.innerHTML=`<h2>Результаты тестов</h2><p role="alert">${e(error.message)}</p>${button('Повторить','retry')}`;}throw error;}
  }
  async function draw(current){
    if(!alive(current))return;
    current.token={};
    const f=current.filters;
    current.root.innerHTML=`<h2>${current.teacher?'Результаты тестов':'Мои результаты'}</h2><p class="results-intro">${current.teacher?'Выберите тест, проверьте ответы и перенесите оценки в бумажный журнал.':'Выберите тест, чтобы увидеть свои результаты и все попытки.'}</p>
      <form id="gradeFilters" class="results-filters" data-grade-form="filter"><label class="results-test-label" for="resultTestSelect">Тест<select id="resultTestSelect" name="testId"><option value="">Выберите тест</option>${current.catalog.map(t=>`<option value="${e(t.id)}" ${t.id===f.testId?'selected':''}>${e(t.title)}${t.state==='archived'?' · В архиве':t.state==='retained'?' · Сохранённые результаты':''} · попыток: ${t.attempts}</option>`).join('')}</select></label>
      ${current.teacher?`<label for="resultStudentSearch">ФИО студента<input id="resultStudentSearch" name="studentName" maxlength="120" value="${e(f.studentName)}" placeholder="Поиск по ФИО"></label>`:''}
      <label for="resultMode">Попытки<select id="resultMode" name="mode"><option value="latest" ${f.mode==='latest'?'selected':''}>Последняя у каждого</option><option value="all" ${f.mode==='all'?'selected':''}>Все попытки</option></select></label>
      <label for="resultStatus">Статус<select id="resultStatus" name="status"><option value="">Все</option><option value="pending_review" ${f.status==='pending_review'?'selected':''}>Ожидает проверки</option><option value="graded" ${f.status==='graded'?'selected':''}>Проверено</option></select></label>
      <label for="resultSort">Сортировка<select id="resultSort" name="sort">${(current.teacher?[['name','По ФИО'],['date','Сначала новые'],['score','По результату']]:[['date','Сначала новые'],['score','По результату']]).map(([v,t])=>`<option value="${v}" ${v===f.sort?'selected':''}>${t}</option>`).join('')}</select></label><button class="primary" type="submit">Показать</button></form>
      <div id="gradeRows" aria-live="polite">${f.testId?'<p role="status">Загрузка результатов…</p>':`<p class="empty-state">${current.catalog.length?'Выберите один тест из списка.':current.teacher?'Создайте тест в разделе «Тесты».':'Здесь появятся завершённые попытки, в том числе ожидающие ручной проверки.'}</p>`}</div>`;
    if(f.testId)await load(current);
  }
  async function load(current=state){
    if(!alive(current)||!current.filters.testId)return;
    const token=current.token={};
    memory.set(current.key,{testId:current.filters.testId,mode:current.filters.mode,sort:current.filters.sort});
    const data=await callFunction('getTestResults',{...current.filters,offset:current.offset});
    if(!alive(current)||current.token!==token)return;
    current.data=data;
    const target=current.root.querySelector('#gradeRows');if(!target)return;
    const scale=data.scale,teacher=current.teacher;
    target.innerHTML=`<div class="results-heading"><h3 id="resultsHeading">${e(data.test.title)}</h3>${button('Обновить','refresh')}</div>
      ${current.filters.studentId?`<p class="results-history-scope">История: ${e(current.historyName)} ${button('Все студенты','clear-history')}</p>`:''}
      <p class="results-summary">Студентов: <strong>${data.summary.students}</strong> · Попыток в списке: <strong>${data.summary.rows}</strong> · Ожидают проверки: <strong>${data.summary.pending}</strong></p>
      <p class="results-scale">${e(ResultsExport.scaleLabel(scale))}</p>
      ${teacher&&data.test.canSetScale?`<details id="resultScaleEditor"><summary>${scale?'Изменить шкалу 2–5':'Настроить шкалу 2–5'}</summary><p>Укажите минимальные проценты для оценок. Изменение пересчитает оценки всех попыток этого теста. Баллы и ручные проверки сохранятся.</p><form data-grade-form="scale" class="results-scale-form">${[['Three',3,scale?.min_three,50],['Four',4,scale?.min_four,70],['Five',5,scale?.min_five,85]].map(([id,mark,value,sample])=>`<label for="scale${id}">Оценка ${mark}, от %<input id="scale${id}" type="number" min="0" max="100" step="1" required value="${value??''}" placeholder="Например, ${sample}"></label>`).join('')}<button class="primary" type="submit">Сохранить шкалу</button></form></details>`:''}
      ${teacher?`<div class="results-export-actions">${button('Скачать Excel (.xlsx)','excel',data.summary.rows?'':'disabled','primary')}${button('Печать','print',data.summary.rows?'':'disabled')}</div><p class="results-caption">Выгрузка и печать включают весь список с выбранными фильтрами, а не только эту страницу. Время — Кызыл (UTC+7).</p>`:'<p class="results-caption">Время — Кызыл (UTC+7). Непроверенные ответы не получают итоговую оценку.</p>'}
      <div class="results-table-scroll" tabindex="0" role="region" aria-label="Таблица результатов"><table class="results-table"><caption class="results-sr-only">${e(data.test.title)} — ${teacher?'результаты студентов':'мои попытки'}</caption><thead><tr>${teacher?'<th scope="col">ФИО студента</th>':''}<th scope="col">Попытка</th><th scope="col">Баллы</th><th scope="col">Процент</th><th scope="col">Оценка</th><th scope="col">Статус</th><th scope="col">Сдано</th><th scope="col">Ответы</th></tr></thead><tbody>${data.rows.map(row=>`<tr data-result-id="${e(row.id)}">${teacher?`<th scope="row">${e(row.student_name)}</th>`:''}<${teacher?'td':'th scope="row"'} data-label="Попытка">${row.attempt_number} из ${row.attempt_count}</${teacher?'td':'th'}><td data-label="Баллы">${row.status==='graded'?`${row.score} / ${row.total}`:'—'}</td><td data-label="Процент">${percent(row)}</td><td data-label="Оценка" class="result-mark">${row.mark??'—'}</td><td data-label="Статус"><span class="result-state ${row.status==='pending_review'?'pending':''}">${row.status==='pending_review'?'Ожидает проверки':'Проверено'}</span></td><td data-label="Сдано">${e(date(row.submitted_at))}</td><td data-label="Ответы"><div class="results-row-actions">${button(teacher?(row.status==='pending_review'?'Проверить':'Открыть работу'):'Посмотреть','open',`data-id="${e(row.id)}"`)}${teacher?button('История','history',`data-id="${e(row.id)}"`):''}</div></td></tr>`).join('')||`<tr><td colspan="${teacher?8:7}" class="results-empty">${data.summary.rows?'Нет записей на этой странице.':'Попыток с такими фильтрами нет.'}</td></tr>`}</tbody></table></div>
      <div class="results-pagination">${button('← Назад','prev',current.offset?'':'disabled')}<span>Страница ${current.offset/50+1}</span>${button('Далее →','next',data.hasMore?'':'disabled')}</div>`;
  }
  function readFilters(current){
    const form=current.root.querySelector('#gradeFilters'),values=Object.fromEntries(new FormData(form));
    if(values.testId!==current.filters.testId){delete current.filters.studentId;current.historyName='';}
    current.filters={...current.filters,...values};current.offset=0;
  }
  async function open(node){
    const current=state,token=current.token={};node.disabled=true;showStatus('');
    try{
      const row=await callFunction('getResult',{resultId:node.dataset.id});if(!alive(current)||current.token!==token)return;current.result=row;
      current.root.innerHTML=`${button('← К результатам','back')}<h2 class="subject-section">${e(row.title)}</h2><p>${e(current.teacher?row.studentName:row.teacherName)}</p><p class="grade-status">${e(status(row))}</p><p>Сдано: ${e(date(row.submittedAt))}</p><form id="reviewForm" data-grade-form="review">
      ${row.questions.map((q,i)=>{
        const answer=q.type==='photo'?(q.photoUrl?`${materialLink(q.photoUrl,'Открыть фотоответ')}<img class="review-photo" src="${e(safeMaterialUrl(q.photoUrl))}" alt="Фотоответ на вопрос ${i+1}">`:'Фото не приложено'):
          e(q.type==='choice'?(q.options[q.answer]??'Нет ответа'):(q.answer||'Нет ответа'));
        return `<section class="item subject-section"><h3>${i+1}. ${e(q.text)}</h3><div class="review-answer">${answer}</div>${q.type==='choice'&&current.teacher?`<p>Правильный вариант: ${e(q.options[q.correct])}</p>`:''}${q.type!=='choice'&&current.teacher?`<label>Баллы (максимум 1)<select class="manual-score" data-index="${i}" required><option value="">Выберите оценку</option><option value="0" ${q.score===0?'selected':''}>0 — не зачтено</option><option value="1" ${q.score===1?'selected':''}>1 — зачтено</option></select></label>`:`<p>Баллы: ${q.score===null?'ожидает проверки':e(q.score)+' / 1'}</p>`}</section>`;
      }).join('')||'<p>Версия вопросов для старого результата не сохранилась.</p>'}
      ${current.teacher&&row.questions.some(q=>q.type!=='choice')?`<label for="reviewFeedback">Комментарий преподавателя</label><textarea id="reviewFeedback" maxlength="5000">${e(row.feedback)}</textarea><button class="primary" type="submit">Сохранить проверку</button>`:`<p class="review-answer">${e(row.feedback||'Комментариев пока нет.')}</p>`}</form>
      ${row.gradedAt?`<p class="meta">Проверено: ${e(date(row.gradedAt))}</p>`:''}${current.teacher&&row.reviews.length?`<details><summary>История проверок</summary>${row.reviews.map(r=>`<p>${e(date(r.reviewed_at))}: ${r.score} / ${row.total} — ${e(r.feedback)}</p>`).join('')}</details>`:''}`;
    }finally{node.disabled=false;}
  }
  async function exportRows(current,kind){
    const filters={...current.filters},token=current.token;
    const data=await callFunction('exportTestResults',filters);
    if(!alive(current)||current.token!==token)throw new Error('Список изменился. Повторите выгрузку с текущими фильтрами.');
    if(!data.rows.length)throw new Error('В выбранном списке нет результатов.');
    if(kind==='excel')ResultsExport.download(data,filters);else await ResultsExport.print(data,filters);
  }
  async function action(name,node){
    const current=state;
    if(name==='retry')return render(current.root,current.teacher);
    if(name==='open')return open(node);
    if(name==='back')return draw(current);
    if(name==='refresh')return load(current);
    if(name==='prev'||name==='next'){current.offset=Math.max(0,current.offset+(name==='next'?50:-50));return load(current);}
    if(name==='history'){
      const row=current.data.rows.find(r=>r.id===node.dataset.id);if(!row)return;
      current.filters={...current.filters,studentId:row.student_id,studentName:'',mode:'all',status:''};current.historyName=row.student_name;current.offset=0;return draw(current);
    }
    if(name==='clear-history'){delete current.filters.studentId;current.offset=0;return draw(current);}
    if(name==='excel'||name==='print')return exportRows(current,name);
  }
  document.addEventListener('change',event=>{
    if(event.target.id!=='resultTestSelect'||!state?.root.contains(event.target))return;
    readFilters(state);draw(state).catch(showError);
  });
  document.addEventListener('click',async event=>{
    const node=event.target.closest('[data-grade]');if(!node||node.disabled||!state?.root.contains(node))return;
    node.disabled=true;try{await action(node.dataset.grade,node);}catch(error){showError(error);}finally{node.disabled=false;}
  });
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-grade-form]');if(!form||!state?.root.contains(form))return;
    event.preventDefault();const node=form.querySelector('[type="submit"]');if(node.disabled)return;node.disabled=true;showStatus('');
    const current=state;
    try{
      if(form.dataset.gradeForm==='filter'){readFilters(current);await draw(current);}
      if(form.dataset.gradeForm==='scale'){
        await callFunction('saveTestGradingScale',{testId:current.filters.testId,revision:current.data.scale?.revision??-1,
          minThree:Number(form.querySelector('#scaleThree').value),minFour:Number(form.querySelector('#scaleFour').value),minFive:Number(form.querySelector('#scaleFive').value)});
        if(alive(current)&&form.isConnected){await load(current);Portal.toast('Шкала сохранена','Оценки пересчитаны.','success');}
      }
      if(form.dataset.gradeForm==='review'){
        const grades=Object.fromEntries([...form.querySelectorAll('.manual-score')].map(el=>[el.dataset.index,Number(el.value)]));
        await callFunction('reviewResult',{resultId:current.result.id,revision:current.result.reviewRevision,grades,feedback:form.querySelector('#reviewFeedback').value});
        if(alive(current)&&form.isConnected){await draw(current);Portal.toast('Проверка сохранена','','success');}
      }
    }catch(error){showError(error);}finally{node.disabled=false;}
  });
  function openTest(id){pendingTest=id;document.querySelector('.tabs [data-tab="journal"]')?.click();}
  return {render,openTest};
})();
