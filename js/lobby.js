import { db } from "./firebase-config.js";
import { onAuthChange } from "./auth.js";
import {
  collection, doc, setDoc, getDoc, updateDoc,
  query, where, onSnapshot, serverTimestamp, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const authSection = document.getElementById("auth-section");
const lobbySection = document.getElementById("lobby-section");
const userNameDisplay = document.getElementById("user-display-name");
const userAvatar = document.getElementById("user-avatar");
const myRoomsList = document.getElementById("my-rooms-list");

const btnCreateRoom = document.getElementById("btn-create-room");
const btnJoinRoom = document.getElementById("btn-join-room");
const joinRoomInput = document.getElementById("join-room-id");

const createModal = document.getElementById("create-room-modal");
const newRoomName = document.getElementById("new-room-name");
const newRoomSystem = document.getElementById("new-room-system");
const btnCreateConfirm = document.getElementById("btn-create-confirm");
const btnCreateCancel = document.getElementById("btn-create-cancel");

let currentUser = null;
let unsubscribeRooms = null;

onAuthChange((user) => {
  currentUser = user;
  if (user) {
    authSection?.classList.add("hidden");
    lobbySection?.classList.remove("hidden");
    userNameDisplay.textContent = user.displayName || "플레이어";
    if (user.photoURL) {
      userAvatar.src = user.photoURL;
      userAvatar.style.display = "inline-block";
    }
    watchMyRooms(user.uid);
  } else {
    authSection?.classList.remove("hidden");
    lobbySection?.classList.add("hidden");
    if (unsubscribeRooms) unsubscribeRooms();
  }
});

function generateRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

btnCreateRoom?.addEventListener("click", () => {
  createModal.classList.remove("hidden");
  newRoomName.focus();
});

btnCreateCancel?.addEventListener("click", () => {
  createModal.classList.add("hidden");
});

btnCreateConfirm?.addEventListener("click", async () => {
  const name = newRoomName.value.trim();
  const system = newRoomSystem.value;
  if (!name) return alert("방 이름을 입력해주세요.");
  if (!currentUser) return;

  const code = generateRoomCode();
  const roomRef = doc(db, "rooms", code);

  try {
    await setDoc(roomRef, {
      code,
      name,
      system,
      gmId: currentUser.uid,
      members: [currentUser.uid],
      memberInfo: {
        [currentUser.uid]: {
          name: currentUser.displayName || "플레이어",
          photoURL: currentUser.photoURL || "",
          joinedAt: Date.now(),
        },
      },
      createdAt: serverTimestamp(),
    });
    createModal.classList.add("hidden");
    newRoomName.value = "";
    location.href = `room.html?code=${code}`;
  } catch (err) {
    console.error("방 생성 실패:", err);
    alert("방 생성에 실패했습니다. Firebase 설정을 확인하세요.");
  }
});

btnJoinRoom?.addEventListener("click", async () => {
  const code = joinRoomInput.value.trim().toUpperCase();
  if (!code) return alert("방 코드를 입력해주세요.");
  if (!currentUser) return;

  const roomRef = doc(db, "rooms", code);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) return alert("해당 방을 찾을 수 없습니다.");

  const data = snap.data();
  if (!data.members.includes(currentUser.uid)) {
    await updateDoc(roomRef, {
      members: arrayUnion(currentUser.uid),
      [`memberInfo.${currentUser.uid}`]: {
        name: currentUser.displayName || "플레이어",
        photoURL: currentUser.photoURL || "",
        joinedAt: Date.now(),
      },
    });
  }
  location.href = `room.html?code=${code}`;
});

function watchMyRooms(uid) {
  const q = query(collection(db, "rooms"), where("members", "array-contains", uid));
  unsubscribeRooms = onSnapshot(q, (snap) => {
    if (snap.empty) {
      myRoomsList.innerHTML = '<li class="empty">아직 참여한 방이 없습니다.</li>';
      return;
    }
    myRoomsList.innerHTML = "";
    snap.forEach((docSnap) => {
      const room = docSnap.data();
      const systemLabel = { generic: "범용", coc7: "크툴루 7판" }[room.system] || room.system;
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <div class="room-title">${escapeHtml(room.name)}</div>
          <div class="room-code">${room.code} · ${systemLabel}${room.gmId === uid ? " · 👑 GM" : ""}</div>
        </div>
        <button class="btn btn-small btn-primary">입장</button>
      `;
      li.addEventListener("click", () => {
        location.href = `room.html?code=${room.code}`;
      });
      myRoomsList.appendChild(li);
    });
  }, (err) => {
    console.error("방 목록 조회 실패:", err);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
