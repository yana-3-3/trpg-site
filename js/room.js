import { db, rtdb } from "./firebase-config.js";
import { onAuthChange } from "./auth.js";
import { rollDice, rollCoCSkill, detectDiceCommand } from "./dice.js";
import { renderCoC7Sheet } from "./sheet-coc7.js";
import { renderGenericSheet } from "./sheet-generic.js";
import { MapSystem } from "./map.js";
import { CharacterManager, openCharacterEditor } from "./characters.js";
import { BGMSystem, openBGMControlModal, createBGMPlayerControl } from "./bgm.js";
import { openExportModal } from "./export-log.js";
import {
  doc, getDoc, setDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  ref, push, onChildAdded, onValue,
  onDisconnect, set, serverTimestamp, query, limitToLast,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ===== URL 파싱 =====
const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
if (!roomCode) {
  alert("잘못된 접근입니다.");
  location.href = "index.html";
}

// ===== DOM 참조 =====
const $ = (id) => document.getElementById(id);

const roomNameEl = $("room-name");
const roomCodeEl = $("room-code-display");
const systemBadge = $("system-badge");
const participantsList = $("participants-list");
const chatLog = $("chat-log");
const chatInput = $("chat-input");

const btnSend = $("btn-send-chat");
const btnBack = $("btn-back-lobby");
const btnCopy = $("btn-copy-code");
const btnToggleParticipants = $("btn-toggle-participants");
const btnToggleSheet = $("btn-toggle-sheet");
const btnOpenLog = $("btn-open-log");
const btnCloseLog = $("btn-close-log");
const logModal = $("log-modal");

const sheetContainer = $("sheet-container");
const mapCanvas = $("map-canvas");
const btnAddToken = $("btn-add-token");
const btnSetBg = $("btn-set-bg");
const btnMapConfig = $("btn-map-config");

// 캐릭터 선택기
const btnCharMenu = $("btn-char-menu");
const charCurrentImg = $("char-current-img");
const charCurrentName = $("char-current-name");
const charDropdown = $("char-dropdown");
const expressionStrip = $("expression-strip");

// BGM / 내보내기
const bgmControlWrap = $("bgm-control");
const btnBgmGM = $("btn-bgm-gm");
const btnExportLog = $("btn-export-log");

// 대사 박스
const dialogueBox = $("dialogue-box");
const dialoguePortrait = $("dialogue-portrait-img");
const dialogueName = $("dialogue-name");
const dialogueText = $("dialogue-text");
const btnCloseDialogue = $("btn-close-dialogue");

// 스탠딩 영역
const standingArea = $("standing-area");

// 모달들
const bgModal = $("bg-modal");
const bgUrlInput = $("bg-url-input");
const btnBgConfirm = $("btn-bg-confirm");
const btnBgCancel = $("btn-bg-cancel");
const btnBgClear = $("btn-bg-clear");

const mapConfigModal = $("map-config-modal");
const mapColsInput = $("map-cols");
const mapRowsInput = $("map-rows");
const btnMapConfigConfirm = $("btn-map-config-confirm");
const btnMapConfigCancel = $("btn-map-config-cancel");

// ===== 상태 =====
let currentUser = null;
let roomData = null;
let mapSystem = null;
let charManager = null;
let bgmSystem = null;
let isGM = false;
let dialogueTimeout = null;

// ===== 유틸 =====
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function hexToRgba(hex, alpha = 1) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return `rgba(255, 61, 136, ${alpha})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

// ===== 인증 및 방 초기화 =====
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
  const systemLabel = { generic: "범용", coc7: "CoC 7판" }[roomData.system] || roomData.system;
  systemBadge.textContent = systemLabel;

  if (!isGM) {
    document.querySelectorAll(".gm-only").forEach(el => el.style.display = "none");
  }

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
  setupCharacterSystem();
  setupBGM();
  setupExport();
  setupUI();
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
    renderParticipants(snap.val() || {});
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
      ${info.photoURL ? `<img class="avatar-sm" src="${escapeHtml(info.photoURL)}" alt="">` : ""}
      <span>${escapeHtml(info.name || "알 수 없음")}</span>
    `;
    participantsList.appendChild(li);
  });
}

// ===== 캐릭터 시스템 =====
function setupCharacterSystem() {
  charManager = new CharacterManager({
    roomCode,
    currentUser,
    onChange: () => {
      updateCurrentCharacterUI();
      updateStandingImages();
      renderCharacterDropdown();
    },
  });

  btnCharMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    charDropdown.classList.toggle("hidden");
    if (!charDropdown.classList.contains("hidden")) {
      renderCharacterDropdown();
    }
  });

  document.addEventListener("click", (e) => {
    if (!charDropdown.contains(e.target) && e.target !== btnCharMenu) {
      charDropdown.classList.add("hidden");
    }
  });
}

