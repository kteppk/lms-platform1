import type { SupabaseClient } from "npm:@supabase/supabase-js@2.89.0";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.3";

const project = "students-70392";
const firebaseKeys = createRemoteJWKSet(new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
));
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const graceMs = 15000;
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

type Input = Record<string, unknown>;
type Identity = { uid: string; email: string; name?: string };
type Actor = Identity & { name: string; teacher: boolean };
type Kind = "lectures" | "books";
type Question = { type: "text" | "photo"; text: string } |
  { type: "choice"; text: string; options: string[]; correct: number };
type Test = { id: string; title: string; teacher_name: string; timer: number; questions: Question[] };

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function invalid(message: string): never {
  throw new ApiError(400, "invalid-argument", message);
}

function missing(message: string): never {
  throw new ApiError(404, "not-found", message);
}

function deadline(): never {
  throw new ApiError(409, "deadline-exceeded", "Время на прохождение теста истекло.");
}

function requireRole(actor: Actor, teacher: boolean) {
  if (actor.teacher !== teacher) throw new ApiError(403, "permission-denied", "Недостаточно прав.");
}

function record(value: unknown): Input {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Некорректные данные.");
  return value as Input;
}

function id(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) invalid("Некорректный идентификатор.");
  return value;
}

function materialKind(value: unknown): Kind {
  if (value !== "lectures" && value !== "books") invalid("Неизвестный тип материала.");
  return value;
}

function text(value: unknown, limit: number, field: string, optional = false): string {
  if (typeof value !== "string" || value.length > limit || (!optional && !value.trim())) {
    invalid(`${field}: укажите текст длиной до ${limit} символов.`);
  }
  return value.trim();
}

async function dataOf<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
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
  const [existing, teacher] = await Promise.all([
    dataOf(db.from("profiles").select("name").eq("id", uid).maybeSingle()),
    dataOf(db.from("teachers").select("user_id").eq("user_id", uid).maybeSingle()),
  ]);
  if (!existing && registrationName === undefined) {
    throw new ApiError(403, "permission-denied", "Сначала откройте профиль.");
  }
  const name = existing?.name ?? (
    (typeof registrationName === "string" && registrationName.trim()) ||
    identity.name?.trim() || email.split("@")[0] || "Пользователь"
  ).slice(0, 120);
  if (!existing) {
    await dataOf(db.from("profiles").upsert({ id: uid, name, email }, { onConflict: "id", ignoreDuplicates: true }));
    const stored = await dataOf(db.from("profiles").select("name").eq("id", uid).single());
    if (!stored) throw new Error("Missing profile");
    return { ...identity, name: stored.name, teacher: Boolean(teacher) };
  }
  return { ...identity, name, teacher: Boolean(teacher) };
}

function ownedPath(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.startsWith(prefix) && idPattern.test(value.slice(prefix.length));
}

function storagePath(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

async function getAttempt(db: SupabaseClient, actor: Actor, attemptId: string) {
  const attempt = await dataOf(db.from("test_attempts").select("id,test_id,expires_at")
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
    const result = await dataOf(db.from("test_results").select("id").eq("id", attempt.id).maybeSingle());
    if (result) missing("Попытка уже завершена.");
    if (attempt.expires_at && Date.now() > Date.parse(attempt.expires_at)) deadline();
    folder += attempt.id + "/";
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
  let query = db.from("materials").select("id,title,teacher_name,body,author,files,created_at").eq("kind", kind);
  if (mine) query = query.eq("teacher_id", actor.uid);
  const rows = (await dataOf(query.order("created_at", { ascending: false }))) ?? [];

  const paths = mine ? [] : [...new Set(rows.flatMap((row) => row.files as string[]))];
  const links = new Map<string, string>();
  if (paths.length) {
    const signed = await dataOf(db.storage.from(uploads[kind].bucket).createSignedUrls(paths, 3600, { download: true }));
    for (const file of signed ?? []) {
      if (file.path && file.signedUrl && !file.error) links.set(file.path, storagePath(file.signedUrl));
    }
  }
  return rows.map((row) => {
    const files: string[] = mine ? row.files : row.files.map((path: string) => links.get(path)).filter(Boolean);
    return {
      id: row.id, title: row.title, teacherName: row.teacher_name, createdAt: row.created_at,
      ...(kind === "lectures" ? { text: row.body, files } :
        { author: row.author, description: row.body, fileUrl: files[0] || "" }),
    };
  });
}

async function createMaterial(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, true);
  const kind = materialKind(input.kind);
  const title = text(input.title, 300, "Название");
  const body = kind === "lectures" ? text(input.text, 100000, "Текст лекции") :
    text(input.description, 100000, "Описание", true);
  const author = kind === "books" ? text(input.author, 300, "Автор") : null;
  const files = input.files;
  if (!Array.isArray(files) || files.length > (kind === "books" ? 1 : 20) ||
      files.some((path) => !ownedPath(path, actor.uid + "/")) || new Set(files).size !== files.length) {
    invalid("Некорректный список вложений.");
  }
  const bucket = db.storage.from(uploads[kind].bucket);
  const exists = await Promise.all(files.map((path) => dataOf(bucket.exists(path))));
  if (exists.some((value) => !value)) invalid("Вложение ещё не загружено.");

  return await dataOf(db.from("materials").insert({
    kind, title, body, author, files, teacher_id: actor.uid, teacher_name: actor.name,
  }).select("id").single());
}

async function deleteItem(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, true);
  const itemId = id(input.id);
  if (input.kind === "tests") {
    await dataOf(db.from("tests").delete().eq("id", itemId).eq("teacher_id", actor.uid));
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
    questionCount: test.questions.length, timer: test.timer,
  };
}

