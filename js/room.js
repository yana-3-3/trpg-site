import { db, rtdb } from "./firebase-config.js";
import { onAuthChange } from "./auth.js";
import { rollDice, rollCoCSkill, detectDiceCommand } from "./dice.js";
import { renderCoC7Sheet, collectSheetData as collectCoC7 } from "./sheet-coc7.js";
import { renderGenericSheet, collectGenericData } from "./sheet-generic.js";
import { MapSystem } from "./map.js";
import {
  doc, getDoc, setDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref, push, onChildAdded, onValue,
  onDisconnect, set, serverTimestamp, query, limitToLast,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
if (!roomCode) {
  alert("잘못된 접근입니다.");
  location.href = "index.html";
}

// ===== DOM 참조 =====
const roomNameEl = document.getElementById("room-name");
const roomCodeEl = document.getElementById("room-code-display");
const systemBadge = document.getElementById("system-badge");
const participantsList = document.getElementById("participants-list");
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send-chat");
const btnBack = document.getElementById("btn-back-lobby");
const btnCopy = document.getElementById("btn-copy-code");
const sheetContainer = document.getElementById("sheet-container");

const mapCanvas = document.getElementById("map-canvas");
const btnAddToken = document.getElementById("btn-add-token");
const btnSetBg = document.getElementById("btn-set-bg");
const btnMapConfig = document.getElementById("btn-map-config");

const bgModal = document.getElementById("bg-modal");
const bgUrlInput = document.getElementById("bg-url-input");
const btnBgConfirm = document.getElementById("btn-bg-confirm");
const btnBgCancel = document.getElementById("btn-bg-cancel");
const btnBgClear = document.getElementById("btn-bg-clear");

const mapConfigModal = document.getElementById("map-config-modal");
const mapColsInput = document.getElementById("map-cols");
const mapRowsInput = document.getElementById("map-rows");
const btnMapConfigConfirm = document.getElementById("btn-map-config-confirm");
const btnMapConfigCancel = document.getElementById("btn-map-config-cancel");

let currentUser = null;
let roomData = null;
let mapSystem = null;
let isGM = false;

// ===== 인증 =====
onAuthChange((user) => {
  if (!user) {
    location.href = "index.html";
    return;
  }
  currentUser = user;
  initRoom();
});

async function initRoom() {
  const roomRef = doc(db, "rooms", roomCode);
  const snap = await getDoc(roomRef);

  if (!snap.exists()) {
    alert("방을 찾을 수 없습니다.");
    location.href = "index.html";
    return;
  }

  roomData = snap.data();
  isGM = roomData.gmId === currentUser.uid;

  roomNameEl.textContent = roomData.name;
  roomCodeEl.textContent = roomCode;
  const systemLabel = { generic: "범용", coc7: "크툴루 7판" }[roomData.system] || roomData.system;
  systemBadge.textContent = systemLabel;

  // GM 전용 UI 표시
  if (!isGM) {
    document.querySelectorAll(".gm-only").forEach(el => el.style.display = "none");
  }

  // 방 메타데이터 실시간 감시
  onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    roomData = snap.data();
    renderParticipants();
  });

  setupPresence();
  setupChat();
  setupSheet();
  setupMap();
  setupMapControls();
}

// ===== 접속 상태 =====
function setupPresence() {
  const presenceRef = ref(rtdb, `rooms/${roomCode}/presence/${currentUser.uid}`);
  const connectedRef = ref(rtdb, ".info/connected");

  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      onDisconnect(presenceRef).set({ online: false, lastSeen: serverTimestamp() });
      set(presenceRef, {
        online: true,
        name: currentUser.displayName || "플레이어",
      });
    }
  });

  const allPresenceRef = ref(rtdb, `rooms/${roomCode}/presence`);
  onValue(allPresenceRef, (snap) => {
    const presence = snap.val() || {};
    renderParticipants(presence);
  });
}

