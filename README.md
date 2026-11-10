# LMS Platform

GitHub Pages публикует HTML и JavaScript. Вход и регистрация используют Firebase Authentication проекта `students-70392`. Supabase хранит профили, материалы, тесты и вложения. Edge Function `lms` проверяет токен Firebase и выдаёт данные в соответствии с ролью. PostgreSQL сохраняет результат теста одной транзакцией.

## Публикация

1. Создайте проект Supabase на тарифе **Free**. Войдите в Supabase CLI и узнайте идентификатор проекта.

```powershell
supabase login
supabase projects list
supabase link --project-ref PROJECT_REF
supabase db push --remote --yes
supabase functions deploy lms --remote=PROJECT_REF --use-api --yes
```

2. В `firebase-config.js` укажите публичный URL проекта `https://PROJECT_REF.supabase.co` в `supabaseProjectUrl`. Секретные ключи предоставляет среда Edge Function.
3. В репозитории GitHub проверьте **Settings → Pages → Deploy from a branch → main → /(root)**. Отправьте изменения в `main` и дождитесь развёртывания. [LMS на GitHub Pages](https://kteppk.github.io/lms-platform1/)

## Роли и файлы

При первом входе создаётся профиль студента. Чтобы назначить преподавателя, откройте таблицу `profiles` в Supabase, найдите ID его профиля и добавьте этот ID в `teachers.user_id`. Новый вход или перезагрузка страницы применит роль. Чтобы отозвать доступ, удалите запись из `teachers`.

Лекции и книги доступны вошедшим пользователям. Вложения хранятся в закрытых бакетах и скачиваются по ссылкам с ограниченным сроком действия. Один учебный файл может занимать до 50 МБ, фотоответ — до 10 МБ. На одну лекцию можно прикрепить до 20 файлов.

Студенты получают вопросы без ключей ответов. При повторной отправке той же попытки сервер возвращает уже сохранённый результат. Автоматически засчитываются ответы с выбором варианта, а в знаменателе учитываются все вопросы.

## Локальный запуск

Запустите Supabase CLI с Docker и примените миграцию к локальной базе.

```powershell
supabase start
supabase db reset
supabase functions serve lms
```

Раздайте корень репозитория по HTTP, например `python -m http.server 8000 --bind 127.0.0.1`. При открытии [локального сайта](http://127.0.0.1:8000/) данные и файлы идут в локальный Supabase, а вход использует Firebase Auth проекта `students-70392`.
