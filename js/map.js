// 맵 & 토큰 시스템 (v5 개선판)
// - 토큰 호버 시 이름/소유자 툴팁
// - 토큰 클릭으로 선택 → 삭제/색상 변경 액션 메뉴
// - 카메라 팬(드래그), 줌(휠/핀치) 지원
// - 이동 시 부드러운 전환

import { db } from "./firebase-config.js";
import {
  doc, setDoc, updateDoc, onSnapshot, collection,
  addDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const CELL_SIZE = 48;
const GRID_COLOR = "rgba(255, 255, 255, 0.08)";
const GRID_COLOR_MAJOR = "rgba(255, 255, 255, 0.15)";
const BG_COLOR = "#0a1628";

const TOKEN_COLORS = [
  "#ff3d88", "#4ade80", "#00e5ff", "#ffcc4d",
  "#b14bff", "#ff9e6b", "#ff6b9d", "#6bb5ff",
];

export class MapSystem {
  constructor({ canvas, roomCode, currentUser, isGM }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.roomCode = roomCode;
    this.currentUser = currentUser;
    this.isGM = isGM;

    this.tokens = new Map();
    this.mapConfig = { cols: 20, rows: 15, backgroundUrl: null };
    this.backgroundImage = null;

    this.dragging = null;
    this.panning = null;
    this.camera = { x: 0, y: 0, scale: 1 };
    this.selectedTokenId = null;
    this.hoveredTokenId = null;
    this.mousePos = { x: 0, y: 0 };

    this.lastSync = 0;
    this.pendingSync = null;

    // 툴팁 DOM
    this.tooltip = document.createElement("div");
    this.tooltip.className = "map-tooltip";
    this.tooltip.style.cssText = "position:absolute;pointer-events:none;display:none;z-index:10;";
    canvas.parentElement.appendChild(this.tooltip);

    // 토큰 액션 메뉴 DOM
    this.actionMenu = document.createElement("div");
    this.actionMenu.className = "token-action-menu";
    this.actionMenu.style.cssText = "position:absolute;display:none;z-index:11;";
    canvas.parentElement.appendChild(this.actionMenu);

    this.setupCanvas();
    this.bindEvents();
    this.subscribeToTokens();
    this.subscribeToMapConfig();
    this.render();
  }

  setupCanvas() {
    const resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = rect.height * dpr;
      this.canvas.style.width = rect.width + "px";
      this.canvas.style.height = rect.height + "px";
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.centerCameraIfNeeded();
      this.render();
    };
    resize();
    window.addEventListener("resize", resize);

    // 맵 크기가 바뀌면 다시 중앙 정렬
    this._resize = resize;
  }

  centerCameraIfNeeded() {
    // 최초 진입 시 맵을 화면 중앙에 맞춤
    if (this.camera.x === 0 && this.camera.y === 0) {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const mapW = this.mapConfig.cols * CELL_SIZE;
      const mapH = this.mapConfig.rows * CELL_SIZE;
      // 맵이 화면보다 작으면 중앙, 크면 좌상단 정렬
      if (mapW < rect.width) {
        this.camera.x = (rect.width - mapW) / 2;
      }
      if (mapH < rect.height) {
        this.camera.y = (rect.height - mapH) / 2;
      }
    }
  }

  // ===== Firestore 구독 =====
  subscribeToTokens() {
    const tokensRef = collection(db, "rooms", this.roomCode, "tokens");
    this.unsubTokens = onSnapshot(tokensRef, (snap) => {
      this.tokens.clear();
      snap.forEach((d) => {
        this.tokens.set(d.id, { id: d.id, ...d.data() });
      });
      this.render();
    }, (err) => {
      console.error("토큰 구독 실패:", err);
    });
  }

  subscribeToMapConfig() {
    const mapRef = doc(db, "rooms", this.roomCode, "meta", "map");
    this.unsubMap = onSnapshot(mapRef, (snap) => {
      if (snap.exists()) {
        const newConfig = { ...this.mapConfig, ...snap.data() };
        const sizeChanged = newConfig.cols !== this.mapConfig.cols || newConfig.rows !== this.mapConfig.rows;
        this.mapConfig = newConfig;
        if (newConfig.backgroundUrl) {
          this.loadBackgroundImage(newConfig.backgroundUrl);
        } else {
          this.backgroundImage = null;
          this.render();
        }
        if (sizeChanged) this.centerCameraIfNeeded();
      }
    }, (err) => {
      console.error("맵 설정 구독 실패:", err);
    });
  }

  loadBackgroundImage(url) {
    const img = new Image();
    // crossOrigin을 설정하지 않음 — 단순 표시 용도에는 불필요하고 CORS 오류 유발 가능
    img.onload = () => {
      this.backgroundImage = img;
      this.render();
    };
    img.onerror = () => {
      console.warn("배경 이미지 로드 실패:", url);
      this.backgroundImage = null;
      this.render();
    };
    img.src = url;
  }

  // ===== 이벤트 =====
  bindEvents() {
    this.canvas.addEventListener("mousedown", (e) => this.onPointerDown(e));
    this.canvas.addEventListener("mousemove", (e) => this.onPointerMove(e));
    this.canvas.addEventListener("mouseup", (e) => this.onPointerUp(e));
    this.canvas.addEventListener("mouseleave", () => this.onPointerUp({}));
    this.canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });

    // 터치 지원
    this.canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.onPointerDown({
          clientX: t.clientX, clientY: t.clientY,
          button: 0,
          preventDefault: () => e.preventDefault(),
        });
      }
    });
    this.canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        this.onPointerMove({ clientX: t.clientX, clientY: t.clientY });
      }
    }, { passive: false });
    this.canvas.addEventListener("touchend", () => this.onPointerUp({}));

    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const grid = this.screenToGrid(e.clientX, e.clientY);
      const token = this.getTokenAt(grid.x, grid.y);
      if (token) {
        this.selectToken(token.id);
        this.showActionMenu(e.clientX, e.clientY, token);
      }
    });

    // 액션 메뉴 바깥 클릭 시 닫기
    document.addEventListener("click", (e) => {
      if (!this.actionMenu.contains(e.target) && !this.canvas.contains(e.target)) {
        this.hideActionMenu();
      }
    });
  }

  getCanvasPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  screenToGrid(clientX, clientY) {
    const p = this.getCanvasPoint(clientX, clientY);
    return {
      x: (p.x - this.camera.x) / this.camera.scale / CELL_SIZE,
      y: (p.y - this.camera.y) / this.camera.scale / CELL_SIZE,
    };
  }

  getTokenAt(gridX, gridY) {
    // 뒤에 그려진(나중에 추가된) 토큰부터 검사
    const tokens = [...this.tokens.values()].reverse();
    for (const token of tokens) {
      const dx = gridX - token.x - 0.5;
      const dy = gridY - token.y - 0.5;
      if (dx * dx + dy * dy < 0.25) return token;
    }
    return null;
  }

  canControlToken(token) {
    return this.isGM || token.ownerId === this.currentUser.uid;
  }

  onPointerDown(e) {
    this.hideActionMenu();
    const canvasPoint = this.getCanvasPoint(e.clientX, e.clientY);
    const grid = this.screenToGrid(e.clientX, e.clientY);
    const token = this.getTokenAt(grid.x, grid.y);

    if (token && this.canControlToken(token)) {
      // 토큰 드래그
      this.dragging = {
        tokenId: token.id,
        offsetX: grid.x - token.x,
        offsetY: grid.y - token.y,
        startX: token.x,
        startY: token.y,
        moved: false,
      };
      this.selectToken(token.id);
      this.canvas.style.cursor = "grabbing";
    } else {
      // 빈 공간 = 카메라 팬
      this.panning = {
        startX: canvasPoint.x - this.camera.x,
        startY: canvasPoint.y - this.camera.y,
      };
      this.selectToken(null);
      this.canvas.style.cursor = "grabbing";
    }
  }

  onPointerMove(e) {
    const canvasPoint = this.getCanvasPoint(e.clientX, e.clientY);
    this.mousePos = canvasPoint;

    if (this.dragging) {
      const grid = this.screenToGrid(e.clientX, e.clientY);
      const token = this.tokens.get(this.dragging.tokenId);
      if (!token) return;
      token.x = grid.x - this.dragging.offsetX;
      token.y = grid.y - this.dragging.offsetY;
      this.dragging.moved = true;
      this.render();
      this.scheduleTokenSync(token);
    } else if (this.panning) {
      this.camera.x = canvasPoint.x - this.panning.startX;
      this.camera.y = canvasPoint.y - this.panning.startY;
      this.render();
    } else {
      // 호버 검사
      const grid = this.screenToGrid(e.clientX, e.clientY);
      const token = this.getTokenAt(grid.x, grid.y);
      const newHoverId = token?.id || null;
      if (newHoverId !== this.hoveredTokenId) {
        this.hoveredTokenId = newHoverId;
        this.render();
      }
      if (token) {
        this.canvas.style.cursor = this.canControlToken(token) ? "grab" : "pointer";
        this.showTooltip(canvasPoint.x, canvasPoint.y, token);
      } else {
        this.canvas.style.cursor = "default";
        this.hideTooltip();
      }
    }
  }

  onPointerUp(e) {
    if (this.dragging) {
      const token = this.tokens.get(this.dragging.tokenId);
      if (token) {
        if (this.dragging.moved) {
          // 격자 스냅
          token.x = Math.max(0, Math.min(this.mapConfig.cols - 1, Math.round(token.x)));
          token.y = Math.max(0, Math.min(this.mapConfig.rows - 1, Math.round(token.y)));
          this.syncToken(token);
        } else {
          // 클릭만 한 거라면 액션 메뉴 표시
          const pt = this.getCanvasPoint(e.clientX || this.mousePos.x, e.clientY || this.mousePos.y);
          const rect = this.canvas.getBoundingClientRect();
          this.showActionMenu((e.clientX || rect.left + this.mousePos.x), (e.clientY || rect.top + this.mousePos.y), token);
        }
      }
      this.dragging = null;
    }
    this.panning = null;
    this.canvas.style.cursor = "default";
    this.render();
  }

  onWheel(e) {
    e.preventDefault();
    const canvasPoint = this.getCanvasPoint(e.clientX, e.clientY);
    const delta = -Math.sign(e.deltaY) * 0.1;
    const newScale = Math.max(0.3, Math.min(3, this.camera.scale * (1 + delta)));
    // 마우스 위치 기준으로 줌
    const gridBefore = {
      x: (canvasPoint.x - this.camera.x) / this.camera.scale,
      y: (canvasPoint.y - this.camera.y) / this.camera.scale,
    };
    this.camera.scale = newScale;
    this.camera.x = canvasPoint.x - gridBefore.x * this.camera.scale;
    this.camera.y = canvasPoint.y - gridBefore.y * this.camera.scale;
    this.render();
  }

  // ===== 선택/툴팁/메뉴 =====
  selectToken(id) {
    this.selectedTokenId = id;
    this.render();
  }

  showTooltip(x, y, token) {
    if (!token) { this.hideTooltip(); return; }
    this.tooltip.textContent = token.name || "토큰";
    this.tooltip.style.display = "block";
    this.tooltip.style.left = (x + 12) + "px";
    this.tooltip.style.top = (y + 12) + "px";
  }

  hideTooltip() {
    this.tooltip.style.display = "none";
  }

  showActionMenu(clientX, clientY, token) {
    this.hideTooltip();
    if (!token) return;
    const canControl = this.canControlToken(token);
    const parentRect = this.canvas.parentElement.getBoundingClientRect();
    const localX = clientX - parentRect.left;
    const localY = clientY - parentRect.top;

    let html = `
      <div class="menu-header">
        <span class="menu-token-dot" style="background:${token.color || '#ff3d88'}"></span>
        ${escapeHtml(token.name || "토큰")}
      </div>
    `;
    if (canControl) {
      html += `
        <button class="menu-item" data-action="rename">✏️ 이름 변경</button>
        <button class="menu-item" data-action="color">🎨 색상 변경</button>
        <button class="menu-item danger" data-action="delete">🗑️ 삭제</button>
      `;
    } else {
      html += `<div class="menu-hint">다른 플레이어의 토큰입니다</div>`;
    }

    this.actionMenu.innerHTML = html;
    this.actionMenu.style.display = "block";
    // 화면 밖으로 나가지 않도록 위치 조정
    this.actionMenu.style.left = Math.min(localX, parentRect.width - 180) + "px";
    this.actionMenu.style.top = Math.min(localY, parentRect.height - 160) + "px";

    this.actionMenu.querySelectorAll(".menu-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        this.hideActionMenu();
        if (action === "rename") this.renameToken(token.id);
        else if (action === "color") this.changeTokenColor(token.id);
        else if (action === "delete") this.confirmDeleteToken(token.id);
      });
    });
  }

  hideActionMenu() {
    this.actionMenu.style.display = "none";
  }

  renameToken(tokenId) {
    const token = this.tokens.get(tokenId);
    if (!token) return;
    const newName = prompt("새 이름:", token.name || "");
    if (newName === null) return;
    const ref = doc(db, "rooms", this.roomCode, "tokens", tokenId);
    updateDoc(ref, { name: newName.trim() || "토큰" }).catch(err => {
      console.error(err);
      alert("변경 실패: " + err.message);
    });
  }

  changeTokenColor(tokenId) {
    const token = this.tokens.get(tokenId);
    if (!token) return;

    // 색상 선택 팝업
    const popup = document.createElement("div");
    popup.className = "color-popup";
    popup.innerHTML = `
      <div class="color-popup-inner">
        <div class="color-popup-title">색상 선택</div>
        <div class="color-popup-grid">
          ${TOKEN_COLORS.map(c => `
            <button class="color-pick" style="background:${c}" data-color="${c}"></button>
          `).join("")}
        </div>
        <button class="color-popup-close">닫기</button>
      </div>
    `;
    document.body.appendChild(popup);

    const close = () => popup.remove();
    popup.querySelector(".color-popup-close").addEventListener("click", close);
    popup.addEventListener("click", (e) => {
      if (e.target === popup) close();
    });
    popup.querySelectorAll(".color-pick").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ref = doc(db, "rooms", this.roomCode, "tokens", tokenId);
        try {
          await updateDoc(ref, { color: btn.dataset.color });
          close();
        } catch (err) {
          console.error(err);
          alert("색상 변경 실패: " + err.message);
        }
      });
    });
  }

  confirmDeleteToken(tokenId) {
    const token = this.tokens.get(tokenId);
    if (!token) return;
    if (confirm(`'${token.name}' 토큰을 삭제할까요?`)) {
      this.deleteToken(tokenId);
    }
  }

  // ===== 동기화 =====
  scheduleTokenSync(token) {
    const now = Date.now();
    if (now - this.lastSync > 100) {
      this.syncToken(token);
      this.lastSync = now;
    } else {
      clearTimeout(this.pendingSync);
      this.pendingSync = setTimeout(() => this.syncToken(token), 120);
    }
  }

  async syncToken(token) {
    const tokenRef = doc(db, "rooms", this.roomCode, "tokens", token.id);
    try {
      await updateDoc(tokenRef, { x: token.x, y: token.y });
    } catch (err) {
      console.error("토큰 위치 동기화 실패:", err);
    }
  }

  async addToken({ name, color }) {
    const tokensRef = collection(db, "rooms", this.roomCode, "tokens");
    const defaultColor = color || TOKEN_COLORS[this.tokens.size % TOKEN_COLORS.length];
    try {
      const docRef = await addDoc(tokensRef, {
        name: (name || "토큰").slice(0, 12),
        x: Math.floor(this.mapConfig.cols / 2),
        y: Math.floor(this.mapConfig.rows / 2),
        color: defaultColor,
        ownerId: this.currentUser.uid,
        createdAt: Date.now(),
      });
      return docRef.id;
    } catch (err) {
      console.error("토큰 추가 실패:", err);
      alert("토큰 추가에 실패했습니다: " + err.message);
    }
  }

  async deleteToken(tokenId) {
    const tokenRef = doc(db, "rooms", this.roomCode, "tokens", tokenId);
    try {
      await deleteDoc(tokenRef);
    } catch (err) {
      console.error("토큰 삭제 실패:", err);
      alert("삭제 실패: " + err.message);
    }
  }

  async setMapConfig(config) {
    const mapRef = doc(db, "rooms", this.roomCode, "meta", "map");
    try {
      await setDoc(mapRef, { ...this.mapConfig, ...config }, { merge: true });
    } catch (err) {
      console.error("맵 설정 저장 실패:", err);
      alert("맵 설정 저장 실패: " + err.message);
    }
  }

  // ===== 렌더링 =====
  render() {
    const { ctx, canvas } = this;
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.scale, this.camera.scale);

    const mapW = this.mapConfig.cols * CELL_SIZE;
    const mapH = this.mapConfig.rows * CELL_SIZE;

    // 맵 배경 (경계선)
    ctx.fillStyle = "#0d1826";
    ctx.fillRect(0, 0, mapW, mapH);

    // 배경 이미지
    if (this.backgroundImage) {
      ctx.drawImage(this.backgroundImage, 0, 0, mapW, mapH);
      // 그리드 반투명 오버레이
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(0, 0, mapW, mapH);
    }

    // 그리드
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.mapConfig.cols; i++) {
      ctx.strokeStyle = (i % 5 === 0) ? GRID_COLOR_MAJOR : GRID_COLOR;
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, mapH);
      ctx.stroke();
    }
    for (let j = 0; j <= this.mapConfig.rows; j++) {
      ctx.strokeStyle = (j % 5 === 0) ? GRID_COLOR_MAJOR : GRID_COLOR;
      ctx.beginPath();
      ctx.moveTo(0, j * CELL_SIZE);
      ctx.lineTo(mapW, j * CELL_SIZE);
      ctx.stroke();
    }

    // 맵 경계
    ctx.strokeStyle = "rgba(255, 61, 136, 0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, mapW, mapH);

    // 토큰
    for (const token of this.tokens.values()) {
      this.drawToken(token);
    }

    ctx.restore();
  }

  drawToken(token) {
    const { ctx } = this;
    const px = (token.x + 0.5) * CELL_SIZE;
    const py = (token.y + 0.5) * CELL_SIZE;
    const r = CELL_SIZE * 0.4;
    const isSelected = this.selectedTokenId === token.id;
    const isHovered = this.hoveredTokenId === token.id;
    const color = token.color || "#ff3d88";

    // 선택 링
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(px, py, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffcc4d";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // 호버 효과
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(px, py, r + 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
      ctx.fill();
    }

    // 그림자
    ctx.beginPath();
    ctx.arc(px + 2, py + 3, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fill();

    // 원형 배경
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 이니셜
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${CELL_SIZE * 0.4}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const initial = (token.name || "?").trim()[0]?.toUpperCase() || "?";
    ctx.fillText(initial, px, py);

    // 이름 라벨
    if (token.name) {
      const labelText = token.name.slice(0, 10);
      ctx.font = `600 ${CELL_SIZE * 0.22}px sans-serif`;
      const metrics = ctx.measureText(labelText);
      const labelW = metrics.width + 8;
      const labelH = 14;
      const labelY = py + r + 4;
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(px - labelW / 2, labelY, labelW, labelH);
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(labelText, px, labelY + labelH / 2);
    }
  }

  destroy() {
    this.unsubTokens?.();
    this.unsubMap?.();
    this.tooltip?.remove();
    this.actionMenu?.remove();
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
