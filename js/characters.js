// 캐릭터 프로필 시스템 (비주얼 노벨 스타일)
// v4: 한 캐릭터에 여러 이미지(표정/포즈) 지원, 빠른 전환 UI

import { db } from "./firebase-config.js";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const PRESET_COLORS = [
  "#ff6b9d", "#ff9e6b", "#ffd96b", "#a8ff6b",
  "#6bffd9", "#6bb5ff", "#b56bff", "#ff6bcf",
  "#e94560", "#f5a623", "#50e3c2", "#9013fe",
];

/**
 * 캐릭터 데이터 구조:
 * {
 *   id, name, color, ownerId,
 *   images: [{ label, url }, ...],  // 이미지 목록 (표정/포즈)
 *   activeImageIndex: 0             // 현재 선택된 이미지 인덱스
 * }
 */

export class CharacterManager {
  constructor({ roomCode, currentUser, onChange }) {
    this.roomCode = roomCode;
    this.currentUser = currentUser;
    this.onChange = onChange;
    this.characters = new Map();
    this.activeCharacterId = null;

    this.loadActiveFromStorage();
    this.subscribe();
  }

  loadActiveFromStorage() {
    const key = `active-char:${this.roomCode}:${this.currentUser.uid}`;
    this.activeCharacterId = sessionStorage.getItem(key);
  }

  setActiveCharacter(charId) {
    this.activeCharacterId = charId;
    const key = `active-char:${this.roomCode}:${this.currentUser.uid}`;
    if (charId) sessionStorage.setItem(key, charId);
    else sessionStorage.removeItem(key);
    this.onChange?.();
  }

  getActiveCharacter() {
    if (!this.activeCharacterId) return null;
    return this.characters.get(this.activeCharacterId) || null;
  }

  // 현재 활성 이미지 URL 반환
  getActiveImageUrl(char) {
    if (!char) return null;
    if (char.images && char.images.length > 0) {
      const idx = char.activeImageIndex ?? 0;
      return char.images[idx]?.url || char.images[0]?.url || null;
    }
    // 구버전 호환: imageUrl 필드
    return char.imageUrl || null;
  }

  getMyCharacters() {
    return [...this.characters.values()].filter(c => c.ownerId === this.currentUser.uid);
  }

  getAllCharacters() {
    return [...this.characters.values()];
  }

  subscribe() {
    const ref = collection(db, "rooms", this.roomCode, "characters");
    this.unsub = onSnapshot(ref, (snap) => {
      this.characters.clear();
      snap.forEach(d => {
        const data = d.data();
        // 구버전 imageUrl을 images 배열로 마이그레이션 (읽기만)
        if (!data.images && data.imageUrl) {
          data.images = [{ label: "기본", url: data.imageUrl }];
          data.activeImageIndex = 0;
        }
        this.characters.set(d.id, { id: d.id, ...data });
      });
      if (this.activeCharacterId && !this.characters.has(this.activeCharacterId)) {
        this.setActiveCharacter(null);
      }
      this.onChange?.();
    });
  }

  async saveCharacter(character) {
    const id = character.id || `${this.currentUser.uid}_${Date.now()}`;
    const ref = doc(db, "rooms", this.roomCode, "characters", id);
    const data = {
      name: character.name || "무명",
      images: Array.isArray(character.images) ? character.images.filter(i => i.url) : [],
      activeImageIndex: Math.max(0, character.activeImageIndex ?? 0),
      color: character.color || PRESET_COLORS[0],
      ownerId: this.currentUser.uid,
      updatedAt: Date.now(),
    };
    // 구버전 호환을 위해 imageUrl도 저장
    if (data.images[data.activeImageIndex]) {
      data.imageUrl = data.images[data.activeImageIndex].url;
    }
    await setDoc(ref, data, { merge: false });
    return id;
  }

