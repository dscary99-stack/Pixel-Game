/**
 * Status effects (chapter 03 §6, O15; catalog in docs/design/SKILL_PRIMITIVES_CATALOG.md §3).
 *
 * Nut's decisions (2026-10-04):
 * - Every status has a chance to land; it is not 100% unless a skill says so.
 * - No immunity turn after a control status.
 * - Some high stats offset the chance (each harmful status names the primary stat that resists it).
 * - Effect hit offsets effect resistance, but the chance never goes above the skill's own chance:
 *     chance = skillChance × (1 − max(0, resistance − effectHit) / 100)
 * Nut reviewed the rest of the proposed O15 list (catalog §3.8) and only struck the immunity turn, so
 * the timing below follows it (PROVISIONAL):
 * - Durations count the affected unit's own turns and go down when its turn ends. A status put on a
 *   unit during its own turn does not count that turn.
 * - Damage and healing over time happen when the affected unit's turn starts, before it acts.
 * - The same status again refreshes the duration (the longer one wins); stacking statuses add stacks
 *   up to their cap.
 * - Ups and downs of the same stat add up, then the total is capped (statusTuning.statModCapPct).
 * - Bosses are immune to hard control; immunity is checked before the chance.
 * - Silence blocks skills that cost MP only; passives and basic attacks still work.
 * - Every status ends with the fight.
 */
import type { RulesConfig } from "./rules";
import type { PrimaryStats } from "./schemas";
import type { DerivedStats } from "./stats";

/** UI names of the two secondary stats (Nut is picking the wording; text only). */
export const EFFECT_HIT_NAME_TH = "แม่นสถานะ";
export const EFFECT_RES_NAME_TH = "ต้านสถานะ";

