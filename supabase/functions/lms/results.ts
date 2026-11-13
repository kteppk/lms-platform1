import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.89.0';
import { ApiError, dataOf, id, invalid, text } from './shared.ts';
import type { Actor, Input } from './shared.ts';

function integer(value:unknown,min:number,max:number) {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)invalid('Некорректное число.');
  return value;
}
export async function resultsAction(db:SupabaseClient,actor:Actor,action:unknown,input:Input):Promise<{data:unknown}|null> {
  if(action==='listResultTests')return {data:await dataOf(db.rpc('list_result_tests',{p_user_id:actor.uid,p_teacher:actor.teacher}))};
  if(action==='getTestResults'||action==='exportTestResults'){
    if(action==='exportTestResults'&&!actor.teacher)throw new ApiError(403,'permission-denied','Выгрузка доступна преподавателю.');
    const mode=input.mode??(actor.teacher?'latest':'all'),sort=input.sort??(actor.teacher?'name':'date'),status=input.status??'';
    if(!['latest','all'].includes(String(mode))||!['name','date','score'].includes(String(sort))||!['','graded','pending_review'].includes(String(status)))invalid('Некорректный фильтр результатов.');
    return {data:await dataOf(db.rpc('test_results_table',{p_user_id:actor.uid,p_teacher:actor.teacher,p_test_id:id(input.testId),p_mode:mode,
      p_search:text(input.studentName??'',120,'ФИО',true),p_status:status,p_student_id:input.studentId?id(input.studentId):null,p_sort:sort,
      p_offset:integer(input.offset??0,0,100000),p_export:action==='exportTestResults'}))};
  }
  if(action==='saveTestGradingScale'){
    if(!actor.teacher)throw new ApiError(403,'permission-denied','Только преподаватель может менять шкалу.');
    return {data:await dataOf(db.rpc('save_test_grading_scale',{p_teacher_id:actor.uid,p_test_id:id(input.testId),
      p_revision:integer(input.revision,-1,2147483646),p_three:integer(input.minThree,0,100),p_four:integer(input.minFour,0,100),p_five:integer(input.minFive,0,100)}))};
  }
  return null;
}
