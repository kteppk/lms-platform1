# LMS Platform

Платформа для преподавателей и студентов с возможностью загрузки материалов и создания тестов.

## 🚀 Развёртывание

### 1. Настройка Firebase

1. Перейди на https://console.firebase.google.com/
2. Создай новый проект
3. Включи Authentication → Email/Password
4. Создай Firestore Database (в режиме production)
5. Создай Storage
6. В настройках проекта → "Веб-приложение" → скопируй конфигурацию
7. Вставь её в `firebase-config.js`

### 2. Правила безопасности Firestore

В Firebase Console → Firestore → Rules вставь:
