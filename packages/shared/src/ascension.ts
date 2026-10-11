/**
 * Divine awakening จุติเทพ (chapter 02 draft, P31; Claude's design, STATUS A148). From Lv200 with a
 * Class3, a character takes its race's trial at ผู้ใหญ่พิมพ์ (a training-ground boss fight, like the
 * class trials: any class can win it with its team), then claims the ascension in town for coins and
 * materials, picking path A or B. From then on:
 *
 * - its race passive is replaced by the path's evolved passive (never both: player-kit.ts);
 * - in every fight it has an awakening gauge (battle kernel): 0 at the start, filled by actions that
 *   did something, capped per round; full, it may spend its action to awaken once a fight, which puts
 *   the path's awakening statuses up for a few of its own turns. Auto may awaken by the player's rule.
 *
 * The path is switched in town for coins (a coin sink, like the Rebirth branch). Nothing here touches
 * EXP, drops or capture, and every player gets the same (no premium step).
 */
import { z } from "zod";
import { OperationIdSchema, RACE_DEFINITIONS, type CharacterView } from "./character";
import { ASCENSION_PASSIVE_SKILLS } from "./content/player-skills";
import type { RulesConfig } from "./rules";
import type { StatusApplication } from "./schemas";

export type AscensionPathKey = "a" | "b";

/** What awakening puts up: statuses on the character, its side, or the enemy side (rolled as usual). */
export interface AwakeningEffect {
  target: "self" | "allies" | "enemies";
  /** Turns come from the rules (`awakenTurns`); helpful ones always land, harmful ones roll their chance. */
  statuses: Omit<StatusApplication, "turns">[];
}

export interface AscensionPath {
  /** `ascend:<race>:<a|b>` */
  id: string;
  key: AscensionPathKey;
  name: { th: string };
  summary: string;
  /** The evolved passive that replaces the race passive. */
  passiveId: string;
  awakening: AwakeningEffect[];
}

export interface Ascension {
  /** `ascend:<race>`: also the trial's id. */
  id: string;
  raceId: string;
  name: { th: string; en: string };
  /** The awakening look (chapter 02), for the art handoff. */
  visual: string;
  paths: readonly [AscensionPath, AscensionPath];
}

const s = (statusId: StatusApplication["statusId"], chancePct = 100, more: Partial<StatusApplication> = {}): Omit<StatusApplication, "turns"> => ({ statusId, chancePct, ...more });

function asc(race: string, th: string, en: string, visual: string, a: Omit<AscensionPath, "id" | "key" | "passiveId">, b: Omit<AscensionPath, "id" | "key" | "passiveId">): Ascension {
  const path = (key: AscensionPathKey, p: Omit<AscensionPath, "id" | "key" | "passiveId">): AscensionPath => ({ ...p, id: `ascend:${race}:${key}`, key, passiveId: `skill:ascend_${race}_${key}` });
  return { id: `ascend:${race}`, raceId: `race:${race}`, name: { th, en }, visual, paths: [path("a", a), path("b", b)] };
}

