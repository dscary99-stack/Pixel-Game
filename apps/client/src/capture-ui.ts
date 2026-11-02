/**
 * Capture preview text (O07 capture-v1). The numbers come from the shared `captureCheck`, the same
 * function the server runs, on the fight's pinned profile; the server checks and rolls again when the
 * command arrives, so this is only what the player is shown before confirming.
 */
import { STATUS_DEFINITIONS, captureCheck, fightCaptureProfile, type CaptureBreakdown, type CaptureRefused, type ItemDefinition, type PublicBattleState, type RulesConfig, type SpeciesDefinition } from "@pmrpg/shared";

const RANK_TH = { NORMAL: "ปกติ", ELITE: "ชั้นยอด", BOSS: "บอส" } as const;

/** Percent with two decimals, as the design asks (no rounding up to a nicer number). */
export const pct2 = (p: number) => `${(p * 100).toFixed(2)}%`;
const times = (f: number) => `×${Number(f.toFixed(4))}`;

export interface CapturePreview {
  ok: boolean;
  /** Lines to show; the first is the headline. */
  lines: string[];
}

export function refusalText(r: CaptureRefused): string {
  switch (r.code) {
    case "LEVEL_INELIGIBLE":
      return `จับไม่ได้: ต้องมีเลเวลอย่างน้อย ${r.minPlayerLevel} (เลเวลป่าต้องไม่เกินเลเวลเรา +5)`;
    case "NO_VALID_CAPTURE_WINDOW":
      return "จับไม่ได้: รอช่วงจับของบอส (ทำให้บอสอ่อนแรงในช่วงที่กำหนดก่อน)";
    case "INSUFFICIENT_RESOURCE":
      return "จับไม่ได้: ไม่มีเครื่องจับชนิดนี้ในกระเป๋าต่อสู้";
    case "STATUS_BLOCKED":
      return "จับไม่ได้: สถานะปัจจุบันห้ามใช้ของ";
    case "AUTO_CAPTURE_FORBIDDEN":
      return "จับไม่ได้: Auto จับให้ไม่ได้ ต้องสั่งเอง";
    case "QUALITY_NOT_ENABLED":
      return "จับไม่ได้: เครื่องจับระดับนี้ยังไม่เปิดใช้";
    case "INVALID_TARGET":
      return "จับไม่ได้: ต้องเลือกศัตรูที่ยังไม่ล้ม";
    case "INVALID_COMMAND":
      return "จับไม่ได้: ไม่มีเครื่องจับที่ใช้กับเป้านี้ได้";
  }
}

export function breakdownLines(b: CaptureBreakdown, speciesName: string): string[] {
  const parts = [`ฐาน ${pct2(b.base)}`, `${RANK_TH[b.rank]} ${times(b.rankFactor)}`, `HP ${times(b.hpFactor)}`];
  parts.push(b.statusId === null ? "สถานะ ×1" : `${STATUS_DEFINITIONS[b.statusId].th} ${times(b.statusFactor)}`);
  parts.push(`เครื่องจับ ${times(b.qualityFactor)}`, `ความชำนาญ ${times(b.masteryFactor)}`);
  const cap =
    b.capped === "max" ? ` (ถึงเพดาน ${pct2(b.bounds[1])} ของระดับ${RANK_TH[b.rank]})` : b.capped === "min" ? ` (ขั้นต่ำ ${pct2(b.bounds[0])} ของระดับ${RANK_TH[b.rank]})` : "";
  return [
    `โอกาสจับ ${speciesName}: ${pct2(b.probability)}${cap}`,
    parts.join(" · "),
    "ใช้เครื่องจับ 1 ชิ้นและ 1 action แม้พลาด · สำเร็จได้ Lv1 และ EXP แต่ไม่มีของดรอปจากเป้านี้",
    "สถานะนับเฉพาะตัวที่ดีที่สุดตัวเดียว ไม่มีโอกาสสะสมจากการพลาด",
  ];
}

/** What the capture button shows for this target right now. */
export function capturePreview(
  rules: RulesConfig,
  state: PublicBattleState,
  content: { species: ReadonlyMap<string, SpeciesDefinition>; items: ReadonlyMap<string, ItemDefinition> },
  actorId: string,
  targetId: string,
): CapturePreview & { itemId: string | null } {
  const actor = state.units.find((u) => u.unitId === actorId);
  const target = state.units.find((u) => u.unitId === targetId);
  if (actor === undefined || actor.kind !== "player") return { ok: false, itemId: null, lines: ["จับได้เฉพาะในตาของตัวละครเรา"] };
  if (target === undefined || target.speciesId === null) return { ok: false, itemId: null, lines: ["จับไม่ได้: ต้องเลือกศัตรูที่ยังไม่ล้ม"] };
  const species = content.species.get(target.speciesId);
  const itemId = species?.captureItemId ?? null;
  const check = captureCheck(rules, fightCaptureProfile(rules, state.captureProfile), {
    source: "player",
    actor,
    target,
    species,
    item: itemId === null ? undefined : content.items.get(itemId),
    inBag: itemId === null ? 0 : (state.bag[itemId] ?? 0),
  });
  if (!check.ok) return { ok: false, itemId, lines: [refusalText(check)] };
  return { ok: true, itemId, lines: breakdownLines(check, species?.name.th ?? target.speciesId) };
}
