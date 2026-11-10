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

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
firebase.initializeApp(isLocal ? {
  apiKey: 'demo-key',
  authDomain: 'demo-lms-platform.firebaseapp.com',
  projectId: 'demo-lms-platform',
  storageBucket: 'demo-lms-platform.appspot.com'
} : firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
const functions = firebase.functions();

if (isLocal) {
  auth.useEmulator('http://127.0.0.1:9099');
  db.useEmulator('127.0.0.1', 8080);
  storage.useEmulator('127.0.0.1', 9199);
  functions.useEmulator('127.0.0.1', 5001);
}

async function getProfile(account, registrationName) {
  const profileRef = db.collection('users').doc(account.uid);
  const approval = await db.collection('teachers').doc(account.uid).get({ source: 'server' });
  const role = approval.exists ? 'teacher' : 'student';
  const profile = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(profileRef);
    if (!snapshot.exists) {
      const name = (registrationName || account.displayName || account.email.split('@')[0]).slice(0, 120);
      transaction.set(profileRef, {
        name,
        email: account.email,
        role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { name };
    }
    if (snapshot.get('role') !== role) transaction.update(profileRef, { role });
    return snapshot.data();
  });
  return { uid: account.uid, name: profile.name, role };
}

function cabinetPage(role) {
  return role === 'teacher' ? 'teacher.html' : 'student.html';
}

function showStatus(message) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.hidden = !message;
}

function watchCabinet(role, onReady) {
  auth.onAuthStateChanged(async (account) => {
    if (!account) {
      location.replace('index.html');
      return;
    }
    try {
      const profile = await getProfile(account);
      if (auth.currentUser?.uid !== account.uid) return;
      if (profile.role !== role) {
        location.replace(cabinetPage(profile.role));
        return;
      }
      document.getElementById('userName').textContent = profile.name;
      document.querySelector('main').hidden = false;
      await onReady(profile);
    } catch (error) {
      showStatus('Не удалось открыть кабинет. ' + error.message);
    }
  });
}

async function logout() {
  try {
    await auth.signOut();
  } catch (error) {
    showStatus('Не удалось выйти. ' + error.message);
  }
}

async function callFunction(name, data) {
  const response = await functions.httpsCallable(name)(data);
  return response.data;
}

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);
}

function materialLink(url, label) {
  try {
    const link = new URL(url);
    if (link.protocol === 'https:' || (isLocal && link.hostname === '127.0.0.1')) {
      return '<a href="' + escapeHtml(link.href) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
    }
  } catch {
    return '';
  }
  return '';
}
