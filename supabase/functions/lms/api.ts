import type { SupabaseClient } from "npm:@supabase/supabase-js@2.89.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.3";

const project = "students-70392";
const firebaseKeys = createRemoteJWKSet(new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
));
import { ApiError, dataOf, id, idPattern, invalid, missing, record, text } from "./shared.ts";
import type { Actor, Identity, Input } from "./shared.ts";
import { communityAction } from "./community.ts";
import { resultsAction } from "./results.ts";
import { namePayload, profileNameColumns, validatedNames } from './names.ts';
import { fullName } from '../_shared/name-rules.mjs';
import { ownAvatar } from './people.ts';
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const pdf = "application/pdf";
const uploads = {
  lectures: {
    bucket: "lms-lectures",
    maxBytes: 50 * 1024 * 1024,
    types: [pdf, "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "video/mp4", "text/html"],
  },
  books: { bucket: "lms-books", maxBytes: 50 * 1024 * 1024, types: [pdf] },
  photo: {
    bucket: "lms-photos",
    maxBytes: 10 * 1024 * 1024,
    types: ["jpeg", "png", "webp", "gif", "heic", "heif", "avif", "bmp", "tiff"]
      .map((type) => "image/" + type),
  },
};

type Kind = "lectures" | "books";
type ContentScope = { teacherId?: string; subjectId?: string | null };
type AttachmentDetails = { name: string; mime: string };
type Question = { type: "text" | "photo"; text: string } |
  { type: "choice"; text: string; options: string[]; correct: number };
type Test = {
  id: string; title: string; teacher_name: string; timer: number; questions: Question[];
  subject_id: string | null; teacher_id: string; archived_at?: string | null;
};
type AttemptRow = { id: string; test_snapshot: Test; answers: Input; revision: number; state: string; expires_at: string | null };
type ResultSummaryRow = { id: string; score: number; total: number; percentage: number | null; status: string;
  feedback?: string; graded_at?: string | null; review_revision?: number };

function deadline(): never {
  throw new ApiError(409, "deadline-exceeded", "Время на прохождение теста истекло.");
}

function requireRole(actor: Actor, teacher: boolean) {
  if (teacher ? !actor.teacher : actor.role !== "student") throw new ApiError(403, "permission-denied", "Недостаточно прав.");
}

function materialKind(value: unknown): Kind {
  if (value !== "lectures" && value !== "books") invalid("Неизвестный тип материала.");
  return value;
}

export async function verifyFirebase(token: string): Promise<Identity> {
  try {
    const { payload } = await jwtVerify(token, firebaseKeys, {
      issuer: "https://securetoken.google.com/" + project,
      audience: project,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "iat", "exp", "auth_time"],
    });
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.iat !== "number" || payload.iat > now ||
        typeof payload.auth_time !== "number" || payload.auth_time > now ||
        typeof payload.sub !== "string" || !idPattern.test(payload.sub) ||
        typeof payload.email !== "string" || !payload.email) throw new Error("Invalid Firebase claims");
    return { uid: payload.sub, email: payload.email, name: typeof payload.name === "string" ? payload.name : undefined };
  } catch {
    throw new ApiError(401, "unauthenticated", "Войдите в аккаунт Firebase.");
  }
}

async function getActor(db: SupabaseClient, identity: Identity, registrationName?: unknown): Promise<Actor> {
  const { uid, email } = identity;
  const [existing, accountRole, instructor] = await Promise.all([
    dataOf(db.from("profiles").select(profileNameColumns).eq("id", uid).maybeSingle()),
    dataOf(db.from("account_roles").select("role").eq("user_id", uid).maybeSingle()),
    dataOf(db.from("teachers").select("user_id").eq("user_id", uid).maybeSingle()),
  ]);
  if (!existing && registrationName === undefined) {
    throw new ApiError(403, "permission-denied", "Сначала откройте профиль.");
  }
  const names=!existing&&registrationName!==null&&typeof registrationName==='object'?validatedNames(registrationName as Input):null;
  const name = existing?.name ?? (names?fullName(names):(
    (typeof registrationName === "string" && registrationName.trim()) ||
    identity.name?.trim() || email.split("@")[0] || "Пользователь"
  ).slice(0, 120));
  if (!existing) {
    await dataOf(db.from("profiles").upsert({ id: uid, name, email,...(names?{first_name_raw:names.firstNameRaw,last_name_raw:names.lastNameRaw,
      patronymic_raw:names.patronymicRaw,patronymic_status:names.patronymicStatus,no_patronymic:names.patronymicStatus==='absent',name_revision:1,name_confirmed_at:new Date().toISOString()}:{}) }, { onConflict: "id", ignoreDuplicates: true }));
    const stored = await dataOf(db.from("profiles").select(profileNameColumns).eq("id", uid).single());
    if (!stored) throw new Error("Missing profile");
    return { ...identity, name: stored.name, teacher: accountRole?.role === "teacher", role: accountRole?.role ?? "student", noPatronymic: stored.no_patronymic, nameData:namePayload(stored) };
  }
  return { ...identity, name, teacher: Boolean(instructor) && ["teacher", "admin"].includes(accountRole?.role ?? "student"), role: accountRole?.role ?? "student", noPatronymic: existing?.no_patronymic ?? false, nameData:namePayload(existing) };
}

