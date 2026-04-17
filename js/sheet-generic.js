// 범용 캐릭터 시트 (자유 입력 기반)

export function createEmptyGenericCharacter() {
  return {
    name: "",
    hp: 0, hpMax: 0,
    customFields: [
      { label: "STR", value: "" },
      { label: "DEX", value: "" },
      { label: "CON", value: "" },
      { label: "INT", value: "" },
      { label: "WIS", value: "" },
      { label: "CHA", value: "" },
    ],
    notes: "",
  };
}

export function renderGenericSheet(container, data, options = {}) {
  const c = data || createEmptyGenericCharacter();

  container.innerHTML = `
    <div class="generic-sheet">
      <label>이름
        <input type="text" data-path="name" value="${escape(c.name)}" placeholder="캐릭터 이름" />
      </label>

      <label>HP
        <div class="stat-row">
          <input type="number" data-path="hp" value="${c.hp || 0}" />
          <span>/</span>
          <input type="number" data-path="hpMax" value="${c.hpMax || 0}" />
        </div>
      </label>

      <div class="sheet-section">
        <div class="section-title">
          <span>커스텀 필드</span>
          <button type="button" class="btn btn-small" id="btn-add-field">+ 추가</button>
        </div>
        <div id="custom-fields">
          ${(c.customFields || []).map((f, i) => `
            <div class="custom-field-row" data-index="${i}">
              <input type="text" class="field-label" data-path="customFields.${i}.label" value="${escape(f.label)}" />
              <input type="text" class="field-value" data-path="customFields.${i}.value" value="${escape(f.value)}" />
              <button type="button" class="btn-remove-field">×</button>
            </div>
          `).join("")}
        </div>
      </div>

      <label>메모
        <textarea data-path="notes" rows="4" placeholder="장비, 스킬, 자유 메모...">${escape(c.notes)}</textarea>
      </label>

      <button type="button" class="btn btn-primary btn-save" id="btn-save-sheet">💾 저장</button>
    </div>
  `;

  // 필드 추가
  container.querySelector("#btn-add-field")?.addEventListener("click", () => {
    const list = container.querySelector("#custom-fields");
    const idx = list.children.length;
    const div = document.createElement("div");
    div.className = "custom-field-row";
    div.dataset.index = idx;
    div.innerHTML = `
      <input type="text" class="field-label" data-path="customFields.${idx}.label" placeholder="이름" />
      <input type="text" class="field-value" data-path="customFields.${idx}.value" placeholder="값" />
      <button type="button" class="btn-remove-field">×</button>
    `;
    list.appendChild(div);
  });

  // 필드 삭제
  container.addEventListener("click", (e) => {
    if (e.target.classList.contains("btn-remove-field")) {
      e.target.closest(".custom-field-row").remove();
    }
  });

  // 저장
  if (options.onSave) {
    container.querySelector("#btn-save-sheet")?.addEventListener("click", () => {
      const data = collectGenericData(container);
      options.onSave(data);
    });
  }
}

export function collectGenericData(container) {
  const data = { name: "", hp: 0, hpMax: 0, customFields: [], notes: "" };

  data.name = container.querySelector('[data-path="name"]')?.value || "";
  data.hp = parseInt(container.querySelector('[data-path="hp"]')?.value, 10) || 0;
  data.hpMax = parseInt(container.querySelector('[data-path="hpMax"]')?.value, 10) || 0;
  data.notes = container.querySelector('[data-path="notes"]')?.value || "";

  container.querySelectorAll(".custom-field-row").forEach((row) => {
    const label = row.querySelector(".field-label")?.value || "";
    const value = row.querySelector(".field-value")?.value || "";
    if (label || value) data.customFields.push({ label, value });
  });

  return data;
}

function escape(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
