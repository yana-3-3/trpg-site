// 주사위 & 판정 로직

/** 일반 주사위 식 파싱 ("2d6+3") */
export function parseDice(formula) {
  const clean = formula.replace(/\s+/g, "").toLowerCase();
  const match = clean.match(/^(\d+)?d(\d+)([+-]\d+)?$/);
  if (!match) return null;
  const count = parseInt(match[1] || "1", 10);
  const sides = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;
  if (count < 1 || count > 100) return null;
  if (sides < 2 || sides > 1000) return null;
  return { count, sides, modifier };
}

export function rollDice(formula) {
  const parsed = parseDice(formula);
  if (!parsed) return null;
  const { count, sides, modifier } = parsed;
  const rolls = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  return {
    kind: "standard",
    formula: `${count}d${sides}${modifier ? (modifier > 0 ? "+" + modifier : modifier) : ""}`,
    rolls,
    modifier,
    total: sum + modifier,
  };
}

/**
 * CoC 7판 기능 판정 (1d100 ≤ 수치)
 * @param {number} target - 기능 수치 (0~100)
 * @param {string} skillName - 표시용 이름
 * @param {number} bonusDice - 보너스 다이스 개수 (0~2)
 * @param {number} penaltyDice - 페널티 다이스 개수 (0~2)
 */
export function rollCoCSkill(target, skillName = "판정", bonusDice = 0, penaltyDice = 0) {
  target = Math.max(0, Math.min(100, Math.floor(target)));

  // 보너스/페널티: 10의 자리 다이스를 여러 개 굴려 유리/불리한 쪽 선택
  // 1의 자리는 고정으로 한 번만 굴림
  const onesRoll = Math.floor(Math.random() * 10); // 0~9
  const tensRolls = [Math.floor(Math.random() * 10)]; // 0~9

  const extra = Math.max(bonusDice, penaltyDice);
  for (let i = 0; i < extra; i++) {
    tensRolls.push(Math.floor(Math.random() * 10));
  }

  // 각 tens값을 실제 d100 값으로 조합
  const candidates = tensRolls.map((t) => {
    // tens=0, ones=0 은 100으로 처리
    if (t === 0 && onesRoll === 0) return 100;
    return t * 10 + onesRoll;
  });

  // 보너스: 가장 작은 값 선택 (성공 확률 ↑), 페널티: 가장 큰 값 선택
  let finalRoll;
  if (bonusDice > 0) {
    finalRoll = Math.min(...candidates);
  } else if (penaltyDice > 0) {
    finalRoll = Math.max(...candidates);
  } else {
    finalRoll = candidates[0];
  }

  // 성공 단계 판정
  let level;
  if (finalRoll === 1) level = "critical"; // 크리티컬
  else if (finalRoll <= Math.floor(target / 5)) level = "extreme";
  else if (finalRoll <= Math.floor(target / 2)) level = "hard";
  else if (finalRoll <= target) level = "regular";
  else if (target < 50 && finalRoll >= 96) level = "fumble";
  else if (target >= 50 && finalRoll === 100) level = "fumble";
  else level = "fail";

  const levelLabel = {
    critical: "💎 크리티컬 성공",
    extreme: "✨ 극단적 성공",
    hard: "⭐ 어려운 성공",
    regular: "✓ 성공",
    fail: "✗ 실패",
    fumble: "💀 펌블",
  }[level];

  return {
    kind: "coc_skill",
    skillName,
    target,
    roll: finalRoll,
    tensRolls,
    onesRoll,
    bonusDice,
    penaltyDice,
    level,
    levelLabel,
    thresholds: {
      extreme: Math.floor(target / 5),
      hard: Math.floor(target / 2),
      regular: target,
    },
  };
}

/**
 * 채팅 입력 파싱
 * 지원 형식:
 *   /roll 2d6+3       → 일반 주사위
 *   /r 1d20           → 일반 주사위 단축
 *   /cc 50            → CoC 기능 판정 (수치 50)
 *   /cc 65 심리학     → 이름 붙여서
 *   /ccb 60 목격      → 보너스 다이스
 *   /ccp 40 은밀      → 페널티 다이스
 */
export function detectDiceCommand(message) {
  const trimmed = message.trim();

  // CoC 기능 판정
  const ccMatch = trimmed.match(/^\/cc(b|p)?\s+(\d+)(?:\s+(.+))?$/i);
  if (ccMatch) {
    const [, mode, targetStr, skillName] = ccMatch;
    const target = parseInt(targetStr, 10);
    const bonus = mode?.toLowerCase() === "b" ? 1 : 0;
    const penalty = mode?.toLowerCase() === "p" ? 1 : 0;
    return rollCoCSkill(target, skillName || "기능 판정", bonus, penalty);
  }

  // 일반 주사위
  const rollMatch = trimmed.match(/^\/(?:roll|r)\s+(.+)$/i);
  if (rollMatch) return rollDice(rollMatch[1]);

  return null;
}