function ownedPath(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && idPattern.test(value.slice(prefix.length));
}

function storagePath(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

async function activeSubject(db: SupabaseClient, subjectId: string) {
  const subject = await dataOf(db.from("subjects").select("id,title,description")
    .eq("id", subjectId).is("archived_at", null).maybeSingle());
  if (!subject) missing("Предмет недоступен.");
  return subject;
}

async function findInstructor(db: SupabaseClient, subjectId: string, teacherId: string) {
  return await dataOf(db.from("subject_instructors").select("teacher_id,teacher_name")
    .eq("subject_id", subjectId).eq("teacher_id", teacherId).maybeSingle());
}

async function publishingSubject(db: SupabaseClient, actor: Actor, value: unknown) {
  if (value == null) return null;
  const subjectId = id(value);
  if (!await findInstructor(db, subjectId, actor.uid)) {
    throw new ApiError(403, "permission-denied", "Вы не ведёте этот предмет.");
  }
  return subjectId;
}

async function listSubjects(db: SupabaseClient, actor: Actor) {
  const rows = (await dataOf(db.from("subjects").select("id,title,description,created_by,subject_teachers(teacher_id)")
    .is("archived_at", null).order("title"))) ?? [];
  const instructors = (await dataOf(db.from("subject_instructors").select("subject_id,teacher_id"))) ?? [];
  return rows.map(({ id, title, description, created_by, subject_teachers }) => ({
    id, title, description, teacherCount: instructors.filter(i => i.subject_id === id).length,
    ...(actor.teacher ? {
      canEdit: created_by === actor.uid,
      joined: subject_teachers.some(({ teacher_id }) => teacher_id === actor.uid),
    } : {}),
  }));
}

async function saveSubject(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, true);
  const title = text(input.title, 120, "Название предмета");
  const description = text(input.description ?? "", 1000, "Описание предмета", true);
  if (input.subjectId == null) {
    const subjectId = await dataOf(db.rpc("create_subject", {
      p_teacher_id: actor.uid, p_title: title, p_description: description,
    }));
    return { id: subjectId };
  }
  return await updateOwnSubject(db, actor, id(input.subjectId), { title, description });
}

async function updateOwnSubject(db: SupabaseClient, actor: Actor, subjectId: string, fields: Input) {
  requireRole(actor, true);
  const subject = await dataOf(db.from("subjects").update(fields)
    .eq("id", subjectId).eq("created_by", actor.uid).is("archived_at", null).select("id").maybeSingle());
  if (!subject) missing("Предмет недоступен для изменений.");
  return subject;
}

async function changeSubjectMembership(db: SupabaseClient, actor: Actor, input: Input, join: boolean) {
  requireRole(actor, true);
  const subjectId = id(input.subjectId);
  if (join) {
    await dataOf(db.from("subject_teachers").upsert({
      subject_id: subjectId, teacher_id: actor.uid,
    }, { onConflict: "subject_id,teacher_id", ignoreDuplicates: true }));
  } else {
    await dataOf(db.from("subject_teachers").delete().eq("subject_id", subjectId).eq("teacher_id", actor.uid));
  }
  return null;
}

