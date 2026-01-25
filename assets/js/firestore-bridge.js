// /assets/js/firestore-bridge.js
// Firestore 모듈 브릿지
// - firebase-init.js는 app/auth/db의 단일 진실 원천(SSOT)
// - pages/* 에서는 여기서 db + Firestore 함수들을 import 해서 사용

export { auth, db } from "/assets/js/firebase-init.js";

export {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
