/**
 * Daily and Weekly quests (chapter 09, P13).
 *
 * - Quests are a reward bonus, never a farming licence: after the daily rewards are claimed, EXP,
 *   drops and captures stay unlimited (no global farming cap, no energy).
 * - Periods are server-defined (reset hour in rules), never the player's clock. A claim id carries
 *   the period, so one reward can never be claimed twice.
 * - Progress is counted from what the server already recorded since the period opened (kills,
 *   captures, crafts), so nothing has to be "accepted" first. Auto Hunt kills count; captures are
 *   always manual (no auto capture). A delivery consumes the items when it is claimed.
 * - A board is rolled once per character and period from the character's level at that moment, and
 *   only names monsters the character can reach (wild level ≤ level + slack).
 */
import { z } from "zod";
import { PROFESSIONS, ProfessionSchema, type Profession, type Recipe } from "./craft";
import { expToNext } from "./progression";
import { Rng } from "./rng";
import type { RulesConfig } from "./rules";
import type { BossDefinition, ItemDefinition, LootTable, SpeciesDefinition } from "./schemas";
import type { MapDefinition } from "./world/map";

export type QuestCadence = "daily" | "weekly";

export interface QuestPeriod {
  /** `d:2026-10-04` or `w:2026-09-28` (the date the period opened, in reset-shifted UTC). */
  id: string;
  startsAt: string;
  endsAt: string;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** The period `nowIso` falls in. Days open at the reset hour (UTC); weeks open on Monday at it. */
export function questPeriod(rules: RulesConfig, cadence: QuestCadence, nowIso: string): QuestPeriod {
  const reset = rules.provisional.quests.value.resetHourUtc * HOUR;
  const shifted = Date.parse(nowIso) - reset;
  let day = Math.floor(shifted / DAY);
  let length = DAY;
  if (cadence === "weekly") {
    // 1970-01-01 was a Thursday: (day + 3) % 7 is 0 on Mondays.
    day -= (day + 3) % 7;
    length = 7 * DAY;
  }
  const start = day * DAY + reset;
  const date = new Date(day * DAY).toISOString().slice(0, 10);
  return { id: `${cadence === "daily" ? "d" : "w"}:${date}`, startsAt: new Date(start).toISOString(), endsAt: new Date(start + length).toISOString() };
}

export const QuestPeriodIdSchema = z.string().regex(/^[dw]:\d{4}-\d{2}-\d{2}$/);

export const QuestGoalSchema = z.discriminatedUnion("kind", [
  /** Defeat monsters of these species (one species, or a map's whole roster). Auto Hunt counts. */
  z.object({ kind: z.literal("hunt"), speciesIds: z.array(z.string()).min(1), count: z.number().int().min(1), mapId: z.string().optional() }).strict(),
  /** Defeat the field boss. */
  z.object({ kind: z.literal("boss"), speciesIds: z.array(z.string()).min(1), count: z.number().int().min(1) }).strict(),
  /** Capture any of these species (manual only). */
  z.object({ kind: z.literal("capture"), speciesIds: z.array(z.string()).min(1), count: z.number().int().min(1) }).strict(),
  /** Craft anything of this profession, counted per craft. */
  z.object({ kind: z.literal("craft"), profession: ProfessionSchema, count: z.number().int().min(1) }).strict(),
  /** Hand items to the board; they are consumed on claim. */
  z.object({ kind: z.literal("deliver"), itemId: z.string(), count: z.number().int().min(1) }).strict(),
]);
export type QuestGoal = z.infer<typeof QuestGoalSchema>;

export interface QuestReward {
  coins: number;
  exp: number;
  items: { itemId: string; quantity: number }[];
}

export interface QuestBoard {
  cadence: QuestCadence;
  periodId: string;
  /** Character level the board was rolled at (rewards and targets follow it). */
  level: number;
  goals: QuestGoal[];
  /** Daily: one reward per goal (up to `dailyClaims` of them). Weekly: one main reward. */
  reward: QuestReward;
}

export interface QuestContent {
  maps: ReadonlyMap<string, MapDefinition>;
  species: ReadonlyMap<string, SpeciesDefinition>;
  items: ReadonlyMap<string, ItemDefinition>;
  lootTables: ReadonlyMap<string, LootTable>;
  recipes: ReadonlyMap<string, Recipe>;
  bosses: ReadonlyMap<string, BossDefinition>;
}

/** Reward for a board rolled at `level`. */
export function questReward(rules: RulesConfig, cadence: QuestCadence, level: number): QuestReward {
  const r = rules.provisional.quests.value[cadence];
  const step = expToNext(rules, "player", level) ?? 0;
  return { coins: r.coinsBase + r.coinsPerLevel * level, exp: Math.floor((step * r.expPctOfLevel) / 100), items: [{ itemId: r.itemId, quantity: r.itemQty }] };
}

/** What a character at `level` can reach: hunting maps' species (normal) and bosses, by wild level. */
function reachable(rules: RulesConfig, content: QuestContent, level: number) {
  const slack = rules.provisional.quests.value.levelSlack;
  const ok = (id: string) => {
    const s = content.species.get(id);
    return s !== undefined && s.fixedWildLevel <= level + slack;
  };
  const areas: { mapId: string; speciesIds: string[] }[] = [];
  const species = new Set<string>();
  const bosses = new Set<string>();
  for (const m of [...content.maps.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (m.kind === "town") continue;
    const ids = [...new Set(m.spawns.flatMap((sp) => sp.entries.map((e) => e.speciesId)))].filter(ok).sort();
    if (ids.length > 0) areas.push({ mapId: m.id, speciesIds: ids });
    for (const id of ids) species.add(id);
    const boss = m.bossLair === undefined ? undefined : content.bosses.get(m.bossLair.bossId);
    if (boss !== undefined && ok(boss.speciesId)) bosses.add(boss.speciesId);
  }
  return { areas, species: [...species].sort(), bosses: [...bosses].sort() };
}

/** Materials the reachable species drop from their own pool, for delivery quests. */
function deliverable(content: QuestContent, speciesIds: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of speciesIds) {
    const table = content.lootTables.get(content.species.get(id)?.lootTableId ?? "");
    for (const p of table?.pools ?? []) {
      if (p.id !== "species") continue;
      for (const e of p.entries) if (content.items.get(e.itemId)?.kind === "material") out.add(e.itemId);
    }
  }
  return [...out].sort();
}

/** Professions with a recipe anyone can make (no mastery needed). */
function craftable(content: QuestContent): Profession[] {
  return PROFESSIONS.filter((p) => [...content.recipes.values()].some((r) => r.profession === p && r.requiredMastery === 0));
}

const pick = <T>(rng: Rng, list: readonly T[]): T => list[rng.nextInt(list.length)]!;
const goalKey = (g: QuestGoal) => JSON.stringify(g.kind === "craft" ? [g.kind, g.profession] : g.kind === "deliver" ? [g.kind, g.itemId] : [g.kind, g.speciesIds]);

/**
 * Roll a board. One goal of each available category first (so a day offers variety), then more hunts
 * and deliveries until the board is full; no goal twice. Capture goals only appear once capture rates
 * exist (O07), since a capture cannot succeed before that. The server seeds `rng` and stores the board.
 */
export function rollQuestBoard(rules: RulesConfig, content: QuestContent, cadence: QuestCadence, periodId: string, level: number, rng: Rng): QuestBoard {
  const q = rules.provisional.quests.value;
  const c = q.counts;
  const daily = cadence === "daily";
  const r = reachable(rules, content, level);
  const items = deliverable(content, r.species);
  const profs = craftable(content);
  const canCapture = rules.unresolved.captureRates.value !== null;
  const capturable = r.species.filter((id) => content.species.get(id)?.rank !== "BOSS");

  const makers: (() => QuestGoal | null)[] = [
    () => (r.species.length === 0 ? null : { kind: "hunt", speciesIds: [pick(rng, r.species)], count: daily ? c.hunt : c.weeklyHunt }),
    () => {
      if (r.areas.length === 0) return null;
      const a = pick(rng, r.areas);
      return { kind: "hunt", speciesIds: a.speciesIds, mapId: a.mapId, count: daily ? c.areaHunt : c.weeklyAreaHunt };
    },
    () => (profs.length === 0 ? null : { kind: "craft", profession: pick(rng, profs), count: daily ? c.craft : c.weeklyCraft }),
    // Weekly has no deliveries: its main reward is claimed for any done choices at once.
    () => (!daily || items.length === 0 ? null : { kind: "deliver", itemId: pick(rng, items), count: c.deliver }),
    () => {
      if (!canCapture || capturable.length === 0) return null;
      const n = Math.min(3, capturable.length);
      const ids = [...capturable];
      const chosen: string[] = [];
      while (chosen.length < n) {
        const id = ids.splice(rng.nextInt(ids.length), 1)[0]!;
        chosen.push(id);
      }
      return { kind: "capture", speciesIds: chosen.sort(), count: daily ? c.capture : c.weeklyCapture };
    },
    () => (daily || r.bosses.length === 0 ? null : { kind: "boss", speciesIds: [pick(rng, r.bosses)], count: c.weeklyBoss }),
  ];
  const size = daily ? q.dailyChoices : q.weeklyChoices;
  const goals: QuestGoal[] = [];
  const seen = new Set<string>();
  const add = (g: QuestGoal | null) => {
    if (g === null || goals.length >= size || seen.has(goalKey(g))) return;
    seen.add(goalKey(g));
    goals.push(g);
  };
  for (const m of makers) add(m());
  // Fill with more of the repeatable kinds; give up after a bounded number of tries (small content).
  const fillers = [makers[0]!, makers[0]!, makers[2]!, makers[3]!, makers[1]!];
  for (let tries = 0; goals.length < size && tries < 200; tries++) add(pick(rng, fillers)());
  return { cadence, periodId, level, goals, reward: questReward(rules, cadence, level) };
}

/** Thai label for a goal, for the board UI. */
export function questGoalText(g: QuestGoal, names: { species: (id: string) => string; item: (id: string) => string; map: (id: string) => string; profession: (p: Profession) => string }): string {
  switch (g.kind) {
    case "hunt":
      return g.mapId !== undefined ? `ล่ามอนสเตอร์ใน ${names.map(g.mapId)} ${g.count} ตัว` : `ล่า ${names.species(g.speciesIds[0]!)} ${g.count} ตัว`;
    case "boss":
      return `ชนะ ${names.species(g.speciesIds[0]!)} ${g.count} ครั้ง`;
    case "capture":
      return `จับ ${g.speciesIds.map(names.species).join(" / ")} ${g.count} ตัว`;
    case "craft":
      return `สร้างของสาย${names.profession(g.profession)} ${g.count} ครั้ง`;
    case "deliver":
      return `ส่ง ${names.item(g.itemId)} ${g.count} ชิ้น (ใช้ของตอนรับรางวัล)`;
  }
}

export const QuestClaimRequestSchema = z
  .object({
    periodId: QuestPeriodIdSchema,
    /** Daily goal index, or "main" for the weekly reward. */
    slot: z.union([z.number().int().min(0).max(15), z.literal("main")]),
  })
  .strict();
export type QuestClaimRequest = z.infer<typeof QuestClaimRequestSchema>;

/** One goal's progress as the client shows it. */
export interface QuestGoalView {
  goal: QuestGoal;
  progress: number;
  done: boolean;
  claimed: boolean;
}
export interface QuestBoardView {
  cadence: QuestCadence;
  period: QuestPeriod;
  level: number;
  reward: QuestReward;
  goals: QuestGoalView[];
  /** Daily: rewards still claimable today. Weekly: 1 until the main reward is claimed, else 0. */
  claimsLeft: number;
  /** Weekly: done goals needed for the main reward. */
  needs?: number;
}
