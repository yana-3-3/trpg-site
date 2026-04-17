// CoC 7판 캐릭터 시트 템플릿 및 로직

// 8대 능력치
export const COC7_CHARACTERISTICS = [
  { key: "str", label: "STR (근력)" },
  { key: "con", label: "CON (건강)" },
  { key: "siz", label: "SIZ (체격)" },
  { key: "dex", label: "DEX (민첩)" },
  { key: "app", label: "APP (외모)" },
  { key: "int", label: "INT (지능)" },
  { key: "pow", label: "POW (정신력)" },
  { key: "edu", label: "EDU (교육)" },
];

// 기본 기능 리스트 (7판 핵심 기능들)
export const COC7_DEFAULT_SKILLS = [
  { name: "회계", base: 5 },
  { name: "인류학", base: 1 },
  { name: "감정", base: 5 },
  { name: "고고학", base: 1 },
  { name: "예술/공예", base: 5 },
  { name: "매혹", base: 15 },
  { name: "등반", base: 20 },
  { name: "신용도", base: 0 },
  { name: "크툴루 신화", base: 0 },
  { name: "위장", base: 5 },
  { name: "운전(자동차)", base: 20 },
  { name: "전기 수리", base: 10 },
  { name: "회피", base: 0 }, // DEX/2
  { name: "말재주", base: 5 },
  { name: "사격(권총)", base: 20 },
  { name: "사격(라이플/샷건)", base: 25 },
  { name: "응급처치", base: 30 },
  { name: "역사", base: 5 },
  { name: "위협", base: 15 },
  { name: "도약", base: 20 },
  { name: "모국어", base: 0 }, // EDU
  { name: "법률", base: 5 },
  { name: "도서관 이용", base: 20 },
  { name: "듣기", base: 20 },
  { name: "자물쇠 따기", base: 1 },
  { name: "기계 수리", base: 10 },
  { name: "의학", base: 1 },
  { name: "자연", base: 10 },
  { name: "항법", base: 10 },
  { name: "오컬트", base: 5 },
  { name: "중장비 조작", base: 1 },
  { name: "설득", base: 10 },
  { name: "조종(지정)", base: 1 },
  { name: "심리학", base: 10 },
  { name: "정신분석학", base: 1 },
  { name: "승마", base: 5 },
  { name: "과학(지정)", base: 1 },
  { name: "자물쇠공", base: 1 },
  { name: "은밀 행동", base: 20 },
  { name: "수영", base: 20 },
  { name: "투척", base: 20 },
  { name: "추적", base: 10 },
  { name: "훈련된 동물", base: 5 },
  { name: "발견", base: 25 },
  { name: "잠입", base: 10 },
  { name: "주먹질(격투)", base: 25 },
];

// 파생 수치 자동 계산
export function computeDerived(stats) {
  const { str = 0, con = 0, siz = 0, dex = 0, pow = 0 } = stats;
  return {
    hpMax: Math.floor((con + siz) / 10),
    mpMax: Math.floor(pow / 5),
    sanMax: pow,
    dodgeBase: Math.floor(dex / 2),
    // 이동력 간이 계산
    move: (dex < siz && str < siz) ? 7 : (dex >= siz && str >= siz) ? 9 : 8,
  };
}

// 초기 캐릭터 데이터 생성
export function createEmptyCoC7Character() {
  return {
    name: "",
    occupation: "",
    age: "",
    stats: { str: 0, con: 0, siz: 0, dex: 0, app: 0, int: 0, pow: 0, edu: 0 },
    hp: 0, mp: 0, san: 0, luck: 0,
    skills: COC7_DEFAULT_SKILLS.map(s => ({ ...s, value: s.base })),
    notes: "",
  };
}

// 능력치 주사위 굴리기 (3d6×5 또는 (2d6+6)×5)
export function rollCharacteristic(type) {
  // type: "3d6x5" | "2d6+6x5"
  const rollDie = () => Math.floor(Math.random() * 6) + 1;
  if (type === "3d6x5") {
    return (rollDie() + rollDie() + rollDie()) * 5;
  } else {
    return (rollDie() + rollDie() + 6) * 5;
  }
}

// 기본 캐릭터 능력치 랜덤 생성
export function rollAllCharacteristics() {
  return {
    str: rollCharacteristic("3d6x5"),
    con: rollCharacteristic("3d6x5"),
    siz: rollCharacteristic("2d6+6x5"),
    dex: rollCharacteristic("3d6x5"),
    app: rollCharacteristic("3d6x5"),
    int: rollCharacteristic("2d6+6x5"),
    pow: rollCharacteristic("3d6x5"),
    edu: rollCharacteristic("2d6+6x5"),
  };
}