/** Chapter 02 table: 8 races, each with paths A and B. EXAMPLE numbers (P31). */
export const ASCENSIONS: readonly Ascension[] = [
  asc(
    "human",
    "เทพผู้บุกเบิก",
    "Firstlight Ascendant",
    "วงแหวนเจตจำนง",
    { name: { th: "ความกล้า" }, summary: "ใช้ไอเทมแล้วได้โล่และพร้อมบุก; ตื่นแล้วโจมตีและคริแรงขึ้น", awakening: [{ target: "self", statuses: [s("atk_up"), s("matk_up"), s("crit_up")] }] },
    { name: { th: "ความหวัง" }, summary: "ใช้ไอเทมแล้วเป้าหมายได้โล่และ DEF; ตื่นแล้วทั้งทีมได้โล่", awakening: [{ target: "allies", statuses: [s("shield", 100, { shieldPct: 10 }), s("def_up")] }] },
  ),
  asc(
    "sylvan",
    "เทพพฤกษาชีวิต",
    "Worldbloom Ascendant",
    "กิ่งมงกุฎและกลีบดอก",
    { name: { th: "ผลิบาน" }, summary: "ฮีลคนเลือดน้อยแรงขึ้น ใช้สกิลฟื้นต่อเนื่องแล้วคนเลือดน้อยสุดได้โล่; ตื่นแล้วทั้งทีมฟื้นต่อเนื่องและได้โล่", awakening: [{ target: "allies", statuses: [s("regen"), s("shield", 100, { shieldPct: 6 })] }] },
    { name: { th: "หนามพิทักษ์" }, summary: "ถูกตีแล้วมีโอกาสได้หนาม; ตื่นแล้วทั้งทีมมีหนามและ DEF", awakening: [{ target: "allies", statuses: [s("thorns"), s("def_up")] }] },
  ),
  asc(
    "stonekin",
    "เทพศิลานิรันดร์",
    "Eternalstone Ascendant",
    "ศิลาลอยรอบตัว",
    { name: { th: "ขุนเขา" }, summary: "ตั้งรับลดดาเมจมากขึ้นและทั้งทีมได้ DEF; ตื่นแล้วทั้งทีม DEF/MDEF ขึ้น", awakening: [{ target: "allies", statuses: [s("def_up"), s("mdef_up")] }] },
    { name: { th: "แผ่นดินสะท้าน" }, summary: "ตั้งรับแล้วชาร์จพลัง ถูกตีแล้วมีโอกาสลด DEF ผู้ตี; ตื่นแล้ว ATK ขึ้นและลด DEF ศัตรูทั้งหมด", awakening: [{ target: "self", statuses: [s("atk_up")] }, { target: "enemies", statuses: [s("def_down", 60)] }] },
  ),
  asc(
    "wildkin",
    "เทพสัตว์ปฐมกาล",
    "Primal Ascendant",
    "เงาสัตว์บรรพกาล",
    { name: { th: "นักล่า" }, summary: "เริ่มไฟต์แม่นและคริขึ้น ตีแล้วมีโอกาสตีตราเป้า; ตื่นแล้ว ATK แม่น คริขึ้น", awakening: [{ target: "self", statuses: [s("atk_up"), s("accuracy_up"), s("crit_up")] }] },
    { name: { th: "จ่าฝูง" }, summary: "เริ่มไฟต์ทั้งทีมแม่นขึ้น (ไม่เพิ่ม action); ตื่นแล้วทั้งทีมแม่นและคริขึ้น", awakening: [{ target: "allies", statuses: [s("accuracy_up"), s("crit_up")] }] },
  ),
  asc(
    "runeborn",
    "เทพอักขระต้นกำเนิด",
    "Originrune Ascendant",
    "วงอักขระ",
    { name: { th: "ถักเวท" }, summary: "ใช้สกิลแล้วได้ MP คืนบ่อยขึ้น; ตื่นแล้ว MP ฟื้นต่อเนื่องและ MATK ขึ้น", awakening: [{ target: "self", statuses: [s("mp_regen"), s("matk_up")] }] },
    { name: { th: "แตกอักขระ" }, summary: "สกิลที่โดนมีโอกาสลด MDEF เป้า (ได้ MP คืนน้อยลง); ตื่นแล้ว MATK ขึ้นและชาร์จพลัง", awakening: [{ target: "self", statuses: [s("matk_up"), s("focus")] }] },
  ),
  asc(
    "tideborn",
    "เทพสมุทรไร้ก้น",
    "Abyssal Tide Ascendant",
    "ปะการังและม่านน้ำ",
    { name: { th: "น้ำขึ้น" }, summary: "ล้างสถานะแล้วผู้ถูกล้างได้ต้านทานและฟื้นต่อเนื่อง; ตื่นแล้วทั้งทีมต้านทานและฟื้นต่อเนื่อง", awakening: [{ target: "allies", statuses: [s("res_up"), s("regen")] }] },
    { name: { th: "น้ำลง" }, summary: "ตีแล้วมีโอกาสลด SPD เป้า; ตื่นแล้วทั้งทีมต้านทานขึ้นและลด SPD ศัตรูทั้งหมด", awakening: [{ target: "allies", statuses: [s("res_up")] }, { target: "enemies", statuses: [s("spd_down", 60)] }] },
  ),
  asc(
    "skyborn",
    "เทพเวหานิรันดร์",
    "Boundless Sky Ascendant",
    "ปีกและขนนก",
    { name: { th: "กระแสลม" }, summary: "สลับตำแหน่งแล้วหลบและ SPD ขึ้นรอบหน้า; ตื่นแล้วทั้งทีม SPD ขึ้น", awakening: [{ target: "allies", statuses: [s("spd_up")] }] },
    { name: { th: "ปีกพิทักษ์" }, summary: "สลับตำแหน่งแล้วหลบและได้โล่; ตื่นแล้วทั้งทีมหลบขึ้นและได้โล่", awakening: [{ target: "allies", statuses: [s("evasion_up"), s("shield", 100, { shieldPct: 6 })] }] },
  ),
  asc(
    "veilborn",
    "เทพม่านสนธยา",
    "Twilight Veil Ascendant",
    "จันทร์และหมอก",
    { name: { th: "ม่านหมอก" }, summary: "ถูกติดสถานะแล้วแม่นขึ้นและลดดาเมจครั้งถัดไป; ตื่นแล้วลดดาเมจและหลบขึ้น", awakening: [{ target: "self", statuses: [s("dmg_reduction"), s("evasion_up")] }, { target: "allies", statuses: [s("dmg_reduction")] }] },
    { name: { th: "จันทร์ย้อนเงา" }, summary: "ถูกติดสถานะแล้วแม่นขึ้นและพร้อมสวน; ตื่นแล้วสวนกลับและ ATK ขึ้น", awakening: [{ target: "self", statuses: [s("counter"), s("atk_up")] }] },
  ),
];

