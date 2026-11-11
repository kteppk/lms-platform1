export type Input = Record<string, unknown>;
export type Identity = { uid: string; email: string; name?: string };
export type Actor = Identity & { name: string; teacher: boolean; role: 'student' | 'teacher' | 'admin'; noPatronymic: boolean };
export const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function invalid(message: string): never { throw new ApiError(400, 'invalid-argument', message); }
export function missing(message: string): never { throw new ApiError(404, 'not-found', message); }
export function requireAdmin(actor: Actor) {
  if (actor.role !== 'admin') throw new ApiError(403, 'permission-denied', 'Только для администратора.');
}
export function record(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Некорректные данные.');
  return value as Input;
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value)) invalid('Некорректный идентификатор.');
  return value;
}
export function text(value: unknown, limit: number, field: string, optional = false): string {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) invalid(`${field}: укажите текст длиной до ${limit} символов.`);
  return value.trim();
}
export async function dataOf<T>(query: PromiseLike<{data:T;error:{message:string;code?:string}|null}>): Promise<T> {
  const {data,error}=await query;
  if(error?.code==='23505' && error.message.includes('subjects_active_title')) throw new ApiError(409,'already-exists','Предмет с таким названием уже есть. Присоединитесь к нему в каталоге.');
  if(error?.code==='42501') throw new ApiError(403,'permission-denied',error.message);
  if(error?.code==='P0002') missing(error.message);
  if(error?.code==='P0001') throw new ApiError(409,'deadline-exceeded','Время на прохождение теста истекло.');
  if(error?.code==='22023') invalid(error.message);
  if(error?.code==='40001'||error?.code==='PT409') throw new ApiError(409,'conflict',error.message);
  if(error) throw new Error(error.message);
  return data;
}
