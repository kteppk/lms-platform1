const word=String.raw`\p{L}[\p{L}\p{M}]*(?:[\u200C\u200D]\p{L}[\p{L}\p{M}]*)*`;
const partPattern=new RegExp(`^${word}(?:[ '-]${word})*$`,'u');
const graphemes=new Intl.Segmenter('ru',{granularity:'grapheme'});
export function displayPart(raw){
  return String(raw??'').normalize('NFC').replace(/[\p{Pd}\u2212]/gu,'-')
    .replace(/[\u2018\u2019\u02BC\uFF07]/gu,"'").replace(/\p{Zs}+/gu,' ').trim().replace(/ *([-']) */gu,'$1');
}
export function validatePart(raw,label,optional=false){
  if(typeof raw!=='string')throw new Error(label+': укажите текст.');
  if([...raw].length>256)throw new Error(label+': слишком длинная запись.');
  if(/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u.test(raw)||/\p{Cf}/u.test(raw.replace(/[\u200C\u200D]/gu,'')))throw new Error(label+': удалите переносы строк и невидимые символы.');
  const shown=displayPart(raw);
  if(!shown&&optional)return null;
  if(!shown)throw new Error(label+': заполните поле.');
  if([...graphemes.segment(shown)].length>100)throw new Error(label+': не более 100 символов.');
  if(!partPattern.test(shown))throw new Error(label+': используйте буквы, пробелы, дефисы и апострофы, без цифр и эмодзи.');
  return raw;
}
export function validateFields(input){
  if(!input||typeof input!=='object')throw new Error('Заполните имя и фамилию.');
  const firstNameRaw=validatePart(input.firstNameRaw,'Имя'),lastNameRaw=validatePart(input.lastNameRaw,'Фамилия');
  let patronymicRaw=validatePart(input.patronymicRaw??'','Отчество',true);
  let patronymicStatus=input.patronymicStatus??(patronymicRaw?'provided':'unknown');
  if(!['provided','absent','unknown'].includes(patronymicStatus))throw new Error('Уточните, указано ли отчество.');
  if(patronymicStatus==='absent'&&patronymicRaw!==null)throw new Error('Уберите отчество или снимите отметку «Нет отчества».');
  if(patronymicRaw!==null)patronymicStatus='provided';
  else if(patronymicStatus==='provided')throw new Error('Заполните отчество или оставьте поле необязательным.');
  return {firstNameRaw,lastNameRaw,patronymicRaw,patronymicStatus};
}
export function fullName(fields){
  return [fields.lastNameRaw,fields.firstNameRaw,fields.patronymicRaw].filter(v=>v!=null).map(displayPart).filter(Boolean).join(' ');
}
export function firstGrapheme(value){return [...graphemes.segment(displayPart(value))][0]?.segment??'';}