export const STATUS_IDS = [
  // control
  "stun",
  "sleep",
  "freeze",
  "paralyze",
  "silence",
  // damage over time
  "poison",
  "burn",
  "bleed",
  // stat down
  "blind",
  "atk_down",
  "matk_down",
  "def_down",
  "mdef_down",
  "spd_down",
  "evasion_down",
  "res_down",
  // buffs
  "atk_up",
  "matk_up",
  "def_up",
  "mdef_up",
  "spd_up",
  "evasion_up",
  "res_up",
  "regen",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

/** Derived stats a status may change by a percentage of the unit's own value. */
export type ScaledStat = "patk" | "matk" | "pdef" | "mdef" | "spd";
/** Derived stats a status changes by points (they are already percentages). */
export type PointStat = "accuracyPct" | "evasionPct" | "effectResPct";

export interface StatusDefinition {
  id: StatusId;
  th: string;
  /** Harmful statuses go on enemies and are resisted; helpful ones go on allies and always use the skill's chance. */
  harmful: boolean;
  category: "control" | "dot" | "stat" | "buff";
  /** The primary stat whose points resist it (Nut 2026-10-04: some high stats offset the chance). */
  resistStat: keyof PrimaryStats | null;
  /** Bosses are immune (proposal accepted 2026-10-04). */
  hardControl?: true;
  /** The unit loses its turn: always, or on a roll each turn. */
  skipsTurn?: "always" | "chance";
  /** Taking damage ends it. */
  endsOnDamage?: true;
  /** Damage of this element ends it. */
  endsOnElement?: "FIRE";
  /** Blocks skills that cost MP. */
  blocksMpSkills?: true;
  /** Per stack: tuning key for the % of max HP lost (+) or regained (−) at turn start. */
  overTime?: "poison" | "burn" | "bleed" | "regen";
  /** Per stack: sign × statusTuning.statModPct on these stats. */
  scaled?: Partial<Record<ScaledStat, 1 | -1 | 0.5 | -0.5>>;
  /** Per stack: tuning key for the points added (+) or removed (−). */
  points?: Partial<Record<PointStat, "blind" | "evasionUp" | "resShift">>;
  pointSign?: 1 | -1;
  maxStacks: number;
}

const def = (d: Omit<StatusDefinition, "maxStacks"> & { maxStacks?: number }): StatusDefinition => ({ maxStacks: 1, ...d });

export const STATUS_DEFINITIONS: Readonly<Record<StatusId, StatusDefinition>> = {
  stun: def({ id: "stun", th: "มึน", harmful: true, category: "control", resistStat: "VIT", hardControl: true, skipsTurn: "always" }),
  sleep: def({ id: "sleep", th: "หลับ", harmful: true, category: "control", resistStat: "INT", hardControl: true, skipsTurn: "always", endsOnDamage: true }),
  freeze: def({ id: "freeze", th: "แช่แข็ง", harmful: true, category: "control", resistStat: "VIT", hardControl: true, skipsTurn: "always", endsOnElement: "FIRE" }),
  paralyze: def({ id: "paralyze", th: "ชา", harmful: true, category: "control", resistStat: "AGI", skipsTurn: "chance", scaled: { spd: -0.5 } }),
  silence: def({ id: "silence", th: "ใบ้", harmful: true, category: "control", resistStat: "INT", blocksMpSkills: true }),
  poison: def({ id: "poison", th: "พิษ", harmful: true, category: "dot", resistStat: "VIT", overTime: "poison" }),
  burn: def({ id: "burn", th: "เผาไหม้", harmful: true, category: "dot", resistStat: "VIT", overTime: "burn", scaled: { patk: -0.5 } }),
  bleed: def({ id: "bleed", th: "เลือดออก", harmful: true, category: "dot", resistStat: "VIT", overTime: "bleed", maxStacks: 5 }),
  blind: def({ id: "blind", th: "ตาบอด", harmful: true, category: "stat", resistStat: "DEX", points: { accuracyPct: "blind" }, pointSign: -1 }),
  atk_down: def({ id: "atk_down", th: "ATK ลด", harmful: true, category: "stat", resistStat: null, scaled: { patk: -1 } }),
  matk_down: def({ id: "matk_down", th: "MATK ลด", harmful: true, category: "stat", resistStat: null, scaled: { matk: -1 } }),
  def_down: def({ id: "def_down", th: "DEF ลด", harmful: true, category: "stat", resistStat: null, scaled: { pdef: -1 } }),
  mdef_down: def({ id: "mdef_down", th: "MDEF ลด", harmful: true, category: "stat", resistStat: null, scaled: { mdef: -1 } }),
  spd_down: def({ id: "spd_down", th: "ช้า", harmful: true, category: "stat", resistStat: "AGI", scaled: { spd: -1 } }),
  evasion_down: def({ id: "evasion_down", th: "หลบลด", harmful: true, category: "stat", resistStat: null, points: { evasionPct: "evasionUp" }, pointSign: -1 }),
  res_down: def({ id: "res_down", th: `${EFFECT_RES_NAME_TH}ลด`, harmful: true, category: "stat", resistStat: "SPI", points: { effectResPct: "resShift" }, pointSign: -1 }),
  atk_up: def({ id: "atk_up", th: "ATK เพิ่ม", harmful: false, category: "buff", resistStat: null, scaled: { patk: 1 } }),
  matk_up: def({ id: "matk_up", th: "MATK เพิ่ม", harmful: false, category: "buff", resistStat: null, scaled: { matk: 1 } }),
  def_up: def({ id: "def_up", th: "DEF เพิ่ม", harmful: false, category: "buff", resistStat: null, scaled: { pdef: 1 } }),
  mdef_up: def({ id: "mdef_up", th: "MDEF เพิ่ม", harmful: false, category: "buff", resistStat: null, scaled: { mdef: 1 } }),
  spd_up: def({ id: "spd_up", th: "เร่ง", harmful: false, category: "buff", resistStat: null, scaled: { spd: 1 } }),
  evasion_up: def({ id: "evasion_up", th: "หลบเพิ่ม", harmful: false, category: "buff", resistStat: null, points: { evasionPct: "evasionUp" }, pointSign: 1 }),
  res_up: def({ id: "res_up", th: `${EFFECT_RES_NAME_TH}เพิ่ม`, harmful: false, category: "buff", resistStat: null, points: { effectResPct: "resShift" }, pointSign: 1 }),
  regen: def({ id: "regen", th: "ฟื้นต่อเนื่อง", harmful: false, category: "buff", resistStat: null, overTime: "regen" }),
};

export function isStatusId(id: string): id is StatusId {
  return (STATUS_IDS as readonly string[]).includes(id);
}

/** One status on a unit in a fight. */
export interface ActiveStatus {
  statusId: StatusId;
  /** Who put it there (null for none). */
  sourceId: string | null;
  turnsLeft: number;
  stacks: number;
  /** Put on during the unit's own turn: that turn does not count down. */
  fresh: boolean;
}

/**
 * The chance (0–100) that a harmful status lands. Effect hit only offsets resistance, so the result is
 * never above the skill's chance (Nut 2026-10-04).
 */
export function statusChancePct(skillChancePct: number, effectHitPct: number, resistancePct: number): number {
  const net = Math.max(0, resistancePct - effectHitPct);
  return Math.max(0, Math.min(skillChancePct, skillChancePct * (1 - net / 100)));
}

/** Resistance against one harmful status: the unit's effect resistance plus its stat that resists it. */
export function statusResistancePct(
  rules: RulesConfig,
  def: StatusDefinition,
  stats: Pick<DerivedStats, "effectResPct">,
  primary: PrimaryStats | undefined,
): number {
  const fromStat = def.resistStat === null || primary === undefined ? 0 : primary[def.resistStat] * rules.provisional.statusTuning.value.resistPerStatPointPct;
  return stats.effectResPct + fromStat;
}

/** Stats with every status applied (stat ups and downs add up, then the cap). */
export function statsWithStatuses(rules: RulesConfig, base: DerivedStats, statuses: readonly ActiveStatus[] | undefined): DerivedStats {
  if (statuses === undefined || statuses.length === 0) return base;
  const t = rules.provisional.statusTuning.value;
  const pct: Record<ScaledStat, number> = { patk: 0, matk: 0, pdef: 0, mdef: 0, spd: 0 };
  const pts: Record<PointStat, number> = { accuracyPct: 0, evasionPct: 0, effectResPct: 0 };
  for (const s of statuses) {
    const d = STATUS_DEFINITIONS[s.statusId];
    for (const [k, sign] of Object.entries(d.scaled ?? {}) as [ScaledStat, number][]) pct[k] += sign * t.statModPct * s.stacks;
    for (const [k, key] of Object.entries(d.points ?? {}) as [PointStat, "blind" | "evasionUp" | "resShift"][]) {
      const size = key === "blind" ? t.blindAccuracyPct : key === "evasionUp" ? t.evasionUpPct : t.resShiftPct;
      pts[k] += (d.pointSign ?? 1) * size * s.stacks;
    }
  }
  const cap = t.statModCapPct;
  const out = { ...base };
  for (const k of Object.keys(pct) as ScaledStat[]) {
    const p = Math.max(-cap, Math.min(cap, pct[k]));
    out[k] = Math.max(0, Math.floor((base[k] * (100 + p)) / 100));
  }
  for (const k of Object.keys(pts) as PointStat[]) out[k] = Math.max(0, base[k] + pts[k]);
  return out;
}

/** HP change at turn start for one over-time status: positive = damage, negative = healing. */
export function overTimeAmount(rules: RulesConfig, def: StatusDefinition, stacks: number, maxHp: number, isBoss: boolean): number {
  if (def.overTime === undefined) return 0;
  const t = rules.provisional.statusTuning.value;
  const pct =
    def.overTime === "poison" ? t.poisonPctMaxHp : def.overTime === "burn" ? t.burnPctMaxHp : def.overTime === "bleed" ? t.bleedPctMaxHpPerStack * stacks : t.regenPctMaxHp;
  const capped = isBoss && def.harmful ? Math.min(pct, t.bossDotMaxHpPctPerTick) : pct;
  const amount = Math.max(1, Math.floor((maxHp * capped) / 100));
  return def.harmful ? amount : -amount;
}