function renderParticipants(presence = {}) {
  if (!roomData) return;
  participantsList.innerHTML = "";
  (roomData.members || []).forEach((uid) => {
    const info = roomData.memberInfo?.[uid] || {};
    const isOnline = presence[uid]?.online;
    const isGMUser = uid === roomData.gmId;
    const li = document.createElement("li");
    if (isGMUser) li.classList.add("is-gm");
    if (isOnline) li.classList.add("is-online");
    li.innerHTML = `
      ${info.photoURL ? `<img class="avatar-sm" src="${info.photoURL}" alt="">` : ""}
      <span>${escapeHtml(info.name || "알 수 없음")}</span>
    `;
    participantsList.appendChild(li);
  });
}

// ===== 채팅 =====
function setupChat() {
  const messagesRef = query(
    ref(rtdb, `rooms/${roomCode}/messages`),
    limitToLast(100)
  );

  onChildAdded(messagesRef, (snap) => {
    appendMessage(snap.val());
  });

  btnSend.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.querySelectorAll(".dice-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendDiceRoll(btn.dataset.roll);
    });
  });
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  const result = detectDiceCommand(text);
  if (result) {
    if (result.kind === "standard") {
      sendStandardRoll(result);
    } else if (result.kind === "coc_skill") {
      sendCoCSkillRoll(result);
    }
  } else {
    pushMessage({
      type: "chat",
      author: currentUser.displayName || "플레이어",
      authorId: currentUser.uid,
      text,
      timestamp: Date.now(),
    });
  }
  chatInput.value = "";
}

function sendDiceRoll(formula) {
  const result = rollDice(formula);
  if (!result) return;
  sendStandardRoll(result);
}

function sendStandardRoll(result) {
  pushMessage({
    type: "dice",
    author: currentUser.displayName || "플레이어",
    authorId: currentUser.uid,
    formula: result.formula,
    rolls: result.rolls,
    modifier: result.modifier,
    total: result.total,
    timestamp: Date.now(),
  });
}

function sendCoCSkillRoll(result) {
  pushMessage({
    type: "coc_skill",
    author: currentUser.displayName || "플레이어",
    authorId: currentUser.uid,
    skillName: result.skillName,
    target: result.target,
    roll: result.roll,
    level: result.level,
    levelLabel: result.levelLabel,
    bonusDice: result.bonusDice,
    penaltyDice: result.penaltyDice,
    thresholds: result.thresholds,
    timestamp: Date.now(),
  });
}

function pushMessage(msg) {
  push(ref(rtdb, `rooms/${roomCode}/messages`), msg);
}

