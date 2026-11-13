import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.89.0';
import { fullName, validateFields } from '../_shared/name-rules.mjs';
import { dataOf, invalid } from './shared.ts';
import type { Input } from './shared.ts';
export const profileNameColumns='name,no_patronymic,first_name_raw,last_name_raw,patronymic_raw,patronymic_status,name_revision,name_confirmed_at';
export function validatedNames(input:Input){
  try{return validateFields(input);}catch(error){invalid(error instanceof Error?error.message:'Проверьте имя и фамилию.');}
}
export function namePayload(row:Input){
  return {name:row.name,noPatronymic:row.patronymic_status==='absent',firstNameRaw:row.first_name_raw??null,lastNameRaw:row.last_name_raw??null,
    patronymicRaw:row.patronymic_raw??null,patronymicStatus:row.patronymic_status??'unknown',nameRevision:row.name_revision??0,
    nameConfirmed:!!row.name_confirmed_at,needsNameReview:!row.name_confirmed_at};
}
export async function saveNames(db:SupabaseClient,uid:string,input:Input,expectedRevision:number){
  const names=validatedNames(input);
  const saved=await dataOf(db.rpc('save_profile_name',{p_user_id:uid,p_revision:expectedRevision,p_first:names.firstNameRaw,
    p_last:names.lastNameRaw,p_patronymic:names.patronymicRaw,p_status:names.patronymicStatus,p_display:fullName(names)}));
  return namePayload(saved as Input);
}