async function listSubjectTeachers(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, false);
  const subjectId = id(input.subjectId);
  const subject = await activeSubject(db, subjectId);
  const rows = (await dataOf(db.from("subject_instructors").select("teacher_id,teacher_name")
    .eq("subject_id", subjectId).order("teacher_name"))) ?? [];
  return {
    subject,
    teachers: rows.map(({ teacher_id, teacher_name }) => ({ id: teacher_id, name: teacher_name })),
  };
}

async function getSubjectContent(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, false);
  const subjectId = id(input.subjectId);
  const teacherId = id(input.teacherId);
  const instructor = await findInstructor(db, subjectId, teacherId);
  if (!instructor) missing("Преподаватель больше не ведёт этот предмет.");
  const scope = { subjectId, teacherId };
  const [subject, lectures, books, tests] = await Promise.all([
    activeSubject(db, subjectId),
    readMaterials(db, "lectures", scope, false),
    readMaterials(db, "books", scope, false),
    readTests(db, scope),
  ]);
  return { subject, teacher: { id: teacherId, name: instructor.teacher_name }, lectures, books, tests };
}

async function getAttempt(db: SupabaseClient, actor: Actor, attemptId: string) {
  const attempt = await dataOf(db.from("test_attempts").select("id,test_id,expires_at,test_snapshot,revision,state")
    .eq("id", attemptId).eq("student_id", actor.uid).maybeSingle());
  if (!attempt) missing("Попытка недоступна.");
  return attempt;
}

async function createUpload(db: SupabaseClient, actor: Actor, input: Input) {
  const kind = input.kind === "photo" ? "photo" : materialKind(input.kind);
  requireRole(actor, kind !== "photo");
  const config = uploads[kind];
  if (typeof input.mime !== "string" || !config.types.includes(input.mime)) invalid("Этот тип файла не поддерживается.");
  if (typeof input.size !== "number" || !Number.isSafeInteger(input.size) ||
      input.size < 1 || input.size > config.maxBytes) {
    invalid(`Файл должен быть не больше ${config.maxBytes / 1024 / 1024} МБ.`);
  }

  let folder = actor.uid + "/";
  if (kind === "photo") {
    const attempt = await getAttempt(db, actor, id(input.attemptId));
    if (attempt.state !== "active") missing("Попытка уже завершена.");
    const result = await dataOf(db.from("test_results").select("id").eq("id", attempt.id).maybeSingle());
    if (result) missing("Попытка уже завершена.");
    if (attempt.expires_at && Date.now() > Date.parse(attempt.expires_at)) deadline();
    folder += attempt.id + "/";
  } else {
    await publishingSubject(db, actor, input.subjectId);
  }

  const path = folder + crypto.randomUUID();
  const grant = await dataOf(db.storage.from(config.bucket).createSignedUploadUrl(path));
  if (!grant) throw new Error("Missing upload URL");
  return { path, url: storagePath(grant.signedUrl) };
}

async function listMaterials(db: SupabaseClient, actor: Actor, input: Input) {
  const kind = materialKind(input.kind);
  const mine = input.mine === true;
  if (mine) requireRole(actor, true);
  return await readMaterials(db, kind, mine ? { teacherId: actor.uid } : { subjectId: null }, mine);
}

async function readMaterials(db: SupabaseClient, kind: Kind, scope: ContentScope, mine: boolean) {
  let query = db.from("materials")
    .select("id,title,teacher_name,body,author,files,created_at,subject_id,attachment_details")
    .eq("kind", kind);
  if (scope.teacherId) query = query.eq("teacher_id", scope.teacherId);
  if (scope.subjectId === null) query = query.is("subject_id", null);
  if (scope.subjectId) query = query.eq("subject_id", scope.subjectId);
  const rows = (await dataOf(query.order("created_at", { ascending: false }))) ?? [];

  const paths = [...new Set(rows.flatMap((row) => row.files as string[]))];
  const links = new Map<string, string>();
  if (paths.length) {
    const signed = await dataOf(db.storage.from(uploads[kind].bucket).createSignedUrls(paths, 3600));
    for (const file of signed ?? []) {
      if (file.path && file.signedUrl && !file.error) links.set(file.path, file.signedUrl);
    }
  }
  return rows.map((row) => {
    const details = row.attachment_details as AttachmentDetails[];
    const attachments = (row.files as string[]).flatMap((path, index) => {
      const url = links.get(path);
      if (!url) return [];
      const name = details[index]?.name || "";
      const mime = details[index]?.mime || (kind === "books" ? pdf : "");
      const download = new URL(url);
      download.searchParams.set("download", name);
      return [{ name, mime, downloadUrl: storagePath(download.href),
        viewUrl: mime === pdf || mime === "video/mp4" ? storagePath(url) : null }];
    });
    const files: string[] = attachments.map((file) => file.downloadUrl);
    return {
      id: row.id, title: row.title, teacherName: row.teacher_name, createdAt: row.created_at,
      subjectId: row.subject_id, attachments,
      ...(kind === "lectures" ? { text: row.body, files } :
        { author: row.author, description: row.body, fileUrl: files[0] || "" }),
    };
  });
}

