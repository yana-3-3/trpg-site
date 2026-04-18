// Firebase SDK v10+ (CDN, ES Module 방식)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ⚠️ Firebase 콘솔에서 발급받은 설정으로 교체하세요.
// Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱 → SDK 설정
const firebaseConfig = {
  apiKey: "AIzaSyARuT4SCUQxqrBjgHxm6MSG6burfDf05wo",
  authDomain: "trpg-site-4324e.firebaseapp.com",
  databaseURL: "https://trpg-site-4324e-default-rtdb.firebaseio.com",
  projectId: "trpg-site-4324e",
  storageBucket: "trpg-site-4324e.firebasestorage.app",
  messagingSenderId: "488120799378",
  appId: "1:488120799378:web:c947c903e4c2e6b1df164b",
};

const app = initializeApp(firebaseConfig);

// 서비스 export
export const auth = getAuth(app);
export const db = getFirestore(app);   // 캐릭터 시트, 방 메타데이터용
export const rtdb = getDatabase(app);  // 실시간 채팅 및 접속 상태용

export default app;