async function createTest(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, true);
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
    title, timer, questions: clean, teacher_id: actor.uid, teacher_name: actor.name,
  }).select("id").single());
}

async function listTests(db: SupabaseClient, actor: Actor, mine: boolean) {
  requireRole(actor, mine);
  let query = db.from("tests").select("id,title,teacher_name,timer,questions");
  if (mine) query = query.eq("teacher_id", actor.uid);
  const rows = (await dataOf(query.order("created_at", { ascending: false }))) ?? [];
  return rows.map(testSummary);
}

async function getTest(db: SupabaseClient, testId: string): Promise<Test> {
  const test = await dataOf(db.from("tests").select("id,title,teacher_name,timer,questions")
    .eq("id", testId).maybeSingle());
  if (!test) missing("Тест недоступен.");
  return test;
}

async function startStudentTest(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, false);
  const test = await getTest(db, id(input.testId));
  const expiresAt = test.timer ? Date.now() + test.timer * 60000 : null;
  const attempt = await dataOf(db.from("test_attempts").insert({
    test_id: test.id, student_id: actor.uid,
    expires_at: expiresAt === null ? null : new Date(expiresAt).toISOString(),
  }).select("id").single());
  if (!attempt) throw new Error("Missing test attempt");
  const questions = test.questions.map((question) => question.type === "choice" ?
    { type: question.type, text: question.text, options: question.options } :
    { type: question.type, text: question.text });
  return {
    ...testSummary(test), attemptId: attempt.id, questions,
    remainingMs: expiresAt === null ? null : Math.max(0, expiresAt - Date.now()),
  };
}

async function submitStudentTest(db: SupabaseClient, actor: Actor, input: Input) {
  requireRole(actor, false);
  const receivedAt = new Date();
  const attemptId = id(input.attemptId);
  const answers = record(input.answers);
  const attempt = await getAttempt(db, actor, attemptId);
  const previous = await dataOf(db.from("test_results").select("score,total,percentage")
    .eq("id", attemptId).eq("student_id", actor.uid).maybeSingle());
  if (previous) return previous;
  if (attempt.expires_at && +receivedAt > Date.parse(attempt.expires_at) + graceMs) deadline();

  const { questions } = await getTest(db, attempt.test_id);
  const photos: string[] = [];
  const prefix = actor.uid + "/" + attemptId + "/";
  for (const [key, value] of Object.entries(answers)) {
    const index = Number(key);
    const question = questions[index];
    if (!Number.isInteger(index) || String(index) !== key || !question) {
      invalid("Ответ относится к неизвестному вопросу.");
    }
    if (question.type === "choice" && typeof value === "number" && Number.isInteger(value) &&
        value >= 0 && value < question.options.length) continue;
    if (question.type === "text" && typeof value === "string" && value.length <= 5000) continue;
    if (question.type === "photo" && ownedPath(value, prefix)) {
      photos.push(value);
      continue;
    }
    invalid("Некорректный ответ на вопрос №" + (index + 1) + ".");
  }
  const exists = await Promise.all(photos.map((path) => dataOf(db.storage.from(uploads.photo.bucket).exists(path))));
  if (exists.some((value) => !value)) invalid("Фото ещё не загружено.");

  const { data, error } = await db.rpc("submit_test_attempt", {
    p_attempt_id: attemptId, p_student_id: actor.uid, p_answers: answers, p_received_at: receivedAt.toISOString(),
  });
  if (error?.code === "P0001") deadline();
  if (error?.code === "P0002") missing(error.message);
  if (error) throw new Error(error.message);
  return data;
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
      const actor = await getActor(db, identity, action === "profile" ? input.name ?? "" : undefined);
      let result;
      switch (action) {
        case "profile": result = { uid: actor.uid, name: actor.name, role: actor.teacher ? "teacher" : "student" }; break;
        case "listMaterials": result = await listMaterials(db, actor, input); break;
        case "createMaterial": result = await createMaterial(db, actor, input); break;
        case "createUpload": result = await createUpload(db, actor, input); break;
        case "deleteItem": result = await deleteItem(db, actor, input); break;
        case "createTest": result = await createTest(db, actor, input); break;
        case "listStudentTests": result = await listTests(db, actor, false); break;
        case "listTeacherTests": result = await listTests(db, actor, true); break;
        case "startStudentTest": result = await startStudentTest(db, actor, input); break;
        case "submitStudentTest": result = await submitStudentTest(db, actor, input); break;
        case "listStudents":
          requireRole(actor, true);
          result = await dataOf(db.from("student_profiles").select("name,email").order("created_at"));
          break;
        default: invalid("Неизвестное действие.");
      }
      return response({ data: result });
    } catch (error) {
      if (error instanceof ApiError) return response({ error: error.message, code: error.code }, error.status);
      console.error(error instanceof Error ? error.message : "Unexpected LMS error");
      return response({ error: "Сервер не смог выполнить запрос. Попробуйте ещё раз.", code: "internal" }, 500);
    }
  };
}
