// 채팅 로그 내보내기
// HTML 파일로 예쁘게 포장 + TXT 간단 버전

import { rtdb } from "./firebase-config.js";
import { ref, get, query, orderByChild } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export async function fetchAllMessages(roomCode) {
  const messagesRef = ref(rtdb, `rooms/${roomCode}/messages`);
  const snap = await get(messagesRef);
  if (!snap.exists()) return [];
  const messages = [];
  snap.forEach(child => {
    messages.push(child.val());
  });
  messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  return messages;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ===== HTML 내보내기 =====
export function exportAsHTML(roomName, roomCode, messages) {
  const messagesHtml = messages.map(msg => {
    const time = formatTime(msg.timestamp);
    const displayName = msg.characterName || msg.author || "알 수 없음";
    const color = msg.characterColor || "#ff3d88";

    if (msg.type === "dice") {
      const modStr = msg.modifier
        ? (msg.modifier > 0 ? ` + ${msg.modifier}` : ` - ${Math.abs(msg.modifier)}`)
        : "";
      return `
        <div class="msg msg-dice">
          <div class="msg-header"><span class="author" style="color:${color}">${escapeHtml(displayName)}</span><span class="time">${time}</span></div>
          <div class="dice-formula">🎲 ${escapeHtml(msg.formula)}</div>
          <div class="dice-total">${msg.total}</div>
          <div class="dice-detail">[${msg.rolls.join(", ")}]${modStr}</div>
        </div>`;
    } else if (msg.type === "coc_skill") {
      const diceMod = msg.bonusDice ? " · 보너스" : msg.penaltyDice ? " · 페널티" : "";
      return `
        <div class="msg msg-coc coc-${msg.level}">
          <div class="msg-header"><span class="author" style="color:${color}">${escapeHtml(displayName)}</span><span class="time">${time}</span></div>
          <div class="coc-skill">📘 ${escapeHtml(msg.skillName)} <span class="coc-target">(${msg.target})${diceMod}</span></div>
          <div class="coc-value">${msg.roll}</div>
          <div class="coc-level">${msg.levelLabel}</div>
        </div>`;
    } else if (msg.type === "system") {
      return `<div class="msg msg-system">${escapeHtml(msg.text || "")}</div>`;
    } else {
      return `
        <div class="msg msg-chat" style="border-left-color:${color}">
          <div class="msg-header"><span class="author" style="color:${color}">${escapeHtml(displayName)}</span><span class="time">${time}</span></div>
          <div class="msg-text">${escapeHtml(msg.text || "")}</div>
        </div>`;
    }
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(roomName)} - 세션 로그</title>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=Shippori+Mincho:wght@500;700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #0d0e1a;
  --surface: #151729;
  --elev: #1e2139;
  --text: #f0f1ff;
  --text-dim: #a0a3c8;
  --text-mute: #6d7098;
  --border: rgba(255,255,255,0.08);
  --pink: #ff3d88;
  --cyan: #00e5ff;
  --gold: #ffcc4d;
  --green: #4ade80;
  --red: #ef4444;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: "Zen Kaku Gothic New", "Noto Sans KR", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 2rem 1rem;
}
.container {
  max-width: 780px;
  margin: 0 auto;
}
header {
  text-align: center;
  padding: 2rem 1rem;
  margin-bottom: 2rem;
  border-bottom: 1px solid var(--border);
}
h1 {
  font-family: "Shippori Mincho", serif;
  font-size: 2rem;
  background: linear-gradient(135deg, #ff3d88 0%, #b14bff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin-bottom: 0.5rem;
}
.meta {
  color: var(--text-mute);
  font-size: 0.85rem;
  font-family: "JetBrains Mono", monospace;
}
.msg {
  padding: 0.7rem 1rem;
  background: var(--surface);
  border-radius: 10px;
  margin-bottom: 0.6rem;
  border-left: 3px solid var(--border);
}
.msg-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.82rem;
  margin-bottom: 0.3rem;
}
.author { font-weight: 700; }
.time { color: var(--text-mute); font-family: "JetBrains Mono", monospace; font-size: 0.75rem; }
.msg-text { color: var(--text); }
.msg-system {
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--text-mute);
  font-style: italic;
  text-align: center;
  font-size: 0.88rem;
}
.msg-dice {
  background: linear-gradient(135deg, rgba(13,14,26,0.9), rgba(30,33,57,0.9));
  border-left-color: var(--cyan);
}
.dice-formula { font-family: "JetBrains Mono", monospace; color: var(--text-mute); font-size: 0.82rem; }
.dice-total {
  font-size: 1.5rem;
  font-family: "JetBrains Mono", monospace;
  font-weight: 700;
  color: var(--cyan);
  margin: 0.1rem 0;
}
.dice-detail { font-family: "JetBrains Mono", monospace; font-size: 0.78rem; color: var(--text-mute); }
.msg-coc { border-left-width: 4px; }
.coc-skill { font-weight: 600; margin-bottom: 0.15rem; }
.coc-target { color: var(--text-mute); font-size: 0.78rem; font-weight: 400; }
.coc-value {
  font-size: 1.7rem;
  font-weight: 700;
  font-family: "JetBrains Mono", monospace;
  line-height: 1;
  margin: 0.1rem 0;
}
.coc-level {
  font-family: "Shippori Mincho", serif;
  font-size: 0.95rem;
  font-weight: 700;
}
.coc-critical { border-left-color: var(--gold); }
.coc-critical .coc-level, .coc-critical .coc-value { color: var(--gold); }
.coc-extreme { border-left-color: var(--pink); }
.coc-extreme .coc-level, .coc-extreme .coc-value { color: var(--pink); }
.coc-hard { border-left-color: var(--green); }
.coc-hard .coc-level, .coc-hard .coc-value { color: var(--green); }
.coc-regular { border-left-color: var(--cyan); }
.coc-regular .coc-level, .coc-regular .coc-value { color: var(--cyan); }
.coc-fail { border-left-color: #555; opacity: 0.8; }
.coc-fail .coc-level, .coc-fail .coc-value { color: var(--text-mute); }
.coc-fumble { border-left-color: var(--red); }
.coc-fumble .coc-level, .coc-fumble .coc-value { color: var(--red); }
footer {
  text-align: center;
  margin-top: 3rem;
  padding: 1rem;
  color: var(--text-mute);
  font-size: 0.8rem;
  border-top: 1px solid var(--border);
}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>${escapeHtml(roomName)}</h1>
  <div class="meta">방 코드: ${escapeHtml(roomCode)} · ${messages.length}개 메시지 · ${formatTime(Date.now())} 내보냄</div>
</header>
${messagesHtml}
<footer>🎲 ORPG Table로 생성된 세션 로그</footer>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  downloadBlob(blob, `${sanitizeFilename(roomName)}_log_${dateStamp()}.html`);
}

// ===== TXT 내보내기 (단순) =====
export function exportAsTXT(roomName, roomCode, messages) {
  const lines = [
    `== ${roomName} 세션 로그 ==`,
    `방 코드: ${roomCode}`,
    `내보낸 시각: ${formatTime(Date.now())}`,
    `메시지 수: ${messages.length}`,
    "",
    "─".repeat(60),
    "",
  ];

  for (const msg of messages) {
    const time = formatTime(msg.timestamp);
    const name = msg.characterName || msg.author || "?";

    if (msg.type === "dice") {
      const modStr = msg.modifier ? (msg.modifier > 0 ? `+${msg.modifier}` : `${msg.modifier}`) : "";
      lines.push(`[${time}] ${name}`);
      lines.push(`  🎲 ${msg.formula} = ${msg.total} [${msg.rolls.join(",")}]${modStr}`);
    } else if (msg.type === "coc_skill") {
      lines.push(`[${time}] ${name}`);
      lines.push(`  📘 ${msg.skillName} (${msg.target}) → ${msg.roll} : ${msg.levelLabel}`);
    } else if (msg.type === "system") {
      lines.push(`[시스템] ${msg.text || ""}`);
    } else {
      lines.push(`[${time}] ${name}: ${msg.text || ""}`);
    }
    lines.push("");
  }

  const txt = lines.join("\n");
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, `${sanitizeFilename(roomName)}_log_${dateStamp()}.txt`);
}

