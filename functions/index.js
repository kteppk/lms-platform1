const { initializeApp } = require('firebase-admin/app');
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore');
const { HttpsError, onCall } = require('firebase-functions/v2/https');

initializeApp();
const db = getFirestore();
const callableOptions = { maxInstances: 5 };
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const submissionGraceMs = 15000;

function invalid(message) {
  throw new HttpsError('invalid-argument', message);
}

function documentId(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) {
    invalid('Некорректный идентификатор.');
  }
  return value;
}

function requiredText(value, limit, message) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    invalid(message);
  }
  return value.trim();
}

async function requireActor(request, role) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Войдите в аккаунт.');
  }
  const uid = request.auth.uid;
  const [profile, teacher] = await db.getAll(
    db.collection('users').doc(uid),
    db.collection('teachers').doc(uid)
  );
  if (!profile.exists || teacher.exists !== (role === 'teacher')) {
    throw new HttpsError('permission-denied', 'Недостаточно прав.');
  }
  return { uid, name: profile.get('name') };
}

function testSummary(snapshot) {
  const test = snapshot.data();
  return {
    id: snapshot.id,
    title: test.title,
    teacherName: test.teacherName,
    questionCount: test.questions.length,
    timer: Number.isSafeInteger(test.timer) && test.timer > 0 ? Math.min(test.timer, 1440) : 0
  };
}

exports.createTest = onCall(callableOptions, async (request) => {
  const teacher = await requireActor(request, 'teacher');
  const { title, timer, questions } = request.data ?? {};
  const cleanTitle = requiredText(title, 200, 'Укажите название теста до 200 символов.');
  if (!Number.isInteger(timer) || timer < 0 || timer > 1440) {
    invalid('Таймер должен быть целым числом от 0 до 1440 минут.');
  }
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 100) {
    invalid('Добавьте от 1 до 100 вопросов.');
  }
  const cleanQuestions = questions.map((question) => {
    const { type, text, options, correct } = question ?? {};
    const cleanText = requiredText(text, 2000, 'Укажите текст вопроса до 2000 символов.');
    if (type === 'text' || type === 'photo') return { type, text: cleanText };
    if (type !== 'choice' || !Array.isArray(options) || options.length !== 4 ||
        !Number.isInteger(correct) || correct < 0 || correct >= options.length) {
      invalid('Для вопроса с выбором укажите четыре варианта и правильный вариант.');
    }
    const cleanOptions = options.map((option) =>
      requiredText(option, 500, 'Заполните каждый вариант ответа (до 500 символов).')
    );
    return { type, text: cleanText, options: cleanOptions, correct };
  });
  if (Buffer.byteLength(JSON.stringify(cleanQuestions), 'utf8') > 900000) {
    invalid('Текст теста слишком большой.');
  }
  const test = await db.collection('tests').add({
    teacherId: teacher.uid,
    teacherName: teacher.name,
    title: cleanTitle,
    timer,
    questions: cleanQuestions,
    createdAt: FieldValue.serverTimestamp()
  });
  return { id: test.id };
});

exports.listStudentTests = onCall(callableOptions, async (request) => {
  await requireActor(request, 'student');
  const tests = await db.collection('tests').orderBy('createdAt', 'desc').get();
  return tests.docs.filter((doc) => Array.isArray(doc.get('questions'))).map(testSummary);
});

exports.startStudentTest = onCall(callableOptions, async (request) => {
  const student = await requireActor(request, 'student');
  const testId = documentId(request.data?.testId);
  const snapshot = await db.collection('tests').doc(testId).get();
  if (!snapshot.exists || !Array.isArray(snapshot.get('questions'))) {
    throw new HttpsError('not-found', 'Тест недоступен.');
  }
  const summary = testSummary(snapshot);
  const expiresAt = summary.timer ? Date.now() + summary.timer * 60000 : null;
  const attempt = await db.collection('test_attempts').add({
    testId,
    studentId: student.uid,
    expiresAt: expiresAt === null ? null : Timestamp.fromMillis(expiresAt)
  });
  const questions = snapshot.get('questions').map(({ type, text, options }) =>
    type === 'choice' ? { type, text, options } : { type, text }
  );
  const remainingMs = expiresAt === null ? null : Math.max(0, expiresAt - Date.now());
  return { ...summary, attemptId: attempt.id, remainingMs, questions };
});

function validateAnswers(questions, answers, uid, attemptId) {
  const photoPrefix = 'test_answers/' + uid + '/' + attemptId + '/';
  const cleaned = {};
  for (const [key, value] of Object.entries(answers)) {
    const index = Number(key);
    const question = questions[index];
    if (String(index) !== key || !Number.isInteger(index) || !question) {
      invalid('Ответ относится к неизвестному вопросу.');
    }
    if (question.type === 'choice' && Number.isInteger(value) &&
        value >= 0 && value < question.options.length) {
      cleaned[key] = value;
    } else if (question.type === 'text' && typeof value === 'string' && value.length <= 5000) {
      cleaned[key] = value;
    } else if (question.type === 'photo' && typeof value === 'string' &&
        value.startsWith(photoPrefix) && idPattern.test(value.slice(photoPrefix.length))) {
      cleaned[key] = value;
    } else {
      invalid('Некорректный ответ на вопрос №' + (index + 1) + '.');
    }
  }
  return cleaned;
}

exports.submitStudentTest = onCall(callableOptions, async (request) => {
  const student = await requireActor(request, 'student');
  const attemptId = documentId(request.data?.attemptId);
  const answers = request.data?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    invalid('Некорректный формат ответов.');
  }
  const submittedAt = Date.now();
  const attemptRef = db.collection('test_attempts').doc(attemptId);
  const resultRef = db.collection('test_results').doc(attemptId);

  return db.runTransaction(async (transaction) => {
    const [attempt, result] = await transaction.getAll(attemptRef, resultRef);
    if (result.exists && result.get('studentId') === student.uid) {
      const { score, total, percentage } = result.data();
      return { score, total, percentage };
    }
    if (!attempt.exists || attempt.get('studentId') !== student.uid || result.exists) {
      throw new HttpsError('not-found', 'Попытка недоступна.');
    }
    const expiresAt = attempt.get('expiresAt');
    if (expiresAt && submittedAt > expiresAt.toMillis() + submissionGraceMs) {
      throw new HttpsError('deadline-exceeded', 'Время на прохождение теста истекло.');
    }
    const testId = attempt.get('testId');
    const test = await transaction.get(db.collection('tests').doc(testId));
    if (!test.exists) throw new HttpsError('not-found', 'Тест удалён.');
    const { title, teacherId, questions } = test.data();
    const cleanAnswers = validateAnswers(questions, answers, student.uid, attemptId);
    const score = questions.filter((question, index) =>
      question.type === 'choice' && Number.isInteger(question.correct) &&
      cleanAnswers[index] === question.correct
    ).length;
    const total = questions.length;
    const percentage = total ? Math.round(score / total * 100) : 0;
    transaction.create(resultRef, {
      testId,
      testTitle: title,
      teacherId,
      studentId: student.uid,
      studentName: student.name,
      answers: cleanAnswers,
      score,
      total,
      percentage,
      submittedAt: FieldValue.serverTimestamp()
    });
    transaction.delete(attemptRef);
    return { score, total, percentage };
  });
});
