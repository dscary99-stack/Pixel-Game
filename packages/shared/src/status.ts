/**
 * Status effects (chapter 03 §6, O15; catalog in docs/design/SKILL_PRIMITIVES_CATALOG.md §3).
 *
 * Nut's decisions (2026-10-04):
 * - Every status has a chance to land; it is not 100% unless a skill says so.
 * - No immunity turn after a control status.
 * - Some high stats offset the chance (each harmful status names the primary stat that resists it).
 * - Effect hit offsets effect resistance, but the chance never goes above the skill's own chance:
 *     chance = skillChance × (1 − max(0, resistance − effectHit) / 100)
 * - Side effects: poison takes the most HP; burn and bleed take less but lower stats; paralyze puts
 *   SPD at 0 and may cost the turn.
 * - "The other statuses you thought of too": the whole catalog §3 list is built here, except what still
 *   waits on another OPEN rule (capture-rate statuses O07, weather/terrain).
 * - Shield (Nut 2026-10-04): it soaks damage after every damage reduction, before HP.
 * Nut reviewed the rest of the proposed O15 list (catalog §3.8) and only struck the immunity turn, so
 * the timing below follows it (PROVISIONAL):
 * - Durations count the affected unit's own turns and go down when its turn ends. A status put on a
 *   unit during its own turn does not count that turn.
 * - Over-time effects happen when the affected unit's turn starts, before it acts.
 * - The same status again refreshes the duration (the longer one wins); stacking statuses add stacks
 *   up to their cap.
 * - Ups and downs of the same stat add up, then the total is capped (statusTuning.statModCapPct).
 * - Bosses are immune to hard control (`hardControl`); immunity is checked before the chance.
 * - Silence blocks skills that cost MP only; passives and basic attacks still work.
 * - Every status ends with the fight.
 * The behaviour of each status lives in the battle kernel; this file holds what it is and its numbers.
 */
import type { RulesConfig } from "./rules";
import type { Element, PrimaryStats } from "./schemas";
import type { DerivedStats } from "./stats";

/** UI names of the two secondary stats (Nut is picking the wording; text only). */
export const EFFECT_HIT_NAME_TH = "แม่นสถานะ";
export const EFFECT_RES_NAME_TH = "ต้านสถานะ";

