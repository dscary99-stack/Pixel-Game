/**
 * Collection / Journal (chapter 09 "Collection / Journal").
 *
 * - Records are kept apart: seen, defeated, captured personally, owned now, element record, raised,
 *   reborn, Bond milestone, boss defeated, Sigils received / worn, maps discovered.
 * - History stays after a companion leaves (defeats and personal captures are counted from what the
 *   server recorded); "owned" follows current ownership.
 * - Rewards are titles only (cosmetic, chapter 09: no account ATK for collecting). Nothing a build
 *   needs (capture items, Sigil fit, drops) is hidden behind the journal: species info stays readable.
 * - Titles here are EXAMPLE content (P12); names and thresholds are Claude's first pass.
 */
import { z } from "zod";
import type { Element } from "./schemas";

export interface JournalSpecies {
  speciesId: string;
  /** Elements this species was met in (seen in a fight). */
  seenElements: Element[];
  defeated: number;
  capturedPersonally: number;
  /** Elements captured personally (the element record). */
  capturedElements: Element[];
  ownedNow: number;
  /** Highest level among owned companions of this species. */
  raisedLevel: number;
  /** Highest Rebirth stage among owned companions of this species. */
  rebirthStage: number;
  /** Highest Bond tier (0–4) among owned companions of this species. */
  bondTier: number;
}

export interface JournalSummary {
  species: JournalSpecies[];
  /** Map ids the character has entered. */
  maps: string[];
  /** Sigil ids received from drops, with counts. */
  sigilsReceived: Record<string, number>;
  /** Sigil ids worn in gear now. */
  sigilsWorn: string[];
}

export interface JournalTitle {
  id: string;
  name: { th: string };
  /** What earns it, shown even before it is earned. */
  how: { th: string };
  earned: (j: JournalSummary, ctx: { bossSpecies: ReadonlySet<string> }) => boolean;
}

const count = (j: JournalSummary, f: (s: JournalSpecies) => boolean) => j.species.filter(f).length;

/** EXAMPLE titles (P12). Cosmetic only. */
export const JOURNAL_TITLES: JournalTitle[] = [
  { id: "title:first_steps", name: { th: "นักเดินทางหน้าใหม่" }, how: { th: "ไปถึง 2 แผนที่" }, earned: (j) => j.maps.length >= 2 },
  { id: "title:observer", name: { th: "นักสังเกต" }, how: { th: "พบมอนสเตอร์ 3 ชนิด" }, earned: (j) => count(j, (s) => s.seenElements.length > 0) >= 3 },
  { id: "title:hunter", name: { th: "นักล่า" }, how: { th: "ชนะมอนสเตอร์ 4 ชนิด" }, earned: (j) => count(j, (s) => s.defeated > 0) >= 4 },
  { id: "title:catcher", name: { th: "มือจับ" }, how: { th: "จับเองได้ 3 ชนิด" }, earned: (j) => count(j, (s) => s.capturedPersonally > 0) >= 3 },
  {
    id: "title:rainbow",
    name: { th: "ผู้สะสมสีสัน" },
    how: { th: "จับชนิดเดียวกันได้ครบ 2 ธาตุ" },
    earned: (j) => j.species.some((s) => s.capturedElements.length >= 2),
  },
  { id: "title:raiser", name: { th: "ผู้เลี้ยงดู" }, how: { th: "เลี้ยงคู่ใจถึง Lv20" }, earned: (j) => j.species.some((s) => s.raisedLevel >= 20) },
  { id: "title:bonded", name: { th: "เพื่อนแท้" }, how: { th: "Bond ระดับ ไว้ใจ ขึ้นไป" }, earned: (j) => j.species.some((s) => s.bondTier >= 2) },
  { id: "title:reborn", name: { th: "ผู้เปิดทางจุติ" }, how: { th: "จุติคู่ใจครั้งแรก" }, earned: (j) => j.species.some((s) => s.rebirthStage >= 1) },
  {
    id: "title:boss_breaker",
    name: { th: "ผู้ล้มเจ้าถิ่น" },
    how: { th: "ชนะบอสเจ้าถิ่น" },
    earned: (j, c) => j.species.some((s) => c.bossSpecies.has(s.speciesId) && s.defeated > 0),
  },
  { id: "title:sigil_finder", name: { th: "ผู้พบตรา" }, how: { th: "ได้ตรา Sigil จากการดรอป" }, earned: (j) => Object.keys(j.sigilsReceived).length >= 1 },
];

export function earnedTitles(j: JournalSummary, bossSpecies: ReadonlySet<string>): string[] {
  return JOURNAL_TITLES.filter((t) => t.earned(j, { bossSpecies })).map((t) => t.id);
}

export const TitleRequestSchema = z.object({ titleId: z.string().regex(/^title:[a-z0-9_]+$/).nullable() }).strict();
export type TitleRequest = z.infer<typeof TitleRequestSchema>;

/** Level band of 5 for the journal's search (1–5, 6–10, …). */
export const levelBand = (level: number) => {
  const lo = Math.floor((Math.max(1, level) - 1) / 5) * 5 + 1;
  return `${lo}–${lo + 4}`;
};