  // 이미지 인덱스만 빠르게 변경 (표정 전환용)
  async setActiveImage(charId, imageIndex) {
    const char = this.characters.get(charId);
    if (!char || char.ownerId !== this.currentUser.uid) return;
    const ref = doc(db, "rooms", this.roomCode, "characters", charId);
    const url = char.images?.[imageIndex]?.url || "";
    await updateDoc(ref, {
      activeImageIndex: imageIndex,
      imageUrl: url,
      updatedAt: Date.now(),
    });
  }

  async deleteCharacter(charId) {
    const char = this.characters.get(charId);
    if (!char || char.ownerId !== this.currentUser.uid) return;
    const ref = doc(db, "rooms", this.roomCode, "characters", charId);
    await deleteDoc(ref);
    if (this.activeCharacterId === charId) this.setActiveCharacter(null);
  }

  destroy() { this.unsub?.(); }
}

// ===== 캐릭터 편집 모달 =====
export function openCharacterEditor(manager, characterId = null) {
  const existing = characterId ? manager.characters.get(characterId) : null;
  const data = existing ? JSON.parse(JSON.stringify(existing)) : {
    name: "",
    color: PRESET_COLORS[0],
    images: [],
    activeImageIndex: 0,
  };

  // images 배열이 비어있다면 기본 빈 슬롯 1개 제공
  if (!data.images || data.images.length === 0) {
    data.images = [{ label: "기본", url: "" }];
    data.activeImageIndex = 0;
  }

  const modal = document.createElement("div");
  modal.className = "modal char-editor-modal";
  modal.innerHTML = `
    <div class="modal-content char-editor">
      <h3>${existing ? "캐릭터 편집" : "새 캐릭터"}</h3>

      <div class="char-editor-body">
        <div class="char-preview">
          <div class="preview-frame">
            <img id="preview-img" alt="" />
            <div class="preview-placeholder">이미지 미리보기</div>
          </div>
          <div class="preview-name" id="preview-name">캐릭터 이름</div>
        </div>

        <div class="char-fields">
          <label>이름
            <input type="text" id="char-name" value="${escape(data.name)}" maxlength="20" placeholder="캐릭터 이름" />
          </label>

          <label style="display:flex;justify-content:space-between;align-items:center">
            <span>이미지 (표정·포즈)</span>
            <button type="button" class="btn btn-small btn-secondary" id="btn-add-image">+ 이미지 추가</button>
          </label>
          <div id="image-list" class="image-list"></div>
          <p class="hint">
            💡 여러 이미지를 등록하면 <strong>발언 중 표정/포즈를 실시간으로 바꿀 수 있어요.</strong><br>
            세로로 긴 투명 PNG가 가장 잘 어울립니다.
          </p>

          <label>이름 색상</label>
          <div class="color-picker">
            ${PRESET_COLORS.map(c => `
              <button type="button" class="color-swatch ${c === data.color ? "selected" : ""}"
                      style="background: ${c}" data-color="${c}"></button>
            `).join("")}
            <input type="color" id="char-color-custom" value="${data.color}" title="커스텀 색상" />
          </div>
        </div>
      </div>

      <div class="modal-actions">
        ${existing ? '<button id="char-delete" class="btn btn-danger">삭제</button>' : ''}
        <div style="flex:1"></div>
        <button id="char-cancel" class="btn btn-secondary">취소</button>
        <button id="char-save" class="btn btn-primary">${existing ? "저장" : "만들기"}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  if (window.lucide) window.lucide.createIcons();

  const state = data;

  const previewImg = modal.querySelector("#preview-img");
  const previewName = modal.querySelector("#preview-name");
  const imageListEl = modal.querySelector("#image-list");
  const nameInput = modal.querySelector("#char-name");
  const colorCustom = modal.querySelector("#char-color-custom");

  function updatePreview() {
    previewName.textContent = state.name || "캐릭터 이름";
    previewName.style.color = state.color;
    const activeImg = state.images[state.activeImageIndex];
    if (activeImg?.url) {
      previewImg.src = activeImg.url;
      previewImg.style.display = "block";
    } else {
      previewImg.style.display = "none";
      previewImg.src = "";
    }
  }

  function renderImageList() {
    imageListEl.innerHTML = "";
    state.images.forEach((img, idx) => {
      const row = document.createElement("div");
      row.className = "image-row" + (idx === state.activeImageIndex ? " active" : "");
      row.innerHTML = `
        <input type="radio" name="active-img" ${idx === state.activeImageIndex ? "checked" : ""} title="미리보기 이미지" />
        <input type="text" class="img-label" placeholder="라벨 (예: 기본/웃음/놀람)" value="${escape(img.label || "")}" maxlength="10" />
        <input type="text" class="img-url" placeholder="이미지 URL" value="${escape(img.url || "")}" />
        <button type="button" class="btn-remove-img" title="삭제" ${state.images.length <= 1 ? "disabled" : ""}>×</button>
      `;
      row.querySelector('input[type="radio"]').addEventListener("change", () => {
        state.activeImageIndex = idx;
        renderImageList();
        updatePreview();
      });
      row.querySelector(".img-label").addEventListener("input", (e) => {
        state.images[idx].label = e.target.value;
      });
      row.querySelector(".img-url").addEventListener("input", (e) => {
        state.images[idx].url = e.target.value.trim();
        if (idx === state.activeImageIndex) updatePreview();
      });
      row.querySelector(".btn-remove-img").addEventListener("click", () => {
        if (state.images.length <= 1) return;
        state.images.splice(idx, 1);
        if (state.activeImageIndex >= state.images.length) {
          state.activeImageIndex = state.images.length - 1;
        }
        renderImageList();
        updatePreview();
      });
      imageListEl.appendChild(row);
    });
  }

  previewImg.onerror = () => { previewImg.style.display = "none"; };

  nameInput.addEventListener("input", () => {
    state.name = nameInput.value;
    updatePreview();
  });

  modal.querySelectorAll(".color-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
      state.color = btn.dataset.color;
      modal.querySelectorAll(".color-swatch").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      colorCustom.value = state.color;
      updatePreview();
    });
  });

  colorCustom.addEventListener("input", () => {
    state.color = colorCustom.value;
    modal.querySelectorAll(".color-swatch").forEach(b => b.classList.remove("selected"));
    updatePreview();
  });

  modal.querySelector("#btn-add-image").addEventListener("click", () => {
    if (state.images.length >= 10) {
      alert("이미지는 최대 10개까지 등록할 수 있어요.");
      return;
    }
    state.images.push({ label: `표정${state.images.length + 1}`, url: "" });
    renderImageList();
  });

  modal.querySelector("#char-cancel").addEventListener("click", () => modal.remove());

  modal.querySelector("#char-save").addEventListener("click", async () => {
    if (!state.name.trim()) {
      alert("이름을 입력해주세요.");
      return;
    }
    // 빈 URL 이미지 필터링
    const validImages = state.images.filter(i => i.url);
    if (validImages.length === 0) {
      if (!confirm("등록된 이미지가 없습니다. 이대로 저장할까요? (이름과 색상만 사용됨)")) return;
    }
    try {
      const id = await manager.saveCharacter({
        id: characterId,
        name: state.name.trim(),
        color: state.color,
        images: validImages,
        activeImageIndex: Math.min(state.activeImageIndex, Math.max(0, validImages.length - 1)),
      });
      if (!characterId) manager.setActiveCharacter(id);
      modal.remove();
    } catch (err) {
      console.error(err);
      alert("저장 실패: " + err.message);
    }
  });

  const deleteBtn = modal.querySelector("#char-delete");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(`'${state.name}' 캐릭터를 삭제할까요?`)) return;
      await manager.deleteCharacter(characterId);
      modal.remove();
    });
  }

  // 초기 렌더
  renderImageList();
  updatePreview();
}

function escape(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
