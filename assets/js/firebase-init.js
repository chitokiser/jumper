// /assets/js/firebase-init.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/*
  config 로딩 우선순위
  1) window.firebaseConfig (head에서 주입한 경우)
  2) /assets/js/firebase-config.js (있는 경우)
  3) 아래 FALLBACK (마지막 수단)
*/

const FALLBACK = {
apiKey: "AIzaSyBETZfUgG4y0YAiYuxSVhwnhpwzVUQ59EI",
authDomain: "experience-factory-4e167.firebaseapp.com",
projectId: "experience-factory-4e167",
storageBucket: "experience-factory-4e167.firebasestorage.app",
messagingSenderId: "142042867302",
appId: "1:142042867302:web:7689eca32aaee5d189efa7",
};

async function loadConfig() {
  // 1) window.firebaseConfig
  if (typeof window !== "undefined" && window.firebaseConfig && window.firebaseConfig.projectId) {
    return window.firebaseConfig;
  }

  // 2) optional config module (파일 없으면 404가 나더라도 정상 진행)
  try {
    const mod = await import("/assets/js/firebase-config.js");
    if (mod?.firebaseConfig?.projectId) return mod.firebaseConfig;
  } catch (e) {
    // 파일이 없거나(404) 로딩 실패해도 무시하고 FALLBACK 사용
    console.warn("[firebase-init] firebase-config.js not found, using FALLBACK.");
  }

  // 3) fallback
  return FALLBACK;
}

const firebaseConfig = await loadConfig();

// 앱 중복 초기화 방지
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

// 여기서 “반드시 export” 해줘야 auth.js가 가져올 수 있음
const googleProvider = new GoogleAuthProvider();

export { app, auth, db, googleProvider };
