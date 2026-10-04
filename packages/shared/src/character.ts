/**
 * Player characters (chapter 02, chapter 03 §3–§4, chapter 12 §2). Phase D, first slice.
 *
 * A character is created once with a name, a Class1, a race and a starting element. Primary
 * stats start at 10 each (P03). HP/MP carry over between fights and come back by resting in town
 * (chapter 03 §3). The team is up to 5 companions with no duplicate species (C04).
 *
 * The class and race lists are the P16 draft (chapter 02): ids and names only. Class and race
 * mechanics (skills, passives) are not built yet, so every class shares one placeholder skill.
 */
import { z } from "zod";
import type { RulesConfig } from "./rules";
import { ElementSchema, type Element, type MonsterInstance, type PrimaryStats, type SpeciesDefinition } from "./schemas";
import type { BattleSetup, Range } from "./battle/types";
import { gearBonuses, weaponRange } from "./equipment";
import type { EquipmentDefinition } from "./schemas";

export interface ClassDefinition {
  id: string;
  name: { th: string; en: string };
  /** Basic attack reach until class kits exist (EXAMPLE). */
  basicAttackRange: Range;
}

export interface RaceDefinition {
  id: string;
  name: { th: string; en: string };
}

/** P16 draft Class1 list (chapter 02). EXAMPLE: names and count can still change. */
export const CLASS1_DEFINITIONS: readonly ClassDefinition[] = [
  { id: "class:guardian", name: { th: "ผู้พิทักษ์", en: "Guardian" }, basicAttackRange: "melee" },
  { id: "class:striker", name: { th: "นักรบ", en: "Striker" }, basicAttackRange: "melee" },
  { id: "class:ranger", name: { th: "นักล่า", en: "Ranger" }, basicAttackRange: "ranged" },
  { id: "class:arcanist", name: { th: "จอมเวท", en: "Arcanist" }, basicAttackRange: "ranged" },
  { id: "class:warden", name: { th: "ผู้เยียวยา", en: "Warden" }, basicAttackRange: "ranged" },
  { id: "class:binder", name: { th: "ผู้ประสานคู่ใจ", en: "Binder" }, basicAttackRange: "melee" },
  { id: "class:rogue", name: { th: "นักลอบเร้น", en: "Rogue" }, basicAttackRange: "melee" },
  { id: "class:alchemist", name: { th: "นักปรุงแปรธาตุ", en: "Alchemist" }, basicAttackRange: "ranged" },
  { id: "class:bard", name: { th: "นักขับขาน", en: "Bard" }, basicAttackRange: "ranged" },
];

/** P16 draft race list (chapter 02). EXAMPLE. Race passives are not built yet. */
export const RACE_DEFINITIONS: readonly RaceDefinition[] = [
  { id: "race:human", name: { th: "มนุษย์", en: "Human" } },
  { id: "race:sylvan", name: { th: "ชาวพฤกษ์", en: "Sylvan" } },
  { id: "race:stonekin", name: { th: "ชาวศิลา", en: "Stonekin" } },
  { id: "race:wildkin", name: { th: "เผ่าสัตว์", en: "Wildkin" } },
  { id: "race:runeborn", name: { th: "ชาวอาคม", en: "Runeborn" } },
  { id: "race:tideborn", name: { th: "ชาวสมุทร", en: "Tideborn" } },
  { id: "race:skyborn", name: { th: "ชาวเวหา", en: "Skyborn" } },
  { id: "race:veilborn", name: { th: "ชาวสนธยา", en: "Veilborn" } },
];

/** The six elements of chapter 02; a player picks one at creation (NEUTRAL is not a choice). */
export const PLAYER_ELEMENTS = ["FIRE", "WATER", "EARTH", "WIND", "LIGHT", "SHADOW"] as const satisfies readonly Element[];

/** Placeholder active skill for every class until class kits exist. */
export const PLACEHOLDER_PLAYER_SKILLS = ["skill:player_power_strike", "skill:player_sweep"];

const classIds = CLASS1_DEFINITIONS.map((c) => c.id) as [string, ...string[]];
const raceIds = RACE_DEFINITIONS.map((r) => r.id) as [string, ...string[]];

/**
 * Display name: 2–16 letters, marks or digits (Thai included), single spaces inside. Duplicate
 * names are allowed for now: chapter 00 has no rule on it and O10 (characters per account) is open.
 */
export const CharacterNameSchema = z
  .string()
  .transform((s) => s.normalize("NFC").trim())
  .pipe(z.string().regex(/^[\p{L}\p{M}\p{N}_]+( [\p{L}\p{M}\p{N}_]+)*$/u, "letters, digits, _ and single spaces only"))
  .refine((s) => [...s].length >= 2 && [...s].length <= 16, "2–16 characters");

