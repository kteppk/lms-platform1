import {displayPart,fullName,validateFields,validatePart} from './supabase/functions/_shared/name-rules.mjs?v=identity1';
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function fields(prefix,person={}){
  return `<div class="name-fields" data-name-prefix="${prefix}">
    <div class="form-group"><label for="${prefix}FirstName">Имя</label><input id="${prefix}FirstName" data-name-part="first" required maxlength="512" autocomplete="given-name" value="${e(person.firstNameRaw)}" placeholder="Анна-Мария"><span class="name-field-error" data-name-error="first"></span></div>
    <div class="form-group"><label for="${prefix}LastName">Фамилия</label><input id="${prefix}LastName" data-name-part="last" required maxlength="512" autocomplete="family-name" value="${e(person.lastNameRaw)}" placeholder="Салчак-оол"><span class="name-field-error" data-name-error="last"></span></div>
    <div class="form-group"><label for="${prefix}Patronymic">Отчество <span class="optional-label">необязательно</span></label><input id="${prefix}Patronymic" data-name-part="patronymic" maxlength="512" autocomplete="additional-name" value="${e(person.patronymicRaw)}" ${person.patronymicStatus==='absent'?'disabled':''}><span class="name-field-error" data-name-error="patronymic"></span></div>
    <label class="check-label name-no-patronymic"><input id="${prefix}NoPatronymic" type="checkbox" ${person.patronymicStatus==='absent'?'checked':''}>Нет отчества</label>
    <p class="name-preview" data-name-preview>В списках: ${person.nameConfirmed?e(person.name):'появится после заполнения имени и фамилии'}</p>
    <p class="hint name-hint">Укажите данные как в документах. Двойные имена, фамилии, дефисы и апострофы допустимы.</p>
  </div>`;
}
export function read(prefix){
  const get=suffix=>document.getElementById(prefix+suffix);
  const absent=get('NoPatronymic').checked,patronymicRaw=absent?'':get('Patronymic').value;
  return validateFields({firstNameRaw:get('FirstName').value,lastNameRaw:get('LastName').value,patronymicRaw,
    patronymicStatus:absent?'absent':displayPart(patronymicRaw)?'provided':'unknown'});
}
function preview(root){
  const prefix=root.dataset.namePrefix;
  const father=document.getElementById(prefix+'Patronymic');father.disabled=document.getElementById(prefix+'NoPatronymic').checked;
  try{root.querySelector('[data-name-preview]').textContent='В списках: '+fullName(read(prefix));}
  catch{root.querySelector('[data-name-preview]').textContent='Заполните имя и фамилию. Отчество можно оставить пустым.';}
}
document.addEventListener('input',event=>{
  const root=event.target.closest('[data-name-prefix]');if(!root)return;
  const part=event.target.dataset.namePart;
  if(part){root.querySelector(`[data-name-error="${part}"]`).textContent='';event.target.removeAttribute('aria-invalid');}
});
document.addEventListener('change',event=>{const root=event.target.closest('[data-name-prefix]');if(root)preview(root);});
document.addEventListener('focusout',event=>{
  const root=event.target.closest('[data-name-prefix]'),part=event.target.dataset.namePart;if(!root||!part)return;
  try{validatePart(event.target.value,{first:'Имя',last:'Фамилия',patronymic:'Отчество'}[part],part==='patronymic');}
  catch(error){root.querySelector(`[data-name-error="${part}"]`).textContent=error.message;event.target.setAttribute('aria-invalid','true');}
  preview(root);
});