export const ascensionOfRace = (raceId: string): Ascension | undefined => ASCENSIONS.find((a) => a.raceId === raceId);
/** The path for an `ascend:<race>:<a|b>` id, or undefined. */
export function ascensionPath(id: string | null | undefined): AscensionPath | undefined {
  if (id == null) return undefined;
  for (const a of ASCENSIONS) for (const p of a.paths) if (p.id === id) return p;
  return undefined;
}
/** The race an ascension path belongs to. */
export const ascensionOfPath = (id: string): Ascension | undefined => ASCENSIONS.find((a) => a.paths.some((p) => p.id === id));

/** The awakening statuses of a path with the rules' turns. */
export function awakeningApplications(rules: RulesConfig, path: AscensionPath): { target: AwakeningEffect["target"]; statuses: StatusApplication[] }[] {
  const turns = rules.provisional.ascension.value.awakenTurns;
  return path.awakening.map((e) => ({ target: e.target, statuses: e.statuses.map((x) => ({ ...x, turns })) }));
}

export const ASCENSION_PASSIVE_IDS: ReadonlySet<string> = new Set(ASCENSION_PASSIVE_SKILLS.map((x) => x.id));

// ------------------------------------------------------------------ trial, claim, switch

/** The trial boss (the tower tyrant again, at the ascension stat %). EXAMPLE. */
export const ASCENSION_TRIAL_BOSS_ID = "boss:rift_spire_tyrant";

export const AscendClaimRequestSchema = z
  .object({ operationId: OperationIdSchema, trialOperationId: OperationIdSchema, path: z.enum(["a", "b"]), expectedCoins: z.number().int().min(0) })
  .strict();
export type AscendClaimRequest = z.infer<typeof AscendClaimRequestSchema>;
export const AscendSwitchRequestSchema = z
  .object({ operationId: OperationIdSchema, expectedPath: z.enum(["a", "b"]), path: z.enum(["a", "b"]), expectedCoins: z.number().int().min(0) })
  .strict();
export type AscendSwitchRequest = z.infer<typeof AscendSwitchRequestSchema>;

export type AscensionBlocked = null | "NO_CLASS3" | "LEVEL_TOO_LOW" | "ALREADY_ASCENDED";

type AscendCharacter = Pick<CharacterView, "raceId" | "level"> & { class3Id?: string | null; ascensionId?: string | null };

export function ascensionBlocked(rules: RulesConfig, c: AscendCharacter): AscensionBlocked {
  if (c.ascensionId != null) return "ALREADY_ASCENDED";
  if (c.class3Id == null) return "NO_CLASS3";
  if (c.level < rules.provisional.ascension.value.level) return "LEVEL_TOO_LOW";
  return null;
}

/** Why this character cannot take the trial `trialId` (`ascend:<race>`), or null. */
export function ascensionRefusal(rules: RulesConfig, c: AscendCharacter, trialId: string): null | "NOT_FOUND" | Exclude<AscensionBlocked, null> {
  const a = ascensionOfRace(c.raceId);
  if (a === undefined || a.id !== trialId) return "NOT_FOUND";
  return ascensionBlocked(rules, c);
}

export interface AscensionView {
  ascension: Omit<Ascension, "paths"> & { raceName: string; paths: readonly (AscensionPath & { passiveName: string })[] };
  /** The character's path, or null before the claim. */
  pathId: string | null;
  level: number;
  trialStatPct: number;
  bossId: string;
  cost: { coins: number; materials: readonly { itemId: string; quantity: number }[] };
  switchCoins: number;
  blocked: AscensionBlocked;
}

export function ascensionView(rules: RulesConfig, c: AscendCharacter): AscensionView | null {
  const a = ascensionOfRace(c.raceId);
  if (a === undefined) return null;
  const r = rules.provisional.ascension.value;
  const names = new Map(ASCENSION_PASSIVE_SKILLS.map((x) => [x.id, x.name.th]));
  return {
    ascension: {
      ...a,
      raceName: RACE_DEFINITIONS.find((d) => d.id === a.raceId)?.name.th ?? a.raceId,
      paths: a.paths.map((p) => ({ ...p, passiveName: names.get(p.passiveId) ?? p.passiveId })),
    },
    pathId: c.ascensionId ?? null,
    level: r.level,
    trialStatPct: r.trialStatPct,
    bossId: ASCENSION_TRIAL_BOSS_ID,
    cost: { coins: r.coins, materials: r.materials },
    switchCoins: r.pathSwitchCoins,
    blocked: ascensionBlocked(rules, c),
  };
}
