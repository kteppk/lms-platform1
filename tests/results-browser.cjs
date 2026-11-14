const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// All input accounts are isolated fixtures; the caller owns cleanup.
module.exports=async({teacher,student,other,student2,stamp,outputDir})=>{
  const rpc=(page,action,data={})=>page.evaluate(([a,d])=>callFunction(a,d).then(data=>({data}),e=>({code:e.code,message:e.message})),[action,data]);
  const nav=async(page,tab)=>page.evaluate(tab=>document.querySelector('.tabs [data-tab="'+tab+'"]').click(),tab);
  const title='Результаты <тест> & проверка '+stamp;
  const created=await rpc(teacher,'createTest',{title,timer:0,questions:[{type:'choice',text:'Выберите ответ',options:['Верно','Неверно','Третий','Четвёртый'],correct:0}]});assert.ok(created.data?.id,JSON.stringify(created));
  const testId=created.data.id;
  const attempts=[];
  for(const answer of ['Верно','Неверно']){
    await nav(student,'tests');
    if(await student.getByRole('button',{name:'Вернуться к тестам',exact:true}).count())await student.getByRole('button',{name:'Вернуться к тестам',exact:true}).click();
    await student.locator('.item').filter({has:student.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Пройти тест',exact:true}).click();
    await student.getByRole('radio',{name:answer,exact:true}).check();
    attempts.push(await student.evaluate(()=>attempt.attemptId));
    await student.getByRole('button',{name:'Завершить тест',exact:true}).click();
    await student.getByRole('heading',{name:answer==='Верно'?'Результат: 1 из 1 (100%)':'Результат: 0 из 1 (0%)',exact:true}).waitFor();
  }
  await nav(teacher,'tests');
  await teacher.locator('.item').filter({has:teacher.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'Результаты',exact:true}).click();
  await teacher.locator('#resultsHeading').filter({hasText:title}).waitFor();
  assert.equal(await teacher.locator('#resultTestSelect').inputValue(),testId);
  assert.equal(await teacher.locator('.results-table [data-result-id]').count(),1);
  assert.equal(await teacher.locator('[data-result-id="'+attempts[1]+'"] .result-mark').textContent(),'—');
  await teacher.locator('#resultScaleEditor summary').click();
  await teacher.locator('#scaleThree').fill('50');await teacher.locator('#scaleFour').fill('70');await teacher.locator('#scaleFive').fill('85');
  await teacher.getByRole('button',{name:'Сохранить шкалу',exact:true}).click();
  await teacher.locator('[data-result-id="'+attempts[1]+'"] .result-mark').filter({hasText:'2'}).waitFor();
  await teacher.locator('[data-result-id="'+attempts[1]+'"] [data-action-menu-toggle]').click();await teacher.locator('[data-result-id="'+attempts[1]+'"] [data-grade="history"]').click();
  await teacher.locator('.results-history-scope').waitFor();
  assert.equal(await teacher.locator('.results-table [data-result-id]').count(),2);
  assert.equal(await teacher.locator('[data-result-id="'+attempts[0]+'"] .result-mark').textContent(),'5');
  const owned=(await rpc(teacher,'getTestResults',{testId,mode:'all'})).data;
  assert.equal(owned.rows.length,2);assert.equal(owned.rows[0].attempt_number,2);assert.equal(owned.rows[1].attempt_number,1);
  for(const action of ['getTestResults','exportTestResults'])assert.equal((await rpc(other,action,{testId})).code,'not-found');
  assert.equal((await rpc(other,'saveTestGradingScale',{testId,revision:0,minThree:0,minFour:1,minFive:2})).code,'not-found');
  assert.equal((await rpc(student,'exportTestResults',{testId})).code,'permission-denied');
  if(student2)assert.equal((await rpc(student2,'getTestResults',{testId})).code,'not-found');
  await nav(student,'results');await student.locator('#resultTestSelect').selectOption(testId);
  await student.locator('#resultsHeading').filter({hasText:title}).waitFor();
  assert.equal(await student.locator('.results-table [data-result-id]').count(),2);
  assert.equal(await student.locator('[data-grade="excel"]').count(),0);assert.equal(await student.locator('#resultScaleEditor').count(),0);
  await student.locator('[data-result-id="'+attempts[0]+'"] [data-grade="open"]').click();
  await student.getByText('1 из 1 (100%)',{exact:true}).waitFor();await student.getByRole('button',{name:'← К результатам',exact:true}).click();
  await student.locator('#resultsHeading').filter({hasText:title}).waitFor();
  const download=teacher.waitForEvent('download');await teacher.getByRole('button',{name:'Действия с результатами',exact:true}).click();await teacher.getByRole('button',{name:'Скачать Excel (.xlsx)',exact:true}).click();
  const file=await download;assert.match(file.suggestedFilename(),/\.xlsx$/);
  const bytes=fs.readFileSync(await file.path());assert.equal(bytes.subarray(0,2).toString(),'PK');
  if(outputDir){fs.mkdirSync(outputDir,{recursive:true});fs.copyFileSync(await file.path(),path.join(outputDir,'results.xlsx'));}
  await teacher.addInitScript(()=>{window.print=()=>{window.__resultsPrintCalled=true;};});
  await teacher.getByRole('button',{name:'Действия с результатами',exact:true}).click();await teacher.getByRole('button',{name:'Печать',exact:true}).click();
  await teacher.waitForFunction(()=>document.getElementById('resultsPrintFrame')?.contentWindow.__resultsPrintCalled===true);
  const printFrame=teacher.frameLocator('#resultsPrintFrame');
  assert.equal(await printFrame.locator('tbody tr').count(),2);assert.equal(await printFrame.locator('script').count(),0);
  assert.equal(await printFrame.getByRole('heading',{name:title,exact:true}).count(),1);
  if(outputDir){
    const html=await teacher.locator('#resultsPrintFrame').evaluate(f=>f.contentDocument.documentElement.outerHTML);
    fs.writeFileSync(path.join(outputDir,'print.html'),html);
    await teacher.screenshot({path:path.join(outputDir,'teacher-results.png'),fullPage:true});
  }
  for(const page of [teacher,student]){
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  if(outputDir)await student.screenshot({path:path.join(outputDir,'student-results-mobile.png'),fullPage:true});
  for(const page of [teacher,student])await page.setViewportSize({width:1280,height:900});
  await nav(teacher,'tests');teacher.once('dialog',d=>d.accept());
  await teacher.locator('.item').filter({has:teacher.getByRole('heading',{name:title,exact:true})}).locator('[data-action-menu-toggle]').click();await teacher.locator('.item').filter({has:teacher.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'В архив',exact:true}).click();
  await teacher.locator('.item').filter({has:teacher.getByRole('heading',{name:title,exact:true})}).getByText(/В архиве/).waitFor();
  await nav(teacher,'journal');await teacher.locator('#resultTestSelect').selectOption(testId);
  await teacher.locator('#resultsHeading').filter({hasText:title}).waitFor();
  assert.match(await teacher.locator('#resultTestSelect option:checked').textContent(),/В архиве/);
  assert.equal((await rpc(student,'getTestResults',{testId,mode:'all'})).data.rows.length,2);
  // A delayed result response must not restore a test after the user cleared it.
  await teacher.locator('#resultTestSelect').selectOption('');
  let release,seen;
  const blocked=new Promise(resolve=>release=resolve),requested=new Promise(resolve=>seen=resolve);
  const intercept=async route=>{
    if(route.request().postDataJSON()?.action!=='getTestResults')return route.continue();
    const response=await route.fetch();seen();await blocked;await route.fulfill({response});
  };
  await teacher.route('**/functions/v1/lms',intercept);
  try{
    await teacher.locator('#resultTestSelect').selectOption(testId);await requested;
    await teacher.locator('#resultTestSelect').selectOption('');
    const finished=teacher.waitForResponse(r=>r.url().includes('/functions/v1/lms')&&r.request().postDataJSON()?.action==='getTestResults');
    release();await finished;
    await teacher.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await teacher.locator('#resultsHeading').count(),0);assert.equal(await teacher.locator('#resultTestSelect').inputValue(),'');
  }finally{release();await teacher.unroute('**/functions/v1/lms',intercept);}
  console.log('PASS selected-test table, two real attempts, latest/all/history, configured marks, access isolation, XLSX download, isolated print, mobile layout and archived results');
};