function updateCurrentCharacterUI() {
  const active = charManager.getActiveCharacter();
  if (active) {
    charCurrentName.textContent = active.name;
    charCurrentName.style.setProperty("--current-char-color", active.color);
    charCurrentName.style.color = active.color;
    const url = charManager.getActiveImageUrl(active);
    if (url) {
      charCurrentImg.src = url;
      charCurrentImg.style.display = "block";
    } else {
      charCurrentImg.style.display = "none";
      charCurrentImg.src = "";
    }
    renderExpressionStrip(active);
  } else {
    charCurrentName.textContent = currentUser.displayName || "나로 말하기";
    charCurrentName.style.color = "";
    charCurrentImg.style.display = currentUser.photoURL ? "block" : "none";
    charCurrentImg.src = currentUser.photoURL || "";
    expressionStrip.classList.add("hidden");
    expressionStrip.innerHTML = "";
  }
}

// ===== 표정 전환 스트립 =====
function renderExpressionStrip(char) {
  if (!char.images || char.images.length < 2) {
    expressionStrip.classList.add("hidden");
    expressionStrip.innerHTML = "";
    return;
  }

  expressionStrip.classList.remove("hidden");
  expressionStrip.innerHTML = "";

  char.images.forEach((img, idx) => {
    if (!img.url) return;
    const btn = document.createElement("button");
    btn.className = "expression-btn" + (idx === (char.activeImageIndex ?? 0) ? " active" : "");
    btn.title = img.label || `표정 ${idx + 1}`;
    btn.innerHTML = `
      <img src="${img.url}" alt="" onerror="this.style.display='none'" />
      <span class="exp-label">${escapeHtml(img.label || `${idx + 1}`)}</span>
    `;
    btn.addEventListener("click", async () => {
      await charManager.setActiveImage(char.id, idx);
    });
    expressionStrip.appendChild(btn);
  });
}

function renderCharacterDropdown() {
  const myChars = charManager.getMyCharacters();
  charDropdown.innerHTML = "";

  // "본인으로 말하기" 옵션
  const selfItem = document.createElement("div");
  selfItem.className = "char-dropdown-item" + (!charManager.activeCharacterId ? " active" : "");
  selfItem.innerHTML = `
    ${currentUser.photoURL ? `<img src="${escapeHtml(currentUser.photoURL)}" alt="">` : '<div style="width:32px;height:32px;background:var(--bg-elevated);border-radius:6px"></div>'}
    <span class="item-name">${escapeHtml(currentUser.displayName || "나")} <span style="color:var(--text-muted);font-size:0.75rem">(본인)</span></span>
  `;
  selfItem.addEventListener("click", () => {
    charManager.setActiveCharacter(null);
    charDropdown.classList.add("hidden");
  });
  charDropdown.appendChild(selfItem);

  if (myChars.length > 0) {
    const divider = document.createElement("div");
    divider.className = "char-dropdown-divider";
    charDropdown.appendChild(divider);
  }

  // 내 캐릭터들
  myChars.forEach((char) => {
    const item = document.createElement("div");
    item.className = "char-dropdown-item" + (char.id === charManager.activeCharacterId ? " active" : "");
    item.innerHTML = `
      ${char.imageUrl ? `<img src="${escapeHtml(char.imageUrl)}" alt="" onerror="this.style.display='none'">` : '<div style="width:32px;height:32px;background:var(--bg-elevated);border-radius:6px"></div>'}
      <span class="item-name" style="color:${char.color}">${escapeHtml(char.name)}</span>
      <button class="item-edit" title="편집">✎</button>
    `;
    item.addEventListener("click", (e) => {
      if (e.target.closest(".item-edit")) return;
      charManager.setActiveCharacter(char.id);
      charDropdown.classList.add("hidden");
    });
    item.querySelector(".item-edit").addEventListener("click", (e) => {
      e.stopPropagation();
      charDropdown.classList.add("hidden");
      openCharacterEditor(charManager, char.id);
    });
    charDropdown.appendChild(item);
  });

  const divider2 = document.createElement("div");
  divider2.className = "char-dropdown-divider";
  charDropdown.appendChild(divider2);

  // 새 캐릭터 추가 버튼
  const addBtn = document.createElement("button");
  addBtn.className = "char-dropdown-action";
  addBtn.textContent = "＋ 새 캐릭터 만들기";
  addBtn.addEventListener("click", () => {
    charDropdown.classList.add("hidden");
    openCharacterEditor(charManager);
  });
  charDropdown.appendChild(addBtn);
}

