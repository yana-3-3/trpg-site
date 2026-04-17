import { auth } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const googleProvider = new GoogleAuthProvider();

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (err) {
    console.error("Google 로그인 실패:", err);
    alert("Google 로그인에 실패했습니다: " + err.message);
  }
}

export async function logout() {
  await signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// DOM 이벤트 바인딩 (로비 페이지에서만)
if (document.getElementById("auth-section")) {
  const btnGoogle = document.getElementById("btn-google-login");
  const btnLogout = document.getElementById("btn-logout");

  btnGoogle?.addEventListener("click", loginWithGoogle);
  btnLogout?.addEventListener("click", logout);
}
