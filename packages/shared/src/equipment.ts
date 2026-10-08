/**
 * Character equipment (chapter 05 §1, C21, C23). Twelve slots; a weapon fits either hand, an
 * off-hand item only the off hand, a two-hand weapon leaves the off hand empty. Any class may hold two
 * one-hand weapons; O09 (Nut 2026-10-07) counts both in full and makes up for it with lower one-hand
 * weapon stats (P20, checked by validateEquipmentDefinitions).
 *
 * Gear changes happen outside fights (P15). Gear adds its base stats plus its rolled affixes
 * (`GearBonuses`, affix.ts); a refined piece adds more of its refinable base stats (refine.ts).
 */
import { z } from "zod";
import { EquipSlotSchema, type EquipSlot, type EquipmentDefinition, type EquipmentInstance, type Rarity, type RolledAffix, type SigilDefinition } from "./schemas";
import { PRODUCTION_RULES, type RulesConfig } from "./rules";
import type { GearBonuses } from "./stats";
import type { Range } from "./battle/types";
import { SLOT_FOR_CATEGORY, validateLoadout, type ValidationIssue } from "./validators";

export const GEAR_STAT_KEYS = [
  "STR",
  "VIT",
  "INT",
  "DEX",
  "AGI",
  "SPI",
  "HP",
  "MP",
  "PATK",
  "MATK",
  "SUPPORT",
  "PDEF",
  "MDEF",
  "SPD",
  "ACCURACY_PCT",
  "EVASION_PCT",
  "CRIT_PCT",
  "CRIT_DAMAGE",
  "EFFECT_HIT_PCT",
  "EFFECT_RES_PCT",
] as const satisfies readonly (keyof GearBonuses)[];

export const EQUIP_SLOTS = EquipSlotSchema.options;

export const EquipRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    slot: EquipSlotSchema,
    /** The instance to put in the slot, or null to take off what is there. */
    instanceId: z.string().min(1).max(120).nullable(),
  })
  .strict();
export type EquipRequest = z.infer<typeof EquipRequestSchema>;

/** Which instance sits in which slot. */
export type Loadout = Partial<Record<EquipSlot, string>>;

/**
 * Content check: equipment only grants stats the formulas know about, and a one-hand weapon's PATK/MATK
 * stays within P20's % of any two-hand weapon at the same required level (O09).
 */
export function validateEquipmentDefinitions(defs: readonly EquipmentDefinition[], rules: RulesConfig = PRODUCTION_RULES): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const d of defs) {
    for (const [k, v] of Object.entries(d.baseStats)) {
      if (!(GEAR_STAT_KEYS as readonly string[]).includes(k)) out.push({ code: "INVALID_COMMAND", message: `${d.id} has unknown stat ${k}`, path: d.id });
      if (!Number.isInteger(v)) out.push({ code: "INVALID_COMMAND", message: `${d.id} ${k} is not a whole number`, path: d.id });
    }
  }
  const pct = rules.provisional.oneHandWeaponAttackPct.value;
  const weapons = defs.filter((d) => d.category === "WEAPON");
  for (const one of weapons.filter((d) => d.handedness === "one_hand")) {
    for (const two of weapons.filter((d) => d.handedness === "two_hand" && d.requiredLevel === one.requiredLevel)) {
      for (const k of ["PATK", "MATK"] as const) {
        const a = one.baseStats[k] ?? 0;
        const b = two.baseStats[k] ?? 0;
        if (a > 0 && b > 0 && a * 100 > b * pct) out.push({ code: "INVALID_COMMAND", message: `${one.id} ${k} ${a} is above ${pct}% of two-hand ${two.id} (${b}) at Lv${one.requiredLevel}`, path: one.id });
      }
    }
  }
  return out;
}

export type EquipPlan =
  | { ok: true; loadout: Loadout; removed: string[] }
  | { ok: false; code: "SLOT_MISMATCH" | "LEVEL_TOO_LOW" | "MISSING_REFERENCE" | "TWO_HAND_BLOCKS_OFFHAND"; message: string };

/**
 * The loadout after putting `instanceId` in `slot` (or emptying it). Moving an equipped piece to
 * another slot frees its old slot; a two-hand weapon takes off whatever is in the off hand.
 */
export function planEquip(
  rules: RulesConfig,
  current: Loadout,
  slot: EquipSlot,
  instanceId: string | null,
  instances: ReadonlyMap<string, Pick<EquipmentInstance, "id" | "definitionId" | "sigilSockets">>,
  defs: ReadonlyMap<string, EquipmentDefinition>,
  sigils: ReadonlyMap<string, SigilDefinition>,
  characterLevel: number,
): EquipPlan {
  const next: Loadout = { ...current };
  const removed: string[] = [];
  const take = (s: EquipSlot) => {
    const id = next[s];
    if (id !== undefined) removed.push(id);
    delete next[s];
  };
  if (instanceId === null) {
    take(slot);
    return { ok: true, loadout: next, removed };
  }
  const inst = instances.get(instanceId);
  const def = inst === undefined ? undefined : defs.get(inst.definitionId);
  if (inst === undefined || def === undefined) return { ok: false, code: "MISSING_REFERENCE", message: "unknown equipment" };
  if (!SLOT_FOR_CATEGORY[def.category].includes(slot)) return { ok: false, code: "SLOT_MISMATCH", message: `${def.category} cannot go in ${slot}` };
  if (def.handedness === "two_hand" && slot !== "MAIN_HAND") return { ok: false, code: "SLOT_MISMATCH", message: "a two-hand weapon goes in MAIN_HAND" };
  if (characterLevel < def.requiredLevel) return { ok: false, code: "LEVEL_TOO_LOW", message: `needs Lv${def.requiredLevel}` };
  const mainDef = next.MAIN_HAND === undefined ? undefined : defs.get(instances.get(next.MAIN_HAND)?.definitionId ?? "");
  if (slot === "OFF_HAND" && mainDef?.handedness === "two_hand" && next.MAIN_HAND !== instanceId) {
    return { ok: false, code: "TWO_HAND_BLOCKS_OFFHAND", message: "take off the two-hand weapon first" };
  }
  // Already worn elsewhere: move it.
  for (const s of EQUIP_SLOTS) if (next[s] === instanceId && s !== slot) delete next[s];
  if (next[slot] !== instanceId) take(slot);
  next[slot] = instanceId;
  if (def.handedness === "two_hand") take("OFF_HAND");
  const full = Object.fromEntries(
    Object.entries(next).map(([s, id]) => {
      const i = instances.get(id)!;
      return [s, { ...i, ownerId: "", refineLevel: 0, rarity: "COMMON", rolledAffixes: [], lockState: "free" } as EquipmentInstance];
    }),
  ) as Partial<Record<EquipSlot, EquipmentInstance>>;
  const issues = validateLoadout(rules, full, defs, sigils);
  if (issues.length > 0) return { ok: false, code: "SLOT_MISMATCH", message: issues.map((i) => i.message).join("; ") };
  return { ok: true, loadout: next, removed };
}

