const SubjectSearch=(()=>{
  const e=v=>escapeHtml(v),normalize=v=>v.normalize('NFC').toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
  function toolbar(){return '<div class="subject-search"><label for="subjectSearch">Найти предмет</label><input type="search" id="subjectSearch" autocomplete="off" placeholder="Название или описание"><p id="subjectSearchStatus" role="status" aria-live="polite"></p></div>';}
  function attrs(s){return `data-subject-search="${e(normalize(s.title+' '+s.description))}"`;}
  function update(){
    const input=document.getElementById('subjectSearch');if(!input)return;
    const words=normalize(input.value).split(/\s+/u).filter(Boolean),cards=[...document.querySelectorAll('[data-subject-search]')];let visible=0;
    for(const card of cards){card.hidden=!words.every(w=>card.dataset.subjectSearch.includes(w));if(!card.hidden)visible++;}
    document.getElementById('subjectSearchStatus').textContent=words.length?(visible?'Найдено предметов: '+visible:'Ничего не найдено. Попробуйте другое название.'):'Всего предметов: '+cards.length;
    previews();
  }
  function previews(){for(const p of document.querySelectorAll('.subject-preview'))if(p.clientHeight)p.classList.toggle('is-truncated',p.scrollHeight>p.clientHeight+1);}
  window.addEventListener('resize',previews);
  document.addEventListener('input',event=>{if(event.target.id==='subjectSearch')update();});
  return {toolbar,attrs,update};
})();
