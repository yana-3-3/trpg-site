// Firebase SDK v10+ (CDN, ES Module 방식)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ⚠️ Firebase 콘솔에서 발급받은 설정으로 교체하세요.
// Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱 → SDK 설정
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "XXXXXXXXXX",
  appId: "1:XXXXXXXXXX:web:XXXXXXXXXX",
  // Realtime Database를 사용할 경우에만 필요
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
};

const app = initializeApp(firebaseConfig);

// 서비스 export
export const auth = getAuth(app);
export const db = getFirestore(app);   // 캐릭터 시트, 방 메타데이터용
export const rtdb = getDatabase(app);  // 실시간 채팅 및 접속 상태용

export default app;