/**
 * Summed gear stats: base stats plus every worn affix. A two-hand weapon already keeps the off hand
 * empty, so nothing is skipped.
 */
export function gearBonuses(defs: readonly EquipmentDefinition[], affixes: readonly RolledAffix[] = []): GearBonuses {
  const out: Record<string, number> = {};
  for (const d of defs) for (const [k, v] of Object.entries(d.baseStats)) out[k] = (out[k] ?? 0) + v;
  for (const a of affixes) out[a.stat] = (out[a.stat] ?? 0) + a.value;
  return out as GearBonuses;
}

/** Basic attack reach: the main-hand weapon decides; bare-handed uses the class default. */
export function weaponRange(main: EquipmentDefinition | undefined, classDefault: Range): Range {
  if (main?.weaponKind === undefined) return classDefault;
  return main.weaponKind === "physical_melee" ? "melee" : "ranged";
}

/** One owned piece as the client sees it: where it is worn (or null) and whether a fight holds it. */
export interface EquipmentView {
  id: string;
  definitionId: string;
  refineLevel: number;
  lockState: EquipmentInstance["lockState"];
  slot: EquipSlot | null;
  /** Installed Sigil ids, in socket order. */
  sigils: string[];
  rarity: Rarity;
  affixes: RolledAffix[];
  /** A rerolled affix waiting for keep old / keep new (chapter 05 §3), if any. */
  pendingAffix?: { operationId: string; slot: number; affix: RolledAffix };
  /** Owner-set guard: no sell or salvage touches it. */
  protected?: boolean;
  /** ห้ามขาย / ห้ามเทรด (market.ts): from the definition or on this piece. */
  noSell?: boolean;
  noTrade?: boolean;
  /** ห้ามฝากคลัง (vault.ts). */
  noStore?: boolean;
  /** Bumped by every refine attempt; a refine request names the version it saw. */
  version?: number;
}

/** Base stats after refining: +pct% of each refinable stat per level, rounded half up, not compounded. */
export function refinedBaseStats(def: EquipmentDefinition, level: number, rules: RulesConfig = PRODUCTION_RULES): Record<string, number> {
  if (level <= 0) return def.baseStats;
  const pct = rules.provisional.refineStatPctPerLevel.value;
  const refinable = new Set(def.refinableStats ?? []);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(def.baseStats)) out[k] = refinable.has(k) && v > 0 ? v + Math.floor((v * pct * level + 50) / 100) : v;
  return out;
}

/** The definition as a refined piece fights with it. */
export function refinedDefinition(def: EquipmentDefinition, level: number, rules: RulesConfig = PRODUCTION_RULES): EquipmentDefinition {
  return level <= 0 ? def : { ...def, baseStats: refinedBaseStats(def, level, rules) };
}

/** The worn pieces' definitions and the main-hand weapon, for `playerSetup` and the HUD. */
export function wornGear(
  owned: readonly EquipmentView[],
  defs: ReadonlyMap<string, EquipmentDefinition>,
): { defs: EquipmentDefinition[]; mainHand?: EquipmentDefinition; sigilIds: string[]; affixes: RolledAffix[] } {
  const worn = owned.filter((e) => e.slot !== null);
  const main = worn.find((e) => e.slot === "MAIN_HAND");
  const mainDef = main === undefined ? undefined : defs.get(main.definitionId);
  const mainHand = mainDef === undefined ? undefined : refinedDefinition(mainDef, main!.refineLevel);
  return {
    // Refined pieces fight with their refined base stats.
    defs: worn.flatMap((e) => {
      const d = defs.get(e.definitionId);
      return d === undefined ? [] : [refinedDefinition(d, e.refineLevel)];
    }),
    // Every Sigil in the worn pieces, one entry per copy: their effects go into fights.
    sigilIds: worn.flatMap((e) => e.sigils),
    affixes: worn.flatMap((e) => e.affixes),
    ...(mainHand === undefined ? {} : { mainHand }),
  };
}

/** Stats from everything worn: base stats plus affixes. */
export function wornBonuses(owned: readonly EquipmentView[], defs: ReadonlyMap<string, EquipmentDefinition>): GearBonuses {
  const w = wornGear(owned, defs);
  return gearBonuses(w.defs, w.affixes);
}
