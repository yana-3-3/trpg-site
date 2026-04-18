// BGM 시스템
// GM이 오디오 URL 또는 YouTube 링크를 공유하면 모든 참가자에게 재생
// - 오디오(mp3/ogg/wav): HTML5 Audio 사용 (반복 재생, 볼륨 조절)
// - YouTube: iframe API로 BGM 재생

import { db } from "./firebase-config.js";
import {
  doc, setDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export class BGMSystem {
  constructor({ roomCode, isGM }) {
    this.roomCode = roomCode;
    this.isGM = isGM;
    this.audioEl = null;
    this.ytPlayer = null;
    this.ytContainer = null;
    this.currentBgm = null; // { url, type, volume, playing, updatedAt }
    this.localVolume = parseFloat(localStorage.getItem("bgm-local-volume") || "0.5");
    this.localMuted = localStorage.getItem("bgm-muted") === "true";

    this.setupYouTubeAPI();
    this.subscribe();
  }

  // ===== YouTube API 로드 =====
  setupYouTubeAPI() {
    if (window.YT && window.YT.Player) {
      this.ytReady = true;
      return;
    }
    // 전역 콜백 설정
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      this.ytReady = true;
      prevCallback?.();
      // 이미 구독 중이면 다시 적용
      if (this.currentBgm) this.applyBGM(this.currentBgm);
    };
    // 스크립트 로드
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }

    // 숨겨진 YT 컨테이너 준비
    this.ytContainer = document.createElement("div");
    this.ytContainer.id = "bgm-yt-container";
    this.ytContainer.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;";
    document.body.appendChild(this.ytContainer);

    const ytPlayerDiv = document.createElement("div");
    ytPlayerDiv.id = "bgm-yt-player";
    this.ytContainer.appendChild(ytPlayerDiv);
  }

  // ===== URL 분석 =====
  detectType(url) {
    if (!url) return null;
    // YouTube 감지
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) return { type: "youtube", id: ytMatch[1] };

    // 오디오 파일 확장자
    if (/\.(mp3|ogg|wav|m4a|opus|aac)(\?|$)/i.test(url)) {
      return { type: "audio", src: url };
    }

    // 그 외는 audio로 시도
    return { type: "audio", src: url };
  }

  // ===== Firestore 구독 =====
  subscribe() {
    const ref = doc(db, "rooms", this.roomCode, "meta", "bgm");
    this.unsub = onSnapshot(ref, (snap) => {
      const data = snap.exists() ? snap.data() : null;
      this.currentBgm = data;
      this.applyBGM(data);
      this.onChange?.(data);
    });
  }

  // ===== BGM 적용 =====
  applyBGM(bgm) {
    if (!bgm || !bgm.url || !bgm.playing) {
      this.stop();
      return;
    }

    const info = this.detectType(bgm.url);
    if (!info) return;

    if (info.type === "youtube") {
      this.playYouTube(info.id, bgm.volume ?? 0.5);
    } else {
      this.playAudio(info.src, bgm.volume ?? 0.5);
    }
  }

  // ===== HTML5 오디오 =====
  playAudio(src, volume) {
    this.stopYouTube();

    if (!this.audioEl) {
      this.audioEl = new Audio();
      this.audioEl.loop = true;
      this.audioEl.crossOrigin = "anonymous";
    }

    if (this.audioEl.src !== src) {
      this.audioEl.src = src;
    }

    this.audioEl.volume = this.localMuted ? 0 : (volume * this.localVolume);
    const playPromise = this.audioEl.play();
    if (playPromise) {
      playPromise.catch(err => {
        console.warn("BGM 자동재생 차단됨 (사용자 상호작용 필요):", err.message);
        this.onAutoplayBlocked?.();
      });
    }
  }

  // ===== YouTube =====
  playYouTube(videoId, volume) {
    this.stopAudio();

    if (!this.ytReady) {
      // 아직 API 안 로드된 경우 로드 대기
      this._pendingYT = { videoId, volume };
      return;
    }

    const volumePercent = Math.round((this.localMuted ? 0 : (volume * this.localVolume)) * 100);

    if (!this.ytPlayer) {
      this.ytPlayer = new YT.Player("bgm-yt-player", {
        width: 1,
        height: 1,
        videoId,
        playerVars: {
          autoplay: 1,
          loop: 1,
          playlist: videoId, // loop을 위해 필요
          controls: 0,
          showinfo: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (e) => {
            e.target.setVolume(volumePercent);
            e.target.playVideo();
          },
          onStateChange: (e) => {
            // 영상 끝나면 처음부터 다시
            if (e.data === YT.PlayerState.ENDED) {
              e.target.seekTo(0);
              e.target.playVideo();
            }
          },
          onError: (e) => {
            console.warn("YouTube BGM 에러:", e.data);
          },
        },
      });
    } else {
      const currentId = this.ytPlayer.getVideoData?.().video_id;
      if (currentId !== videoId) {
        this.ytPlayer.loadVideoById(videoId);
      } else if (this.ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
        this.ytPlayer.playVideo();
      }
      this.ytPlayer.setVolume(volumePercent);
    }
  }

  stopAudio() {
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = "";
    }
  }

  stopYouTube() {
    if (this.ytPlayer && this.ytPlayer.stopVideo) {
      try { this.ytPlayer.stopVideo(); } catch (e) {}
    }
  }

  stop() {
    this.stopAudio();
    this.stopYouTube();
  }

  // ===== 로컬 볼륨 (개인 설정) =====
  setLocalVolume(v) {
    this.localVolume = Math.max(0, Math.min(1, v));
    localStorage.setItem("bgm-local-volume", String(this.localVolume));
    this.updateVolume();
  }

  setLocalMuted(muted) {
    this.localMuted = !!muted;
    localStorage.setItem("bgm-muted", String(this.localMuted));
    this.updateVolume();
  }

  updateVolume() {
    if (!this.currentBgm) return;
    const base = this.currentBgm.volume ?? 0.5;
    const effective = this.localMuted ? 0 : (base * this.localVolume);
    if (this.audioEl) this.audioEl.volume = effective;
    if (this.ytPlayer?.setVolume) this.ytPlayer.setVolume(Math.round(effective * 100));
  }

  // ===== GM 조작 =====
  async updateBGM({ url, volume, playing }) {
    const ref = doc(db, "rooms", this.roomCode, "meta", "bgm");
    await setDoc(ref, {
      url: url ?? this.currentBgm?.url ?? "",
      volume: volume ?? this.currentBgm?.volume ?? 0.5,
      playing: playing ?? false,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  destroy() {
    this.unsub?.();
    this.stop();
    this.ytContainer?.remove();
  }
}

// ===== GM 컨트롤 모달 열기 =====
export function openBGMControlModal(bgmSystem) {
  const current = bgmSystem.currentBgm || {};
  const modal = document.createElement("div");
  modal.className = "modal bgm-modal";
  modal.innerHTML = `
    <div class="modal-content">
      <h3>🎵 BGM 컨트롤 <span class="gm-tag">GM</span></h3>
      <label>오디오 URL (mp3/ogg/wav) 또는 YouTube 링크
        <input type="text" id="bgm-url" value="${escape(current.url || "")}" placeholder="https://... 또는 https://youtu.be/..." />
      </label>

      <label>볼륨 <span id="bgm-vol-display">${Math.round((current.volume ?? 0.5) * 100)}%</span>
        <input type="range" id="bgm-volume" min="0" max="100" value="${Math.round((current.volume ?? 0.5) * 100)}" />
      </label>

      <p class="hint">
        💡 <strong>오디오 호스팅 팁</strong>: GitHub 저장소에 직접 업로드하고 raw URL을 쓰거나,
        무료 호스팅 서비스를 이용하세요. YouTube는 브라우저 정책상 사용자 클릭이 있어야 재생됩니다.
      </p>

      <div class="modal-actions">
        <button id="bgm-stop" class="btn btn-ghost">⏹ 정지</button>
        <div style="flex:1"></div>
        <button id="bgm-cancel" class="btn btn-secondary">닫기</button>
        <button id="bgm-play" class="btn btn-primary">▶ 재생 / 변경</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const urlInput = modal.querySelector("#bgm-url");
  const volSlider = modal.querySelector("#bgm-volume");
  const volDisplay = modal.querySelector("#bgm-vol-display");

  volSlider.addEventListener("input", () => {
    volDisplay.textContent = volSlider.value + "%";
  });

  modal.querySelector("#bgm-play").addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) {
      alert("URL을 입력해주세요.");
      return;
    }
    await bgmSystem.updateBGM({
      url,
      volume: parseInt(volSlider.value, 10) / 100,
      playing: true,
    });
    modal.remove();
  });

  modal.querySelector("#bgm-stop").addEventListener("click", async () => {
    await bgmSystem.updateBGM({ playing: false });
    modal.remove();
  });

  modal.querySelector("#bgm-cancel").addEventListener("click", () => modal.remove());
}

// ===== 플레이어 컨트롤 (개인 볼륨/뮤트) =====
export function createBGMPlayerControl(bgmSystem, container) {
  container.innerHTML = `
    <div class="bgm-player-control">
      <button id="bgm-mute-btn" class="icon-btn" title="음소거">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="bgm-icon">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      </button>
      <input type="range" id="bgm-local-vol" min="0" max="100" value="${Math.round(bgmSystem.localVolume * 100)}" class="bgm-vol-slider" />
    </div>
  `;

  const muteBtn = container.querySelector("#bgm-mute-btn");
  const muteIcon = container.querySelector("#bgm-icon");
  const slider = container.querySelector("#bgm-local-vol");

  function updateIcon() {
    if (bgmSystem.localMuted || bgmSystem.localVolume === 0) {
      muteIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`;
    } else {
      muteIcon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    }
  }
  updateIcon();

  muteBtn.addEventListener("click", () => {
    bgmSystem.setLocalMuted(!bgmSystem.localMuted);
    updateIcon();
  });

  slider.addEventListener("input", () => {
    bgmSystem.setLocalVolume(parseInt(slider.value, 10) / 100);
    updateIcon();
  });
}

function escape(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