function sanitizeFilename(str) {
  return String(str).replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);
}

function dateStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ===== UI =====
export function openExportModal(roomCode, roomName) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content">
      <h3>📥 대화 로그 내보내기</h3>
      <p class="hint">현재까지의 모든 채팅·주사위·판정 기록을 파일로 저장합니다.</p>
      <div style="display:flex;flex-direction:column;gap:0.6rem;margin-top:1rem">
        <button id="export-html" class="btn btn-primary">
          🎨 HTML로 내보내기 (예쁜 디자인)
        </button>
        <button id="export-txt" class="btn btn-secondary">
          📄 TXT로 내보내기 (간단 텍스트)
        </button>
      </div>
      <div class="modal-actions">
        <button id="export-cancel" class="btn btn-ghost">닫기</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const setLoading = (btn, loading) => {
    btn.disabled = loading;
    btn.style.opacity = loading ? "0.6" : "";
    if (loading) btn.dataset.originalText = btn.textContent, btn.textContent = "내보내는 중...";
    else if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
  };

  modal.querySelector("#export-html").addEventListener("click", async (e) => {
    setLoading(e.target, true);
    try {
      const messages = await fetchAllMessages(roomCode);
      exportAsHTML(roomName, roomCode, messages);
      modal.remove();
    } catch (err) {
      console.error(err);
      alert("내보내기 실패: " + err.message);
      setLoading(e.target, false);
    }
  });

  modal.querySelector("#export-txt").addEventListener("click", async (e) => {
    setLoading(e.target, true);
    try {
      const messages = await fetchAllMessages(roomCode);
      exportAsTXT(roomName, roomCode, messages);
      modal.remove();
    } catch (err) {
      console.error(err);
      alert("내보내기 실패: " + err.message);
      setLoading(e.target, false);
    }
  });

  modal.querySelector("#export-cancel").addEventListener("click", () => modal.remove());
}
