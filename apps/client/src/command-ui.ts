/**
 * Text for flee, revive and cooldowns (O15, Nut 2026-10-07). The numbers come from the shared
 * functions the server runs; the server checks and rolls again when the command arrives.
 */
import { fleeChance, reviveBlock, type PublicBattleState, type RulesConfig, type SkillDefinition, type SpeciesDefinition } from "@pmrpg/shared";
import { pct2 } from "./capture-ui";

const pctOf = (p: number) => pct2(p / 100);

export function fleePreview(
  rules: RulesConfig,
  state: PublicBattleState,
  species: ReadonlyMap<string, SpeciesDefinition>,
  actorId: string,
  name: (unitId: string) => string,
): { ok: boolean; lines: string[] } {
  if (state.practice === true) return { ok: true, lines: ["ลานทดสอบ: ออกจากไฟต์ได้ทุกเมื่อ (100%) ไม่ได้และไม่เสียอะไร"] };
  const f = fleeChance(rules, species, state, actorId);
  if (!f.ok) {
    if (f.code === "FLEE_FORBIDDEN") return { ok: false, lines: [state.boss !== undefined ? "หนีไม่ได้: ไฟต์บอสหนีไม่ได้" : "หนีไม่ได้: มีศัตรูที่ไม่ยอมให้หนี"] };
    return { ok: false, lines: ["หนีได้เฉพาะในตาของตัวละครเรา"] };
  }
  const { minPct, maxPct } = rules.provisional.flee.value;
  const cap = f.capped === "max" ? ` (ถึงเพดาน ${maxPct}%)` : f.capped === "min" ? ` (ขั้นต่ำ ${minPct}%)` : "";
  const lines = [
    `โอกาสหนี ${pctOf(f.chancePct)}${cap}`,
    `ค่าหนีต่ำสุดของศัตรู ${f.basePct}% (${name(f.baseUnitId)}) × SPD เรา ${f.playerSpd} ÷ SPD ศัตรูที่เร็วที่สุด ${f.enemySpd}`,
    "หนีไม่สำเร็จจะเสียตานี้",
  ];
  if (state.frontier !== undefined) lines.push("ในหอคอย หนีสำเร็จถือว่าจบรอบของสัปดาห์นี้");
  return { ok: true, lines };
}

/** Why a revive cannot be used on this unit, or null when it can. */
export function reviveRefusal(rules: RulesConfig, state: PublicBattleState, actorId: string, targetId: string): string | null {
  const a = state.units.find((u) => u.unitId === actorId);
  const t = state.units.find((u) => u.unitId === targetId);
  if (a === undefined || t === undefined) return "ไม่มีพวกที่ล้มให้ชุบ";
  const b = reviveBlock(rules, state, a, t);
  if (b === null) return null;
  return b.code === "REVIVE_NOT_READY" ? `ยังชุบไม่ได้: ต้องล้มครบ 1 ตาก่อน (ชุบได้ตั้งแต่รอบ ${(t.downRound ?? 0) + rules.confirmed.reviveAfterDownRounds.value})` : "ชุบได้เฉพาะพวกเราที่ล้มอยู่";
}

/** The skill button's second line: MP, how often it can be used, and how long until it is ready. */
export function skillButtonLine(skill: SkillDefinition | undefined, cooldownLeft: number): string {
  const mp = `${skill?.mpCost ?? 0} MP`;
  const every = (skill?.cooldown ?? 0) > 0 ? ` · ทุก ${skill!.cooldown} ตา` : "";
  return cooldownLeft > 0 ? `${mp} · รออีก ${cooldownLeft} ตา` : `${mp}${every}`;
}

/** Thai for refusals the player can act on; anything else shows the code. */
export function refusalTh(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case "ON_COOLDOWN":
      return "สกิลนี้ยังคูลดาวน์อยู่";
    case "FLEE_FORBIDDEN":
      return "ไฟต์นี้หนีไม่ได้";
    case "REVIVE_NOT_READY":
      return "ยังชุบไม่ได้: ต้องล้มครบ 1 ตาก่อน";
    case "NOT_YOUR_TURN":
      return "ยังไม่ถึงตาเรา (ตาของเพื่อนในปาร์ตี้)";
    case "COMPANION_BOX_FULL":
      return "จับไม่ได้: คลังคู่ใจเต็ม ปล่อยหรือเทรดออกก่อน (ไม่เสียเครื่องจับ)";
    default:
      return `${code ?? ""} ${message ?? ""}`.trim();
  }
}
