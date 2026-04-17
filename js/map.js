// 맵 & 토큰 시스템 (HTML Canvas)
// - 격자 기반 맵
// - 드래그 가능한 토큰
// - Firestore를 통한 실시간 동기화 (토큰 위치)

import { db } from "./firebase-config.js";
import {
  doc, setDoc, updateDoc, onSnapshot, collection,
  addDoc, deleteDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const CELL_SIZE = 48; // 1셀 크기 (px)
const GRID_COLOR = "rgba(255,255,255,0.1)";
const BG_COLOR = "#0a1628";

// 토큰 색상 팔레트 (플레이어별 기본 색상)
const TOKEN_COLORS = [
  "#e94560", "#4caf50", "#2196f3", "#ff9800",
  "#9c27b0", "#00bcd4", "#ffeb3b", "#8bc34a",
];

export class MapSystem {
  constructor({ canvas, roomCode, currentUser, isGM }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.roomCode = roomCode;
    this.currentUser = currentUser;
    this.isGM = isGM;

    this.tokens = new Map(); // tokenId -> {id, name, x, y, color, ownerId}
    this.mapConfig = { cols: 20, rows: 15, backgroundUrl: null };
    this.backgroundImage = null;

    // 드래그 상태
    this.dragging = null; // {tokenId, offsetX, offsetY}
    this.camera = { x: 0, y: 0, scale: 1 };

    // 마지막 전송 시각 (throttle용)
    this.lastSync = 0;
    this.pendingSync = null;

    this.setupCanvas();
    this.bindEvents();
    this.subscribeToTokens();
    this.subscribeToMapConfig();
    this.render();
  }

  setupCanvas() {
    const resize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
      this.render();
    };
    resize();
    window.addEventListener("resize", resize);
  }

  // ===== Firestore 구독 =====

  subscribeToTokens() {
    const tokensRef = collection(db, "rooms", this.roomCode, "tokens");
    this.unsubTokens = onSnapshot(tokensRef, (snap) => {
      this.tokens.clear();
      snap.forEach((docSnap) => {
        this.tokens.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
      });
      this.render();
    });
  }

  subscribeToMapConfig() {
    const mapRef = doc(db, "rooms", this.roomCode, "meta", "map");
    this.unsubMap = onSnapshot(mapRef, (snap) => {
      if (snap.exists()) {
        this.mapConfig = { ...this.mapConfig, ...snap.data() };
        if (this.mapConfig.backgroundUrl) {
          this.loadBackgroundImage(this.mapConfig.backgroundUrl);
        } else {
          this.backgroundImage = null;
          this.render();
        }
      }
    });
  }

  loadBackgroundImage(url) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.backgroundImage = img;
      this.render();
    };
    img.onerror = () => {
      console.warn("배경 이미지 로드 실패:", url);
      this.backgroundImage = null;
    };
    img.src = url;
  }

  // ===== 이벤트 =====

  bindEvents() {
    // 토큰 드래그
    this.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.canvas.addEventListener("mouseup", (e) => this.onMouseUp(e));
    this.canvas.addEventListener("mouseleave", (e) => this.onMouseUp(e));

    // 터치 지원
    this.canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this.onMouseDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => e.preventDefault() });
      }
    });
    this.canvas.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1 && this.dragging) {
        e.preventDefault();
        const t = e.touches[0];
        this.onMouseMove({ clientX: t.clientX, clientY: t.clientY });
      }
    }, { passive: false });
    this.canvas.addEventListener("touchend", () => this.onMouseUp({}));

    // 우클릭: 컨텍스트 메뉴 (토큰 삭제)
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const { x, y } = this.screenToGrid(e.clientX, e.clientY);
      const token = this.getTokenAt(x, y);
      if (token && this.canControlToken(token)) {
        if (confirm(`'${token.name}' 토큰을 삭제할까요?`)) {
          this.deleteToken(token.id);
        }
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
    for (const token of this.tokens.values()) {
      const dx = gridX - token.x - 0.5;
      const dy = gridY - token.y - 0.5;
      if (dx * dx + dy * dy < 0.25) return token; // 반지름 0.5
    }
    return null;
  }

  canControlToken(token) {
    return this.isGM || token.ownerId === this.currentUser.uid;
  }

  onMouseDown(e) {
    const { x, y } = this.screenToGrid(e.clientX, e.clientY);
    const token = this.getTokenAt(x, y);
    if (token && this.canControlToken(token)) {
      this.dragging = {
        tokenId: token.id,
        offsetX: x - token.x,
        offsetY: y - token.y,
      };
      this.canvas.style.cursor = "grabbing";
    }
  }

  onMouseMove(e) {
    if (!this.dragging) return;
    const { x, y } = this.screenToGrid(e.clientX, e.clientY);
    const token = this.tokens.get(this.dragging.tokenId);
    if (!token) return;

    token.x = x - this.dragging.offsetX;
    token.y = y - this.dragging.offsetY;
    this.render();

    // throttled sync (100ms)
    this.scheduleTokenSync(token);
  }

  onMouseUp(e) {
    if (this.dragging) {
      const token = this.tokens.get(this.dragging.tokenId);
      if (token) {
        // 격자에 스냅
        token.x = Math.round(token.x);
        token.y = Math.round(token.y);
        this.syncToken(token, true);
      }
      this.dragging = null;
      this.canvas.style.cursor = "default";
      this.render();
    }
  }

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

  async syncToken(token, snap = false) {
    const tokenRef = doc(db, "rooms", this.roomCode, "tokens", token.id);
    try {
      await updateDoc(tokenRef, {
        x: token.x, y: token.y,
      });
    } catch (err) {
      console.error("토큰 동기화 실패:", err);
    }
  }

  // ===== 토큰 조작 =====

  async addToken({ name, color }) {
    const tokensRef = collection(db, "rooms", this.roomCode, "tokens");
    const defaultColor = color || TOKEN_COLORS[this.tokens.size % TOKEN_COLORS.length];
    try {
      await addDoc(tokensRef, {
        name: name || "토큰",
        x: Math.floor(this.mapConfig.cols / 2),
        y: Math.floor(this.mapConfig.rows / 2),
        color: defaultColor,
        ownerId: this.currentUser.uid,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.error("토큰 추가 실패:", err);
      alert("토큰 추가에 실패했습니다.");
    }
  }

  async deleteToken(tokenId) {
    const tokenRef = doc(db, "rooms", this.roomCode, "tokens", tokenId);
    try {
      await deleteDoc(tokenRef);
    } catch (err) {
      console.error("토큰 삭제 실패:", err);
    }
  }

  async setMapConfig(config) {
    const mapRef = doc(db, "rooms", this.roomCode, "meta", "map");
    await setDoc(mapRef, { ...this.mapConfig, ...config }, { merge: true });
  }

  // ===== 렌더링 =====

  render() {
    const { ctx, canvas } = this;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.scale, this.camera.scale);

    // 배경 이미지
    const mapWidth = this.mapConfig.cols * CELL_SIZE;
    const mapHeight = this.mapConfig.rows * CELL_SIZE;
    if (this.backgroundImage) {
      ctx.drawImage(this.backgroundImage, 0, 0, mapWidth, mapHeight);
    }

    // 그리드
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.mapConfig.cols; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, mapHeight);
      ctx.stroke();
    }
    for (let j = 0; j <= this.mapConfig.rows; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * CELL_SIZE);
      ctx.lineTo(mapWidth, j * CELL_SIZE);
      ctx.stroke();
    }

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

    // 원형 배경
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = token.color || "#e94560";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // 이름 (이니셜)
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${CELL_SIZE * 0.35}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const initial = (token.name || "?")[0].toUpperCase();
    ctx.fillText(initial, px, py);

    // 이름 라벨 (아래)
    if (token.name) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(px - CELL_SIZE * 0.5, py + r + 2, CELL_SIZE, 14);
      ctx.fillStyle = "#fff";
      ctx.font = `${CELL_SIZE * 0.22}px sans-serif`;
      ctx.fillText(token.name.slice(0, 10), px, py + r + 9);
    }
  }

  destroy() {
    this.unsubTokens?.();
    this.unsubMap?.();
  }
}