async function createMaterial(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, true);
  const kind = materialKind(input.kind);
  const subjectId = await publishingSubject(db, actor, input.subjectId);
  const title = text(input.title, 300, "Название");
  const author = kind === "books" ? text(input.author, 300, "Автор") : null;
  const files = input.files;
  if (!Array.isArray(files) || files.length > (kind === "books" ? 1 : 20) ||
      files.some((path) => !ownedPath(path, actor.uid + "/")) || new Set(files).size !== files.length) {
    invalid("Некорректный список вложений.");
  }
  const body = kind === "lectures"
    ? text(input.text, 100000, "Текст материала", files.length > 0)
    : text(input.description, 100000, "Описание", true);
  const bucket = db.storage.from(uploads[kind].bucket);
  let attachmentDetails: AttachmentDetails[] = [];
  if (subjectId || input.fileNames !== undefined) {
    const names = input.fileNames ?? files.map(() => "");
    if (!Array.isArray(names) || names.length !== files.length) invalid("Некорректные имена вложений.");
    attachmentDetails = await Promise.all(files.map(async (path, index) => {
      const name = text(names[index], 255, "Имя файла", true);
      const info = await dataOf(bucket.info(path));
      if (!info) invalid("Вложение ещё не загружено.");
      return { name, mime: info.contentType ?? "" };
    }));
  } else {
    const exists = await Promise.all(files.map((path) => dataOf(bucket.exists(path))));
    if (exists.some((value) => !value)) invalid("Вложение ещё не загружено.");
  }

  return await dataOf(db.from("materials").insert({
    kind, title, body, author, files, teacher_id: actor.uid, teacher_name: actor.name,
    subject_id: subjectId, attachment_details: attachmentDetails,
  }).select("id").single());
}

async function deleteItem(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, true);
  const itemId = id(input.id);
  if (input.kind === "tests") {
    await dataOf(db.from("tests").update({ archived_at: new Date().toISOString() })
      .eq("id", itemId).eq("teacher_id", actor.uid));
    return null;
  }
  const kind = materialKind(input.kind);
  const item = await dataOf(db.from("materials").delete().eq("kind", kind)
    .eq("id", itemId).eq("teacher_id", actor.uid).select("files").maybeSingle());
  if (item?.files.length) {
    // A file can be referenced by another material from the same author.
    const shared = await dataOf(db.from("materials").select("files").eq("kind", kind)
      .eq("teacher_id", actor.uid).overlaps("files", item.files));
    const used = new Set((shared ?? []).flatMap((row) => row.files as string[]));
    const unused = (item.files as string[]).filter((path) => !used.has(path));
    if (unused.length) await dataOf(db.storage.from(uploads[kind].bucket).remove(unused));
  }
  return null;
}

function testSummary(test: Test) {
  return {
    id: test.id, title: test.title, teacherName: test.teacher_name,
    questionCount: test.questions.length, timer: test.timer, subjectId: test.subject_id,
    archived: Boolean(test.archived_at),
  };
}

async function createTest(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, true);
  const subjectId = await publishingSubject(db, actor, input.subjectId);
  const title = text(input.title, 200, "Название теста");
  const { timer, questions } = input;
  if (typeof timer !== "number" || !Number.isInteger(timer) || timer < 0 || timer > 1440) {
    invalid("Таймер должен быть целым числом от 0 до 1440 минут.");
  }
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 100) {
    invalid("Добавьте от 1 до 100 вопросов.");
  }
  const clean = questions.map((question): Question => {
    const { type, text: prompt, options, correct } = record(question);
    const cleanText = text(prompt, 2000, "Текст вопроса");
    if (type === "text" || type === "photo") return { type, text: cleanText };
    if (type !== "choice" || !Array.isArray(options) || options.length !== 4 ||
        typeof correct !== "number" || !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      invalid("Укажите четыре варианта и номер правильного ответа.");
    }
    return { type, text: cleanText, options: options.map((option) => text(option, 500, "Вариант ответа")), correct };
  });
  return await dataOf(db.from("tests").insert({
    title, timer, questions: clean, teacher_id: actor.uid, teacher_name: actor.name, subject_id: subjectId,
  }).select("id").single());
}