// ===== 스탠딩 이미지 =====
function updateStandingImages() {
  const allChars = charManager.getAllCharacters()
    .map(c => ({ ...c, _url: charManager.getActiveImageUrl(c) }))
    .filter(c => c._url);

  standingArea.innerHTML = "";
  const positions = ["left", "center-left", "center", "center-right", "right"];
  allChars.slice(0, 5).forEach((char, idx) => {
    const img = document.createElement("img");
    img.className = "standing-image active";
    img.src = char._url;
    img.dataset.charId = char.id;
    img.dataset.position = positions[idx] || "center";
    img.onerror = () => img.remove();
    standingArea.appendChild(img);
  });

  highlightSpeaker(null);
}

function highlightSpeaker(charId) {
  const imgs = standingArea.querySelectorAll(".standing-image");
  if (!charId) {
    imgs.forEach(img => {
      img.classList.remove("dim");
      img.classList.add("active");
    });
    return;
  }
  imgs.forEach(img => {
    if (img.dataset.charId === charId) {
      img.classList.remove("dim");
      img.classList.add("active");
    } else {
      img.classList.remove("active");
      img.classList.add("dim");
    }
  });
}

// ===== 비주얼 노벨 대사 박스 =====
function showDialogue({ name, text, imageUrl, color, charId }) {
  if (!text) return;

  // 색상 변수 설정
  dialogueBox.style.setProperty("--char-color", color || "#ff3d88");
  dialogueBox.style.setProperty("--char-color-glow", hexToRgba(color || "#ff3d88", 0.4));

  dialogueName.textContent = name;
  dialogueName.style.color = color || "#ff3d88";
  dialogueText.textContent = text;

  if (imageUrl) {
    dialoguePortrait.src = imageUrl;
    dialoguePortrait.parentElement.style.display = "block";
  } else {
    dialoguePortrait.src = "";
    dialoguePortrait.parentElement.style.display = "none";
  }

  dialogueBox.classList.remove("hidden");

  // 스탠딩 이미지 하이라이트
  if (charId) {
    highlightSpeaker(charId);
  }

  // 자동 닫힘 타이머 (기본 15초)
  clearTimeout(dialogueTimeout);
  dialogueTimeout = setTimeout(() => {
    hideDialogue();
  }, 15000);
}

function hideDialogue() {
  dialogueBox.classList.add("hidden");
  highlightSpeaker(null);
  clearTimeout(dialogueTimeout);
}

// ===== 채팅 =====
function setupChat() {
  const messagesRef = query(
    ref(rtdb, `rooms/${roomCode}/messages`),
    limitToLast(200)
  );

  let initialLoadDone = false;
  const startTime = Date.now();

  onChildAdded(messagesRef, (snap) => {
    const msg = snap.val();
    appendMessage(msg);
    // 새 채팅 메시지면 대사 박스 표시 (초기 로드 제외)
    if ((msg.type === "chat" || msg.type === "ic") && msg.timestamp > startTime - 1000) {
      showDialogue({
        name: msg.characterName || msg.author,
        text: msg.text,
        imageUrl: msg.characterImage,
        color: msg.characterColor,
        charId: msg.characterId,
      });
    }
  });

  btnSend.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  document.querySelectorAll(".dice-btn").forEach((btn) => {
    btn.addEventListener("click", () => sendDiceRoll(btn.dataset.roll));
  });

  btnCloseDialogue.addEventListener("click", hideDialogue);
}

