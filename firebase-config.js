// firebase-config.js

// Твоя реальная конфигурация проекта students-70392
const firebaseConfig = {
  apiKey: "AIzaSyD5a1543rVIbV7e9RFFuvk3QUHp4ATDsMA",
  authDomain: "students-70392.firebaseapp.com",
  projectId: "students-70392",
  storageBucket: "students-70392.firebasestorage.app",
  messagingSenderId: "117845681705",
  appId: "1:117845681705:web:ee3d82e0a696394210de38",
  measurementId: "G-7JT7TEDNB5"
};

// Инициализация Firebase (используем глобальный объект firebase из compat-скриптов)
firebase.initializeApp(firebaseConfig);

// Инициализация сервисов
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();