async function listTests(db: SupabaseClient, actor: Actor, mine: boolean) {
  requireRole(actor, mine);
  return await readTests(db, mine ? { teacherId: actor.uid } : { subjectId: null }, mine);
}

async function readTests(db: SupabaseClient, scope: ContentScope, includeArchived = false) {
  let query = db.from("tests").select("id,title,teacher_name,timer,questions,subject_id,teacher_id,archived_at");
  if (!includeArchived) query = query.is("archived_at", null);
  if (scope.teacherId) query = query.eq("teacher_id", scope.teacherId);
  if (scope.subjectId === null) query = query.is("subject_id", null);
  if (scope.subjectId) query = query.eq("subject_id", scope.subjectId);
  const rows = (await dataOf(query.order("created_at", { ascending: false }))) ?? [];
  return rows.map(testSummary);
}

function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid("Обновите страницу попытки.");
  return value;
}

async function startStudentTest(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, false);
  const attempt = await dataOf(db.rpc("open_test_attempt", { p_test_id: id(input.testId), p_student_id: actor.uid }));
  return await attemptPayload(db, attempt);
}

async function attemptPayload(db: SupabaseClient, attempt: AttemptRow) {
  const test = attempt.test_snapshot as Test;
  const questions = test.questions.map((question) => question.type === "choice" ?
    { type: question.type, text: question.text, options: question.options } :
    { type: question.type, text: question.text });
  const result = attempt.state === "submitted" ? await dataOf(db.from("test_results")
    .select("id,score,total,percentage,status,feedback,graded_at,review_revision").eq("id", attempt.id).single()) : null;
  return {
    ...testSummary(test), teacherId: test.teacher_id, attemptId: attempt.id, questions,
    answers: attempt.answers, revision: attempt.revision, result: result ? resultSummary(result) : null,
    expiresAt: attempt.expires_at,
    remainingMs: attempt.expires_at === null ? null : Math.max(0, Date.parse(attempt.expires_at) - Date.now()),
  };
}

async function readStudentAttempt(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, false);
  const attempt = await dataOf(db.rpc("read_test_attempt", { p_attempt_id: id(input.attemptId), p_student_id: actor.uid }));
  return await attemptPayload(db, attempt);
}

async function listActiveAttempts(db: SupabaseClient, actor: Actor) {
  requireRole(actor, false);
  const rows = (await dataOf(db.from("test_attempts").select("id")
    .eq("student_id", actor.uid).eq("state", "active").order("created_at", { ascending: false }))) ?? [];
  const result: Input[] = [];
  for (const row of rows) {
    const a = await dataOf(db.rpc("read_test_attempt", { p_attempt_id: row.id, p_student_id: actor.uid }));
    if (a.state === "active") result.push({ attemptId: a.id, title: a.test_snapshot.title,
      subjectId: a.test_snapshot.subject_id, teacherId: a.test_snapshot.teacher_id });
  }
  return result;
}

async function validateAnswers(db: SupabaseClient, actor: Actor, attempt: Pick<AttemptRow, "id" | "test_snapshot">, answers: Input) {
  const { questions } = attempt.test_snapshot as Test;
  const photos: string[] = [];
  const prefix = actor.uid + "/" + attempt.id + "/";
  for (const [key, value] of Object.entries(answers)) {
    const index = Number(key);
    const question = questions[index];
    if (!Number.isInteger(index) || String(index) !== key || !question) invalid("Ответ относится к неизвестному вопросу.");
    if (question.type === "choice" && typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 4) continue;
    if (question.type === "text" && typeof value === "string" && value.length <= 5000) continue;
    if (question.type === "photo" && ownedPath(value, prefix)) { photos.push(value); continue; }
    invalid("Некорректный ответ на вопрос №" + (index + 1) + ".");
  }
  const exists = await Promise.all(photos.map(path => dataOf(db.storage.from(uploads.photo.bucket).exists(path))));
  if (exists.some(value => !value)) invalid("Фото ещё не загружено.");
}

async function saveStudentDraft(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, false);
  const attempt = await getAttempt(db, actor, id(input.attemptId));
  const answers = record(input.answers);
  await validateAnswers(db, actor, attempt, answers);
  return await dataOf(db.rpc("save_test_draft", { p_attempt_id: attempt.id, p_student_id: actor.uid,
    p_answers: answers, p_expected_revision: revision(input.revision) }));
}

async function submitStudentTest(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, false);
  const receivedAt = new Date();
  const attemptId = id(input.attemptId);
  const answers = record(input.answers);
  const attempt = await getAttempt(db, actor, attemptId);
  const previous = await dataOf(db.from("test_results").select("id,score,total,percentage,status,feedback,graded_at,review_revision")
    .eq("id", attemptId).eq("student_id", actor.uid).maybeSingle());
  if (previous) return resultSummary(previous);
  await validateAnswers(db, actor, attempt, answers);
  return await dataOf(db.rpc("finish_test_attempt", {
    p_attempt_id: attemptId, p_student_id: actor.uid, p_answers: answers, p_received_at: receivedAt.toISOString(),
    p_expected_revision: input.revision === undefined ? attempt.revision : revision(input.revision),
  }));
}

function resultSummary(row: ResultSummaryRow) {
  return { id: row.id, score: row.score, total: row.total, percentage: row.percentage,
    status: row.status, feedback: row.feedback, gradedAt: row.graded_at, reviewRevision: row.review_revision };
}

async function listResults(db: SupabaseClient, actor: Actor, input: Input) {
  let query = db.from("test_results").select("id,test_id,test_title,student_name,score,total,percentage,status,submitted_at,graded_at")
    .eq(actor.teacher ? "teacher_id" : "student_id", actor.uid);
  if (input.status) {
    if (input.status !== "graded" && input.status !== "pending_review") invalid("Неизвестный статус.");
    query = query.eq("status", input.status);
  }
  if (input.testId) query = query.eq("test_id", id(input.testId));
  if (input.studentName && actor.teacher) {
    const name = text(input.studentName, 120, "Имя студента").replace(/[\\%_]/g, "\\$&");
    query = query.ilike("student_name", "%" + name + "%");
  }
  for (const field of ["fromDate", "toDate"]) {
    if (!input[field]) continue;
    const date = input[field];
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) invalid("Некорректная дата.");
    query = field === "fromDate" ? query.gte("submitted_at", date + "T00:00:00Z") :
      query.lt("submitted_at", new Date(Date.parse(date) + 86400000).toISOString());
  }
  const offset = input.offset ?? 0;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) invalid("Некорректная страница.");
  const rows = (await dataOf(query.order("submitted_at", { ascending: false }).order("id")
    .range(offset, offset + 49))) ?? [];
  return { rows: rows.map(row => ({ ...row, ...resultSummary(row) })), hasMore: rows.length === 50 };
}

async function getResult(db: SupabaseClient, actor: Actor, input: Input) {
  const row = await dataOf(db.from("test_results").select("id,test_id,test_title,student_name,student_id,teacher_id,score,total,percentage,status,submitted_at,test_snapshot,answers,question_scores,feedback,graded_at,review_revision")
    .eq("id", id(input.resultId)).eq(actor.teacher ? "teacher_id" : "student_id", actor.uid).maybeSingle());
  if (!row) missing("Работа недоступна.");
  const questions = (row.test_snapshot.questions ?? []) as Question[];
  const paths = questions.flatMap((q,i) => q.type === "photo" && ownedPath(row.answers[i], row.student_id + "/" + row.id + "/") ? [row.answers[i]] : []);
  const signed = paths.length ? await dataOf(db.storage.from(uploads.photo.bucket).createSignedUrls(paths, 3600)) : [];
  const links = new Map((signed ?? []).filter(f => f.path && f.signedUrl && !f.error).map(f => [f.path, storagePath(f.signedUrl)]));
  const reviews = actor.teacher ? await dataOf(db.from("test_result_reviews").select("grades,feedback,score,reviewed_at")
    .eq("result_id", row.id).order("reviewed_at", { ascending: false })) : [];
  return { ...resultSummary(row), title: row.test_title, studentName: row.student_name, submittedAt: row.submitted_at,
    teacherName: row.test_snapshot.teacher_name ?? "", reviews,
    questions: questions.map((q,i) => ({ type: q.type, text: q.text,
      ...(q.type === "choice" ? { options: q.options, ...(actor.teacher ? { correct: q.correct } : {}) } : {}),
      answer: q.type === "photo" ? null : row.answers[i] ?? null,
      photoUrl: q.type === "photo" ? links.get(row.answers[i]) ?? null : null, score: row.question_scores[i] ?? null })),
  };
}