function getCurrentSpeakerInfo() {
  const active = charManager?.getActiveCharacter();
  if (active) {
    return {
      author: active.name,
      authorId: currentUser.uid,
      characterId: active.id,
      characterName: active.name,
      characterImage: charManager.getActiveImageUrl(active) || null,
      characterColor: active.color || null,
    };
  }
  return {
    author: currentUser.displayName || "플레이어",
    authorId: currentUser.uid,
    characterId: null,
    characterName: null,
    characterImage: currentUser.photoURL || null,
    characterColor: null,
  };
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  const result = detectDiceCommand(text);
  if (result) {
    if (result.kind === "standard") sendStandardRoll(result);
    else if (result.kind === "coc_skill") sendCoCSkillRoll(result);
  } else {
    const speaker = getCurrentSpeakerInfo();
    pushMessage({
      type: "chat",
      ...speaker,
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
  const speaker = getCurrentSpeakerInfo();
  pushMessage({
    type: "dice",
    ...speaker,
    formula: result.formula,
    rolls: result.rolls,
    modifier: result.modifier,
    total: result.total,
    timestamp: Date.now(),
  });
}

function sendCoCSkillRoll(result) {
  const speaker = getCurrentSpeakerInfo();
  pushMessage({
    type: "coc_skill",
    ...speaker,
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

  const displayName = msg.characterName || msg.author;
  const nameColor = msg.characterColor || "";

  if (msg.type === "dice") {
    div.className = "chat-message dice-roll";
    const modStr = msg.modifier
      ? (msg.modifier > 0 ? ` + ${msg.modifier}` : ` - ${Math.abs(msg.modifier)}`)
      : "";
    div.innerHTML = `
      <div class="author" style="${nameColor ? `color:${nameColor}` : ''}">${escapeHtml(displayName)}<span class="timestamp">${time}</span></div>
      <div class="roll-formula">🎲 ${escapeHtml(msg.formula)}</div>
      <div class="roll-total">${msg.total}</div>
      <div class="roll-detail">[${msg.rolls.join(", ")}]${modStr}</div>
    `;
  } else if (msg.type === "coc_skill") {
    div.className = `chat-message coc-roll coc-${msg.level}`;
    const diceMod = msg.bonusDice ? " · 보너스" : msg.penaltyDice ? " · 페널티" : "";
    div.innerHTML = `
      <div class="author" style="${nameColor ? `color:${nameColor}` : ''}">${escapeHtml(displayName)}<span class="timestamp">${time}</span></div>
      <div class="coc-skill-name">📘 ${escapeHtml(msg.skillName)} <span class="coc-target">(${msg.target})${diceMod}</span></div>
      <div class="coc-roll-value">${msg.roll}</div>
      <div class="coc-level">${msg.levelLabel}</div>
      <div class="coc-thresholds">극단 ${msg.thresholds.extreme} · 어려움 ${msg.thresholds.hard} · 일반 ${msg.thresholds.regular}</div>
    `;
  } else if (msg.type === "system") {
    div.className = "chat-message system";
    div.textContent = msg.text;
  } else {
    div.className = "chat-message";
    if (nameColor) div.style.borderLeftColor = nameColor;
    div.innerHTML = `
      <div class="author" style="${nameColor ? `color:${nameColor}` : ''}">${escapeHtml(displayName)}<span class="timestamp">${time}</span></div>
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
    const active = charManager?.getActiveCharacter();
    const defaultName = active?.name || currentUser.displayName?.slice(0, 10) || "토큰";
    const name = prompt("토큰 이름:", defaultName);
    if (name === null) return;
    mapSystem.addToken({
      name: name || "토큰",
      color: active?.color,
    });
  });

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

// ===== BGM =====
function setupBGM() {
  bgmSystem = new BGMSystem({ roomCode, isGM });

  // 개인 볼륨 컨트롤
  createBGMPlayerControl(bgmSystem, bgmControlWrap);

  // 자동재생 차단 시 안내
  bgmSystem.onAutoplayBlocked = () => {
    if (!document.querySelector(".autoplay-notice")) {
      const notice = document.createElement("div");
      notice.className = "autoplay-notice";
      notice.innerHTML = `
        <span>🎵 BGM이 재생 대기 중입니다.</span>
        <button class="btn btn-small btn-primary">▶ 재생</button>
      `;
      notice.querySelector("button").addEventListener("click", () => {
        bgmSystem.applyBGM(bgmSystem.currentBgm);
        notice.remove();
      });
      document.body.appendChild(notice);
    }
  };

  // GM BGM 버튼
  btnBgmGM?.addEventListener("click", () => openBGMControlModal(bgmSystem));
}

// ===== 로그 내보내기 =====
function setupExport() {
  btnExportLog?.addEventListener("click", () => {
    openExportModal(roomCode, roomData.name);
  });
}

// ===== UI 토글 (사이드 패널, 로그 모달) =====
function setupUI() {
  btnBack.addEventListener("click", () => {
    location.href = "index.html";
  });

  btnCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(roomCode);
    // 간단한 피드백
    btnCopy.style.color = "var(--success)";
    setTimeout(() => (btnCopy.style.color = ""), 1200);
  });

  // 사이드 패널 토글
  const panels = {
    "btn-toggle-participants": "panel-participants",
    "btn-toggle-sheet": "panel-sheet",
  };

  Object.entries(panels).forEach(([btnId, panelId]) => {
    const btn = $(btnId);
    const panel = $(panelId);
    btn?.addEventListener("click", () => {
      // 다른 패널은 닫고 이 패널만 열기/닫기
      Object.values(panels).forEach(pid => {
        if (pid !== panelId) $(pid)?.classList.add("hidden");
      });
      panel.classList.toggle("hidden");
    });
  });

  document.querySelectorAll(".btn-close-panel").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = $(btn.dataset.target);
      target?.classList.add("hidden");
    });
  });

  // 로그 모달
  btnOpenLog?.addEventListener("click", () => {
    logModal.classList.remove("hidden");
    setTimeout(() => { chatLog.scrollTop = chatLog.scrollHeight; }, 50);
  });
  btnCloseLog?.addEventListener("click", () => logModal.classList.add("hidden"));

  // ESC로 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".side-panel, .modal").forEach(el => {
        if (!el.classList.contains("hidden")) el.classList.add("hidden");
      });
      charDropdown.classList.add("hidden");
    }
  });
}
