import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.89.0';
import { dataOf, id, invalid, missing, requireAdmin, text } from './shared.ts';
import type { Actor, Input } from './shared.ts';

function integer(value:unknown,min:number,max:number) {
  if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)invalid('Некорректный номер пары, день недели или версия записи.');
  return value;
}
export async function scheduleAction(db:SupabaseClient,actor:Actor,action:unknown,input:Input):Promise<{data:unknown}|null> {
  switch(action){
    case 'listScheduleGroups':return {data:await dataOf(db.from('study_groups').select('id,name,course,program,lessons_per_day').order('name'))};
    case 'createScheduleGroup':{
      requireAdmin(actor);
      return {data:await dataOf(db.rpc('create_schedule_group',{p_actor_id:actor.uid,p_name:text(input.name,100,'Группа'),
        p_course:text(input.course??'',40,'Курс',true),p_program:text(input.program??'',200,'Специальность',true),p_lessons:integer(input.lessonsPerDay??6,1,12)}))};
    }
    case 'getWeeklySchedule':{
      const groupId=id(input.groupId);
      const group=await dataOf(db.from('study_groups').select('id,name,course,program,lessons_per_day').eq('id',groupId).maybeSingle());
      if(!group)missing('Группа не найдена.');
      // Exact server-side scope: other groups' lessons never leave the API.
      const cells=await dataOf(db.from('weekly_schedule_cells').select('id,weekday,lesson_number,status,title,subject_id,teacher_id,teacher_label,room,note,starts_at,ends_at,revision').eq('group_id',groupId).order('weekday').order('lesson_number'));
      return {data:{group,cells:cells??[]}};
    }
    case 'saveScheduleCell':{
      requireAdmin(actor);
      if(!['lesson','free'].includes(String(input.status)))invalid('Выберите занятие или «Нет пары».');
      const cell:Input={status:input.status};
      if(input.status==='lesson'){
        cell.title=text(input.title,200,'Предмет');cell.subjectId=input.subjectId?id(input.subjectId):null;
        cell.teacherId=input.teacherId?id(input.teacherId):null;cell.teacherLabel=text(input.teacherLabel??'',800,'Преподаватель',true);
        cell.room=text(input.room??'',100,'Аудитория',true);cell.note=text(input.note??'',1000,'Примечание',true);
        const starts=input.startsAt||null,ends=input.endsAt||null;
        if((starts===null)!==(ends===null)||(starts!==null&&(typeof starts!=='string'||typeof ends!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(starts)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(ends)||ends<=starts)))invalid('Укажите оба времени, окончание должно быть позже начала.');
        cell.startsAt=starts;cell.endsAt=ends;
      }
      return {data:await dataOf(db.rpc('save_schedule_cell',{p_actor_id:actor.uid,p_group_id:id(input.groupId),p_weekday:integer(input.weekday,1,7),
        p_lesson:integer(input.lessonNumber,1,12),p_expected_id:input.id?id(input.id):null,p_revision:integer(input.revision??0,0,2147483646),p_cell:cell}))};
    }
    default:return null;
  }
}
