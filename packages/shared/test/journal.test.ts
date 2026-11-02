import { describe, expect, it } from "vitest";
import { JOURNAL_TITLES, earnedTitles, levelBand, type JournalSpecies, type JournalSummary } from "../src";

const sp = (speciesId: string, over: Partial<JournalSpecies> = {}): JournalSpecies => ({
  speciesId,
  seenElements: ["WATER"],
  defeated: 0,
  capturedPersonally: 0,
  capturedElements: [],
  ownedNow: 0,
  raisedLevel: 0,
  rebirthStage: 0,
  bondTier: 0,
  ...over,
});
const empty: JournalSummary = { species: [], maps: [], sigilsReceived: {}, sigilsWorn: [] };
const boss = new Set(["species:crystal_crab_lord"]);

describe("journal titles (chapter 09: cosmetic rewards)", () => {
  it("ids are unique and nothing is earned by an empty journal", () => {
    expect(new Set(JOURNAL_TITLES.map((t) => t.id)).size).toBe(JOURNAL_TITLES.length);
    expect(earnedTitles(empty, boss)).toEqual([]);
  });

  it("each record earns its own title", () => {
    const j: JournalSummary = {
      species: [
        sp("species:a", { defeated: 3, capturedPersonally: 1, capturedElements: ["WATER", "EARTH"], ownedNow: 1, raisedLevel: 20, bondTier: 2, rebirthStage: 1 }),
        sp("species:b", { defeated: 1 }),
        sp("species:c", { defeated: 1 }),
        sp("species:crystal_crab_lord", { defeated: 1 }),
      ],
      maps: ["map:a", "map:b"],
      sigilsReceived: { "sigil:x": 1 },
      sigilsWorn: [],
    };
    expect(earnedTitles(j, boss).sort()).toEqual(
      ["title:first_steps", "title:observer", "title:hunter", "title:rainbow", "title:raiser", "title:bonded", "title:reborn", "title:boss_breaker", "title:sigil_finder"].sort(),
    );
    // A boss defeat only counts for a boss species.
    expect(earnedTitles({ ...j, species: [sp("species:a", { defeated: 1 })] }, new Set()).includes("title:boss_breaker")).toBe(false);
  });

  it("level bands are 5 wide", () => {
    expect([1, 5, 6, 10, 11].map(levelBand)).toEqual(["1–5", "1–5", "6–10", "6–10", "11–15"]);
  });
});