export const OperationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const CreateCharacterRequestSchema = z
  .object({
    operationId: OperationIdSchema,
    name: CharacterNameSchema,
    classId: z.enum(classIds),
    raceId: z.enum(raceIds),
    element: ElementSchema.refine((e) => (PLAYER_ELEMENTS as readonly string[]).includes(e), "pick one of the six elements"),
  })
  .strict();
export type CreateCharacterRequest = z.infer<typeof CreateCharacterRequestSchema>;

export const SetTeamRequestSchema = z
  .object({
    /** The character version the client last saw; a stale write is refused (chapter 11 §4). */
    expectedVersion: z.number().int().min(1),
    companionIds: z.array(z.string().min(1).max(80)).max(10),
  })
  .strict();
export type SetTeamRequest = z.infer<typeof SetTeamRequestSchema>;

/** One team slot: a companion and where it stands. */
export interface TeamSlot {
  instanceId: string;
  speciesId: string;
  row: "front" | "back";
  slot: number;
}

export interface CharacterView {
  id: string;
  name: string;
  classId: string;
  raceId: string;
  element: Element;
  level: number;
  xp: number;
  primaryStats: PrimaryStats;
  /** Current HP/MP; `null` means full. */
  hp: number | null;
  mp: number | null;
  version: number;
  team: TeamSlot[];
}

export const PLAYER_POSITION = { row: "front", slot: 1 } as const;

/**
 * Where team members stand (P15: 3 front, 3 back; the player is front-centre). Tank and physical
 * companions take the remaining front cells first, everyone else the back row, overflow spills
 * into whatever is left. Deterministic, so the same team always forms the same way.
 */
export function teamFormation(
  rules: RulesConfig,
  members: readonly { instanceId: string; speciesId: string }[],
  species: ReadonlyMap<string, SpeciesDefinition>,
): TeamSlot[] {
  const front = Array.from({ length: rules.provisional.formationFrontSlots.value }, (_, i) => i).filter((s) => s !== PLAYER_POSITION.slot);
  const back = Array.from({ length: rules.provisional.formationBackSlots.value }, (_, i) => i);
  // Centre first, then outwards.
  const order = (cells: number[]) => [...cells].sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1) || a - b);
  const free = { front: order(front), back: order(back) };
  const prefersFront = (sid: string) => {
    const a = species.get(sid)?.archetype;
    return a === "tank" || a === "physical";
  };
  return members.map((m) => {
    const want: "front" | "back" = prefersFront(m.speciesId) ? "front" : "back";
    const other = want === "front" ? "back" : "front";
    const row = free[want].length > 0 ? want : other;
    const slot = free[row].shift();
    if (slot === undefined) throw new Error("team larger than the formation");
    return { instanceId: m.instanceId, speciesId: m.speciesId, row, slot };
  });
}

/** The battle's player unit, built from a stored character and what it wears. */
export function playerSetup(
  accountId: string,
  c: CharacterView,
  worn: { defs: readonly EquipmentDefinition[]; mainHand?: EquipmentDefinition; sigilIds?: readonly string[] } = { defs: [] },
): BattleSetup["player"] {
  const cls = CLASS1_DEFINITIONS.find((d) => d.id === c.classId);
  return {
    accountId,
    name: c.name,
    level: c.level,
    element: c.element,
    primaryStats: { ...c.primaryStats },
    gear: gearBonuses(worn.defs),
    ...(c.hp === null ? {} : { hp: c.hp }),
    ...(c.mp === null ? {} : { mp: c.mp }),
    skillIds: [...PLACEHOLDER_PLAYER_SKILLS],
    ...(worn.sigilIds !== undefined && worn.sigilIds.length > 0 ? { sigilIds: [...worn.sigilIds] } : {}),
    basicAttackRange: weaponRange(worn.mainHand, cls?.basicAttackRange ?? "melee"),
    row: PLAYER_POSITION.row,
    slot: PLAYER_POSITION.slot,
  };
}

/** Companion units for a battle from the team and the stored instances (with their HP/MP). */
export function companionSetups(
  team: readonly TeamSlot[],
  instances: ReadonlyMap<string, MonsterInstance & { hp: number | null; mp: number | null }>,
): BattleSetup["companions"] {
  return team.map((t) => {
    const inst = instances.get(t.instanceId);
    if (inst === undefined) throw new Error(`team member ${t.instanceId} is missing`);
    const { hp, mp, ...instance } = inst;
    return { instance, row: t.row, slot: t.slot, ...(hp === null ? {} : { hp }), ...(mp === null ? {} : { mp }) };
  });
}