// ===== DOM 렌더링 =====

/**
 * CoC 7판 시트 HTML 생성 (컨테이너에 주입)
 */
export function renderCoC7Sheet(container, data, options = {}) {
  const c = data || createEmptyCoC7Character();
  const derived = computeDerived(c.stats);

  container.innerHTML = `
    <div class="coc-sheet">
      <div class="sheet-header">
        <label>이름<input type="text" data-path="name" value="${escape(c.name)}" /></label>
        <label>직업<input type="text" data-path="occupation" value="${escape(c.occupation)}" /></label>
        <label>나이<input type="number" data-path="age" value="${escape(c.age)}" /></label>
      </div>

      <div class="sheet-section">
        <div class="section-title">
          <span>능력치</span>
          <button type="button" class="btn btn-small" id="btn-roll-stats">🎲 랜덤 굴리기</button>
        </div>
        <div class="stats-grid coc-stats">
          ${COC7_CHARACTERISTICS.map(({ key, label }) => `
            <div class="coc-stat" data-stat="${key}">
              <label>${label}
                <input type="number" data-path="stats.${key}" value="${c.stats[key] || 0}" />
              </label>
              <div class="stat-thresholds">
                <span class="half">½ ${Math.floor((c.stats[key] || 0) / 2)}</span>
                <span class="fifth">⅕ ${Math.floor((c.stats[key] || 0) / 5)}</span>
              </div>
              <button type="button" class="btn-skill-roll" data-target="${c.stats[key] || 0}" data-name="${label}">판정</button>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="sheet-section derived">
        <div class="derived-stat">
          <label>HP <input type="number" data-path="hp" value="${c.hp || 0}" /></label>
          <span class="max">/ ${derived.hpMax}</span>
        </div>
        <div class="derived-stat">
          <label>MP <input type="number" data-path="mp" value="${c.mp || 0}" /></label>
          <span class="max">/ ${derived.mpMax}</span>
        </div>
        <div class="derived-stat">
          <label>SAN <input type="number" data-path="san" value="${c.san || 0}" /></label>
          <span class="max">/ ${derived.sanMax}</span>
          <button type="button" class="btn-skill-roll" data-target="${c.san || 0}" data-name="SAN 판정">SAN</button>
        </div>
        <div class="derived-stat">
          <label>행운 <input type="number" data-path="luck" value="${c.luck || 0}" /></label>
          <button type="button" class="btn-skill-roll" data-target="${c.luck || 0}" data-name="행운 판정">행운</button>
        </div>
        <div class="derived-stat">
          <span>이동력: <strong>${derived.move}</strong></span>
        </div>
      </div>

      <div class="sheet-section">
        <div class="section-title">
          <span>기능</span>
          <input type="text" id="skill-filter" placeholder="기능 검색..." class="skill-filter" />
        </div>
        <div class="skills-list" id="skills-list">
          ${(c.skills || []).map((s, i) => `
            <div class="skill-row" data-skill-index="${i}">
              <input type="text" class="skill-name" data-path="skills.${i}.name" value="${escape(s.name)}" />
              <input type="number" class="skill-value" data-path="skills.${i}.value" value="${s.value || s.base || 0}" />
              <button type="button" class="btn-skill-roll" data-target="${s.value || s.base || 0}" data-name="${escape(s.name)}">판정</button>
            </div>
          `).join("")}
        </div>
        <button type="button" class="btn btn-small btn-secondary" id="btn-add-skill">+ 기능 추가</button>
      </div>

      <div class="sheet-section">
        <label>메모
          <textarea data-path="notes" rows="3">${escape(c.notes)}</textarea>
        </label>
      </div>

      <button type="button" class="btn btn-primary btn-save" id="btn-save-sheet">💾 저장</button>
    </div>
  `;

  // === 이벤트 바인딩 ===

  // 능력치 변경 시 파생 수치 실시간 업데이트 & 판정 버튼 값 갱신
  container.querySelectorAll('input[data-path^="stats."]').forEach((input) => {
    input.addEventListener("input", () => {
      updateDerivedDisplay(container);
    });
  });

  // 능력치 랜덤 굴리기
  container.querySelector("#btn-roll-stats")?.addEventListener("click", () => {
    if (!confirm("능력치를 랜덤으로 다시 굴릴까요? 현재 값이 모두 덮어씌워집니다.")) return;
    const rolled = rollAllCharacteristics();
    for (const [key, val] of Object.entries(rolled)) {
      const input = container.querySelector(`input[data-path="stats.${key}"]`);
      if (input) input.value = val;
    }
    updateDerivedDisplay(container);
  });

  // 기능 추가
  container.querySelector("#btn-add-skill")?.addEventListener("click", () => {
    const list = container.querySelector("#skills-list");
    const idx = list.children.length;
    const div = document.createElement("div");
    div.className = "skill-row";
    div.dataset.skillIndex = idx;
    div.innerHTML = `
      <input type="text" class="skill-name" data-path="skills.${idx}.name" placeholder="기능 이름" />
      <input type="number" class="skill-value" data-path="skills.${idx}.value" value="0" />
      <button type="button" class="btn-skill-roll" data-target="0" data-name="">판정</button>
    `;
    list.appendChild(div);
  });

  // 기능 필터
  container.querySelector("#skill-filter")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    container.querySelectorAll("#skills-list .skill-row").forEach((row) => {
      const name = row.querySelector(".skill-name").value.toLowerCase();
      row.style.display = name.includes(q) ? "" : "none";
    });
  });

  // 기능 판정 버튼 → 콜백 호출
  if (options.onRollSkill) {
    container.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-skill-roll");
      if (!btn) return;
      // 최신 값 읽기
      const row = btn.closest(".skill-row, .coc-stat, .derived-stat");
      const valueInput = row?.querySelector(".skill-value, input[data-path^='stats.'], input[data-path='san'], input[data-path='luck']");
      const nameInput = row?.querySelector(".skill-name");
      const target = valueInput ? parseInt(valueInput.value, 10) || 0 : parseInt(btn.dataset.target, 10) || 0;
      const name = nameInput ? nameInput.value : btn.dataset.name;

      // 보너스/페널티 선택
      const mod = prompt(`${name} 판정 (수치 ${target})\n\n0: 일반\n1: 보너스 다이스\n2: 페널티 다이스`, "0");
      if (mod === null) return;
      const bonusDice = mod === "1" ? 1 : 0;
      const penaltyDice = mod === "2" ? 1 : 0;
      options.onRollSkill({ target, name, bonusDice, penaltyDice });
    });
  }

  // 저장 버튼 → 콜백
  if (options.onSave) {
    container.querySelector("#btn-save-sheet")?.addEventListener("click", () => {
      const data = collectSheetData(container);
      options.onSave(data);
    });
  }
}

// 파생 수치 표시 업데이트 (능력치 입력 시)
function updateDerivedDisplay(container) {
  const stats = {};
  container.querySelectorAll('input[data-path^="stats."]').forEach((input) => {
    const key = input.dataset.path.split(".")[1];
    stats[key] = parseInt(input.value, 10) || 0;
  });

  // 각 stat의 ½, ⅕ 업데이트
  container.querySelectorAll(".coc-stat").forEach((el) => {
    const key = el.dataset.stat;
    const val = stats[key] || 0;
    el.querySelector(".half").textContent = `½ ${Math.floor(val / 2)}`;
    el.querySelector(".fifth").textContent = `⅕ ${Math.floor(val / 5)}`;
  });

  // 파생 수치 max 표시
  const derived = computeDerived(stats);
  const maxes = container.querySelectorAll(".derived .max");
  if (maxes[0]) maxes[0].textContent = `/ ${derived.hpMax}`;
  if (maxes[1]) maxes[1].textContent = `/ ${derived.mpMax}`;
  if (maxes[2]) maxes[2].textContent = `/ ${derived.sanMax}`;
}

// 폼 데이터를 객체로 수집
export function collectSheetData(container) {
  const data = createEmptyCoC7Character();
  data.skills = [];

  container.querySelectorAll("[data-path]").forEach((el) => {
    const path = el.dataset.path.split(".");
    let val = el.value;
    if (el.type === "number") val = parseInt(val, 10) || 0;

    // data.stats.str, data.skills.0.name 등의 경로 설정
    let target = data;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (/^\d+$/.test(key)) {
        const idx = parseInt(key, 10);
        if (!target[idx]) target[idx] = {};
        target = target[idx];
      } else {
        if (!target[key]) target[key] = (/^\d+$/.test(path[i + 1]) ? [] : {});
        target = target[key];
      }
    }
    target[path[path.length - 1]] = val;
  });

  return data;
}

function escape(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