function appendMessage(msg) {
  const div = document.createElement("div");
  const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString("ko-KR", {
    hour: "2-digit", minute: "2-digit",
  });

  if (msg.type === "dice") {
    div.className = "chat-message dice-roll";
    const modStr = msg.modifier
      ? (msg.modifier > 0 ? ` + ${msg.modifier}` : ` - ${Math.abs(msg.modifier)}`)
      : "";
    div.innerHTML = `
      <div class="author">${escapeHtml(msg.author)} <span class="timestamp">${time}</span></div>
      <div class="roll-formula">🎲 ${escapeHtml(msg.formula)}</div>
      <div class="roll-total">${msg.total}</div>
      <div class="roll-detail">[${msg.rolls.join(", ")}]${modStr}</div>
    `;
  } else if (msg.type === "coc_skill") {
    div.className = `chat-message coc-roll coc-${msg.level}`;
    const diceMod = msg.bonusDice ? " · 보너스" : msg.penaltyDice ? " · 페널티" : "";
    div.innerHTML = `
      <div class="author">${escapeHtml(msg.author)} <span class="timestamp">${time}</span></div>
      <div class="coc-skill-name">📘 ${escapeHtml(msg.skillName)} <span class="coc-target">(${msg.target})${diceMod}</span></div>
      <div class="coc-roll-value">${msg.roll}</div>
      <div class="coc-level">${msg.levelLabel}</div>
      <div class="coc-thresholds">
        극단 ${msg.thresholds.extreme} · 어려움 ${msg.thresholds.hard} · 일반 ${msg.thresholds.regular}
      </div>
    `;
  } else if (msg.type === "system") {
    div.className = "chat-message system";
    div.textContent = msg.text;
  } else {
    div.className = "chat-message";
    div.innerHTML = `
      <div class="author">${escapeHtml(msg.author)} <span class="timestamp">${time}</span></div>
      <div>${escapeHtml(msg.text)}</div>
    `;
  }

  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ===== 캐릭터 시트 =====
async function setupSheet() {
  const sheetRef = doc(db, "rooms", roomCode, "sheets", currentUser.uid);
  const snap = await getDoc(sheetRef);
  const data = snap.exists() ? snap.data() : null;

  const onSave = async (sheetData) => {
    try {
      await setDoc(sheetRef, {
        ...sheetData,
        ownerId: currentUser.uid,
        updatedAt: Date.now(),
      });
      const btn = sheetContainer.querySelector("#btn-save-sheet");
      if (btn) {
        btn.textContent = "저장됨 ✓";
        setTimeout(() => (btn.textContent = "💾 저장"), 1500);
      }
    } catch (err) {
      console.error("시트 저장 실패:", err);
      alert("저장에 실패했습니다.");
    }
  };

  const onRollSkill = ({ target, name, bonusDice, penaltyDice }) => {
    const result = rollCoCSkill(target, name, bonusDice, penaltyDice);
    sendCoCSkillRoll(result);
  };

  if (roomData.system === "coc7") {
    renderCoC7Sheet(sheetContainer, data, { onSave, onRollSkill });
  } else {
    renderGenericSheet(sheetContainer, data, { onSave });
  }
}

// ===== 맵 =====
function setupMap() {
  mapSystem = new MapSystem({
    canvas: mapCanvas,
    roomCode,
    currentUser,
    isGM,
  });
}

function setupMapControls() {
  btnAddToken?.addEventListener("click", () => {
    const name = prompt("토큰 이름을 입력하세요:", currentUser.displayName?.slice(0, 10) || "토큰");
    if (name === null) return;
    mapSystem.addToken({ name: name || "토큰" });
  });

  // GM: 배경 이미지 설정
  btnSetBg?.addEventListener("click", () => {
    bgUrlInput.value = mapSystem.mapConfig.backgroundUrl || "";
    bgModal.classList.remove("hidden");
  });
  btnBgCancel?.addEventListener("click", () => bgModal.classList.add("hidden"));
  btnBgClear?.addEventListener("click", async () => {
    await mapSystem.setMapConfig({ backgroundUrl: null });
    bgModal.classList.add("hidden");
  });
  btnBgConfirm?.addEventListener("click", async () => {
    const url = bgUrlInput.value.trim();
    await mapSystem.setMapConfig({ backgroundUrl: url || null });
    bgModal.classList.add("hidden");
  });

  // GM: 맵 크기
  btnMapConfig?.addEventListener("click", () => {
    mapColsInput.value = mapSystem.mapConfig.cols;
    mapRowsInput.value = mapSystem.mapConfig.rows;
    mapConfigModal.classList.remove("hidden");
  });
  btnMapConfigCancel?.addEventListener("click", () => mapConfigModal.classList.add("hidden"));
  btnMapConfigConfirm?.addEventListener("click", async () => {
    const cols = Math.max(5, Math.min(80, parseInt(mapColsInput.value, 10) || 20));
    const rows = Math.max(5, Math.min(80, parseInt(mapRowsInput.value, 10) || 15));
    await mapSystem.setMapConfig({ cols, rows });
    mapConfigModal.classList.add("hidden");
  });
}

// ===== 공통 =====
btnBack.addEventListener("click", () => {
  location.href = "index.html";
});

btnCopy.addEventListener("click", () => {
  navigator.clipboard.writeText(roomCode);
  btnCopy.textContent = "복사됨 ✓";
  setTimeout(() => (btnCopy.textContent = "코드 복사"), 1500);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