async function reviewResult(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, true);
  return await dataOf(db.rpc("review_test_result", { p_result_id: id(input.resultId), p_teacher_id: actor.uid,
    p_grades: record(input.grades), p_feedback: text(input.feedback ?? "", 5000, "Комментарий", true),
    p_expected_revision: revision(input.revision) }));
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

export function createHandler(db: SupabaseClient, verify = verifyFirebase) {
  return async (request: Request) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return response({ error: "Используйте POST." }, 405);
    try {
      const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) throw new ApiError(401, "unauthenticated", "Войдите в аккаунт Firebase.");
      const identity = await verify(token);
      const body = await request.text();
      if (body.length > 1024 * 1024) invalid("Слишком большой запрос.");
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { invalid("Некорректный JSON."); }
      const { action, data } = record(parsed);
      const input = record(data ?? {});
      const actor = await getActor(db, identity, action === "profile" ? input.nameFields ?? input.name ?? "" : undefined);
      let result;
      switch (action) {
        case "profile": result = { uid: actor.uid, name: actor.name, email: actor.email, role: actor.role, canTeach: actor.teacher, noPatronymic: actor.noPatronymic,...actor.nameData,...await ownAvatar(db,actor.uid) }; break;
        case "listSubjects": result = await listSubjects(db, actor); break;
        case "saveSubject": result = await saveSubject(db, actor, input); break;
        case "deleteSubject":
          result = await updateOwnSubject(db, actor, id(input.subjectId), { archived_at: new Date().toISOString() });
          break;
        case "joinSubject": result = await changeSubjectMembership(db, actor, input, true); break;
        case "leaveSubject": result = await changeSubjectMembership(db, actor, input, false); break;
        case "listSubjectTeachers": result = await listSubjectTeachers(db, actor, input); break;
        case "getSubjectContent": result = await getSubjectContent(db, actor, input); break;
        case "listMaterials": result = await listMaterials(db, actor, input); break;
        case "createMaterial": result = await createMaterial(db, actor, input); break;
        case "createUpload": result = await createUpload(db, actor, input); break;
        case "deleteItem": result = await deleteItem(db, actor, input); break;
        case "createTest": result = await createTest(db, actor, input); break;
        case "listStudentTests": result = await listTests(db, actor, false); break;
        case "listTeacherTests": result = await listTests(db, actor, true); break;
        case "startStudentTest": result = await startStudentTest(db, actor, input); break;
        case "getStudentAttempt": result = await readStudentAttempt(db, actor, input); break;
        case "listActiveAttempts": result = await listActiveAttempts(db, actor); break;
        case "saveStudentDraft": result = await saveStudentDraft(db, actor, input); break;
        case "submitStudentTest": result = await submitStudentTest(db, actor, input); break;
        case "listResults": result = await listResults(db, actor, input); break;
        case "getResult": result = await getResult(db, actor, input); break;
        case "reviewResult": result = await reviewResult(db, actor, input); break;
        case "listStudents":
          requireRole(actor, true);
          result = await dataOf(db.from("student_profiles").select("name,email").order("created_at"));
          break;
        default: {
          const community = await resultsAction(db, actor, action, input) ?? await communityAction(db, actor, action, input);
          if (!community) invalid("Неизвестное действие.");
          result = community.data;
        }
      }
      return response({ data: result });
    } catch (error) {
      if (error instanceof ApiError) return response({ error: error.message, code: error.code }, error.status);
      console.error(error instanceof Error ? error.message : "Unexpected LMS error");
      return response({ error: "Сервер не смог выполнить запрос. Попробуйте ещё раз.", code: "internal" }, 500);
    }
  };
}