export const STATUS_IDS = [
  // control
  "stun",
  "sleep",
  "freeze",
  "petrify",
  "paralyze",
  "fear",
  "silence",
  "disarm",
  "root",
  "confuse",
  "charm",
  "berserk",
  "taunt",
  "mini",
  "doom",
  // damage and drain over time
  "poison",
  "toxic",
  "burn",
  "bleed",
  "frostbite",
  "shock",
  "corrode",
  "leech",
  "mana_burn",
  // stat down and other harmful
  "blind",
  "atk_down",
  "matk_down",
  "def_down",
  "mdef_down",
  "spd_down",
  "evasion_down",
  "crit_down",
  "res_down",
  "vulnerable",
  "mark",
  "anti_heal",
  "unbuffable",
  "seal",
  "skill_lock",
  "mp_cost_up",
  "link",
  "zombie",
  "wet",
  "oil",
  // buffs
  "atk_up",
  "matk_up",
  "def_up",
  "mdef_up",
  "spd_up",
  "evasion_up",
  "accuracy_up",
  "crit_up",
  "res_up",
  "regen",
  "mp_regen",
  "dmg_reduction",
  "reflect",
  "thorns",
  "immunity",
  "endure",
  "invincible",
  "stealth",
  "counter",
  "protect",
  "shield",
  "focus",
  "imbue",
  "element_ward",
  "lifesteal_up",
  "rage",
  // instant: happen when they land and are not kept on the unit
  "knockback",
  "pull",
  "delay",
  "dispel",
  "steal_buff",
  "invert",
  "advance",
  "cleanse",
  "extend",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

/** Derived stats a status may change by a percentage of the unit's own value. */
export type ScaledStat = "patk" | "matk" | "pdef" | "mdef" | "spd";
/** Derived stats a status changes by points (they are already percentages). */
export type PointStat = "accuracyPct" | "evasionPct" | "critPct" | "effectResPct";

type Tuning = RulesConfig["provisional"]["statusTuning"]["value"];
/** Tuning keys that hold a % of max HP or MP per turn. */
export type OverTimeKey = {
  [K in keyof Tuning]: K extends `${string}Pct${"MaxHp" | "MaxMp" | "MaxHpPerStack"}` ? K : never;
}[keyof Tuning];
/** Tuning keys that hold a point change. */
export type PointKey = "blindAccuracyPct" | "evasionShiftPct" | "accuracyShiftPct" | "critShiftPct" | "resShiftPct";

/** Things a status stops the unit from doing. */
export type StatusBlock = "mp_skills" | "skills" | "attack" | "items" | "move" | "flee" | "helpful_statuses" | "passives";

export type InstantEffect = "knockback" | "pull" | "delay" | "dispel" | "steal_buff" | "invert" | "advance" | "cleanse" | "extend";

export interface StatusDefinition {
  id: StatusId;
  th: string;
  /** Harmful statuses go on enemies and are resisted; helpful ones go on allies and always use the skill's chance. */
  harmful: boolean;
  category: "control" | "dot" | "stat" | "buff" | "instant";
  /** The primary stat whose points resist it (Nut 2026-10-04: some high stats offset the chance). */
  resistStat: keyof PrimaryStats | null;
  /** Bosses are immune (hard control and instant kills). */
  hardControl?: true;
  /** The unit loses its turn: always, or on the roll in this tuning key each turn. */
  skipsTurn?: "always" | "paralyzeSkipChancePct" | "fearSkipChancePct";
  endsOnDamage?: true;
  endsOnElement?: Element;
  blocks?: StatusBlock[];
  /** At turn start: lose (harmful) or regain (helpful) this % of max HP/MP. */
  overTime?: { resource: "hp" | "mp"; key: OverTimeKey; perStack?: true };
  /** Gains a stack each time it ticks, up to the cap (toxic, corrode). */
  growsEachTick?: true;
  /** Per stack: factor × statusTuning.statModPct on these stats. */
  scaled?: Partial<Record<ScaledStat, number>>;
  /** These stats become 0 while it lasts (after every other change). */
  zeroes?: ScaledStat[];
  /** Per stack: sign × the tuning key's points. */
  points?: Partial<Record<PointStat, [1 | -1, PointKey]>>;
  /** Needs an element when applied (imbue, element ward). */
  needsElement?: true;
  /** shield: the application says how big it is (`shieldPct` of the target's max HP). */
  needsAmount?: true;
  instant?: InstantEffect;
  maxStacks: number;
}

const def = (d: Omit<StatusDefinition, "maxStacks"> & { maxStacks?: number }): StatusDefinition => ({ maxStacks: 1, ...d });
const bad = (id: StatusId, th: string, category: StatusDefinition["category"], resistStat: StatusDefinition["resistStat"], more: Partial<StatusDefinition> = {}) =>
  def({ id, th, harmful: true, category, resistStat, ...more });
const good = (id: StatusId, th: string, more: Partial<StatusDefinition> = {}) => def({ id, th, harmful: false, category: "buff", resistStat: null, ...more });

export const STATUS_DEFINITIONS: Readonly<Record<StatusId, StatusDefinition>> = {
  // ---- control
  stun: bad("stun", "มึน", "control", "VIT", { hardControl: true, skipsTurn: "always" }),
  sleep: bad("sleep", "หลับ", "control", "INT", { hardControl: true, skipsTurn: "always", endsOnDamage: true }),
  freeze: bad("freeze", "แช่แข็ง", "control", "VIT", { hardControl: true, skipsTurn: "always", endsOnElement: "FIRE" }),
  petrify: bad("petrify", "กลายเป็นหิน", "control", "VIT", { hardControl: true, skipsTurn: "always", scaled: { pdef: 1.5, mdef: 1.5 } }),
  paralyze: bad("paralyze", "ชา", "control", "AGI", { skipsTurn: "paralyzeSkipChancePct", zeroes: ["spd"] }),
  fear: bad("fear", "กลัว", "control", "SPI", { skipsTurn: "fearSkipChancePct", scaled: { patk: -0.5, matk: -0.5 } }),
  silence: bad("silence", "ใบ้", "control", "INT", { blocks: ["mp_skills"] }),
  disarm: bad("disarm", "ปลดอาวุธ", "control", "STR", { blocks: ["attack"] }),
  root: bad("root", "ตรึง", "control", "AGI", { blocks: ["move", "flee"] }),
  confuse: bad("confuse", "สับสน", "control", "INT"),
  charm: bad("charm", "เสน่ห์", "control", "SPI", { hardControl: true }),
  berserk: bad("berserk", "คลั่ง", "control", "SPI", { blocks: ["skills", "items"], scaled: { patk: 1, pdef: -1 } }),
  taunt: bad("taunt", "ยั่วยุ", "control", "SPI"),
  mini: bad("mini", "ตัวจิ๋ว", "control", "SPI", { hardControl: true, blocks: ["skills"], scaled: { patk: -2.5, matk: -2.5 } }),
  doom: bad("doom", "สาปมรณะ", "control", "SPI", { hardControl: true }),
  // ---- over time
  poison: bad("poison", "พิษ", "dot", "VIT", { overTime: { resource: "hp", key: "poisonPctMaxHp" } }),
  toxic: bad("toxic", "พิษร้าย", "dot", "VIT", { overTime: { resource: "hp", key: "toxicPctMaxHpPerStack", perStack: true }, growsEachTick: true, maxStacks: 4 }),
  burn: bad("burn", "เผาไหม้", "dot", "VIT", { overTime: { resource: "hp", key: "burnPctMaxHp" }, scaled: { patk: -0.5, matk: -0.5 } }),
  bleed: bad("bleed", "เลือดออก", "dot", "VIT", { overTime: { resource: "hp", key: "bleedPctMaxHpPerStack", perStack: true }, scaled: { pdef: -0.5 }, maxStacks: 3 }),
  frostbite: bad("frostbite", "หนาวกัด", "dot", "VIT", { overTime: { resource: "hp", key: "frostbitePctMaxHp" }, scaled: { spd: -0.5 }, maxStacks: 3 }),
  shock: bad("shock", "ไฟช็อต", "dot", "VIT"),
  corrode: bad("corrode", "กัดกร่อน", "dot", "VIT", { overTime: { resource: "hp", key: "corrodePctMaxHp" }, growsEachTick: true, scaled: { pdef: -0.5 }, maxStacks: 5 }),
  leech: bad("leech", "ดูดพลัง", "dot", "VIT", { overTime: { resource: "hp", key: "leechPctMaxHp" } }),
  mana_burn: bad("mana_burn", "เผามานา", "dot", "SPI", { overTime: { resource: "mp", key: "manaBurnPctMaxMp" } }),
  // ---- stat down and other harmful
  blind: bad("blind", "ตาบอด", "stat", "DEX", { points: { accuracyPct: [-1, "blindAccuracyPct"] } }),
  atk_down: bad("atk_down", "ATK ลด", "stat", null, { scaled: { patk: -1 } }),
  matk_down: bad("matk_down", "MATK ลด", "stat", null, { scaled: { matk: -1 } }),
  def_down: bad("def_down", "DEF ลด", "stat", null, { scaled: { pdef: -1 } }),
  mdef_down: bad("mdef_down", "MDEF ลด", "stat", null, { scaled: { mdef: -1 } }),
  spd_down: bad("spd_down", "ช้า", "stat", "AGI", { scaled: { spd: -1 } }),
  evasion_down: bad("evasion_down", "หลบลด", "stat", null, { points: { evasionPct: [-1, "evasionShiftPct"] } }),
  crit_down: bad("crit_down", "คริลด", "stat", null, { points: { critPct: [-1, "critShiftPct"] } }),
  res_down: bad("res_down", `${EFFECT_RES_NAME_TH}ลด`, "stat", "SPI", { points: { effectResPct: [-1, "resShiftPct"] } }),
  vulnerable: bad("vulnerable", "เปราะบาง", "stat", null),
  mark: bad("mark", "ถูกหมายหัว", "stat", null),
  anti_heal: bad("anti_heal", "ฮีลไม่เข้า", "stat", "SPI"),
  unbuffable: bad("unbuffable", "ห้ามบัฟ", "stat", "SPI", { blocks: ["helpful_statuses"] }),
  seal: bad("seal", "ผนึก", "stat", "SPI", { blocks: ["passives"] }),
  skill_lock: bad("skill_lock", "สกิลล็อก", "stat", "INT"),
  mp_cost_up: bad("mp_cost_up", "MP แพง", "stat", "INT"),
  link: bad("link", "ลิงก์", "stat", "SPI"),
  zombie: bad("zombie", "ซอมบี้", "stat", "SPI"),
  wet: bad("wet", "เปียก", "stat", null),
  oil: bad("oil", "น้ำมัน", "stat", null),
  // ---- buffs
  atk_up: good("atk_up", "ATK เพิ่ม", { scaled: { patk: 1 } }),
  matk_up: good("matk_up", "MATK เพิ่ม", { scaled: { matk: 1 } }),
  def_up: good("def_up", "DEF เพิ่ม", { scaled: { pdef: 1 } }),
  mdef_up: good("mdef_up", "MDEF เพิ่ม", { scaled: { mdef: 1 } }),
  spd_up: good("spd_up", "เร่ง", { scaled: { spd: 1 } }),
  evasion_up: good("evasion_up", "หลบเพิ่ม", { points: { evasionPct: [1, "evasionShiftPct"] } }),
  accuracy_up: good("accuracy_up", "แม่นเพิ่ม", { points: { accuracyPct: [1, "accuracyShiftPct"] } }),
  crit_up: good("crit_up", "คริเพิ่ม", { points: { critPct: [1, "critShiftPct"] } }),
  res_up: good("res_up", `${EFFECT_RES_NAME_TH}เพิ่ม`, { points: { effectResPct: [1, "resShiftPct"] } }),
  regen: good("regen", "ฟื้นต่อเนื่อง", { overTime: { resource: "hp", key: "regenPctMaxHp" } }),
  mp_regen: good("mp_regen", "ฟื้น MP ต่อเนื่อง", { overTime: { resource: "mp", key: "mpRegenPctMaxMp" } }),
  dmg_reduction: good("dmg_reduction", "ลดดาเมจ"),
  reflect: good("reflect", "สะท้อนเวท"),
  thorns: good("thorns", "หนาม"),
  immunity: good("immunity", "ภูมิคุ้มกัน"),
  endure: good("endure", "อึด"),
  invincible: good("invincible", "คงกระพัน"),
  stealth: good("stealth", "ล่องหน"),
  counter: good("counter", "ท่าสวน"),
  protect: good("protect", "ถูกปกป้อง"),
  shield: good("shield", "โล่", { needsAmount: true }),
  focus: good("focus", "ชาร์จพลัง"),
  imbue: good("imbue", "อาวุธธาตุ", { needsElement: true }),
  element_ward: good("element_ward", "ต้านธาตุ", { needsElement: true }),
  lifesteal_up: good("lifesteal_up", "ดูดเลือดเพิ่ม"),
  rage: good("rage", "เดือดดาล", { scaled: { patk: 0.5 }, maxStacks: 5 }),
  // ---- instant
  knockback: bad("knockback", "ผลักไปหลัง", "instant", "STR", { instant: "knockback" }),
  pull: bad("pull", "ดึงมาหน้า", "instant", "STR", { instant: "pull" }),
  delay: bad("delay", "ถ่วงคิว", "instant", "AGI", { instant: "delay" }),
  dispel: bad("dispel", "สลายบัฟ", "instant", "SPI", { instant: "dispel" }),
  steal_buff: bad("steal_buff", "ขโมยบัฟ", "instant", "SPI", { instant: "steal_buff" }),
  invert: bad("invert", "กลับขั้น", "instant", "SPI", { instant: "invert" }),
  advance: good("advance", "ดันคิว", { category: "instant", instant: "advance" }),
  cleanse: good("cleanse", "ล้างสถานะ", { category: "instant", instant: "cleanse" }),
  extend: good("extend", "ยืดบัฟ", { category: "instant", instant: "extend" }),
};

/** Buff ↔ debuff pairs used by `invert`. */
export const INVERT_PAIRS: Readonly<Partial<Record<StatusId, StatusId>>> = {
  atk_up: "atk_down",
  matk_up: "matk_down",
  def_up: "def_down",
  mdef_up: "mdef_down",
  spd_up: "spd_down",
  evasion_up: "evasion_down",
  accuracy_up: "blind",
  crit_up: "crit_down",
  res_up: "res_down",
  regen: "poison",
};

export function isStatusId(id: string): id is StatusId {
  return (STATUS_IDS as readonly string[]).includes(id);
}

export function statusBlocks(statuses: readonly ActiveStatus[] | undefined, what: StatusBlock): ActiveStatus | undefined {
  return statuses?.find((s) => STATUS_DEFINITIONS[s.statusId].blocks?.includes(what) === true);
}

/** One status on a unit in a fight. */
export interface ActiveStatus {
  statusId: StatusId;
  /** Who put it there (null for none). Taunt, protect and leech point at this unit. */
  sourceId: string | null;
  turnsLeft: number;
  stacks: number;
  /** Put on during the unit's own turn: that turn does not count down. */
  fresh: boolean;
  /** imbue / element_ward. */
  element?: Element;
  /** skill_lock: the skill that is locked. */
  skillId?: string;
  /** shield: damage it can still soak. */
  shieldHp?: number;
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
  const pts: Record<PointStat, number> = { accuracyPct: 0, evasionPct: 0, critPct: 0, effectResPct: 0 };
  for (const s of statuses) {
    const d = STATUS_DEFINITIONS[s.statusId];
    for (const [k, factor] of Object.entries(d.scaled ?? {}) as [ScaledStat, number][]) pct[k] += factor * t.statModPct * s.stacks;
    for (const [k, [sign, key]] of Object.entries(d.points ?? {}) as [PointStat, [number, PointKey]][]) pts[k] += sign * t[key] * s.stacks;
  }
  const cap = t.statModCapPct;
  const out = { ...base };
  for (const k of Object.keys(pct) as ScaledStat[]) {
    const p = Math.max(-cap, Math.min(cap, pct[k]));
    out[k] = Math.max(0, Math.floor((base[k] * (100 + p)) / 100));
  }
  for (const k of Object.keys(pts) as PointStat[]) out[k] = Math.max(0, base[k] + pts[k]);
  for (const s of statuses) for (const k of STATUS_DEFINITIONS[s.statusId].zeroes ?? []) out[k] = 0;
  return out;
}

/**
 * HP or MP change at turn start for one over-time status: positive = loss, negative = gain. A boss never
 * loses more than `bossDotMaxHpPctPerTick` of its max HP to one tick.
 */
export function overTimeAmount(rules: RulesConfig, def: StatusDefinition, stacks: number, max: number, isBoss: boolean): number {
  if (def.overTime === undefined) return 0;
  const t = rules.provisional.statusTuning.value;
  const pct = t[def.overTime.key] * (def.overTime.perStack === true ? stacks : 1);
  const capped = isBoss && def.harmful && def.overTime.resource === "hp" ? Math.min(pct, t.bossDotMaxHpPctPerTick) : pct;
  const amount = Math.max(1, Math.floor((max * capped) / 100));
  return def.harmful ? amount : -amount;
}

/** The incoming damage factor from the target's statuses (vulnerable, mark, damage reduction, element ward). */
export function incomingDamageFactor(rules: RulesConfig, statuses: readonly ActiveStatus[] | undefined, element: Element): number {
  const t = rules.provisional.statusTuning.value;
  let pct = 0;
  for (const s of statuses ?? []) {
    if (s.statusId === "vulnerable") pct += t.vulnerablePct;
    else if (s.statusId === "mark") pct += t.markPct;
    else if (s.statusId === "dmg_reduction") pct -= t.dmgReductionPct;
    else if (s.statusId === "element_ward" && s.element === element) pct -= t.elementWardPct;
  }
  return Math.max(0, (100 + pct) / 100);
}
