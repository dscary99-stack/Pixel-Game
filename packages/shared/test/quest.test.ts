import { describe, expect, it } from "vitest";
import {
  DEV_FIXTURE_RULES,
  PRODUCTION_RULES as R,
  QuestGoalSchema,
  Rng,
  exampleContentMaps,
  exampleMapRegistry,
  exampleRecipeRegistry,
  expToNext,
  questPeriod,
  questReward,
  rollQuestBoard,
  seedRng,
} from "../src";

const content = { ...exampleContentMaps(), maps: exampleMapRegistry(), recipes: exampleRecipeRegistry() };
const roll = (level: number, seed = "a", cadence: "daily" | "weekly" = "daily", rules = R) => rollQuestBoard(rules, content, cadence, "d:2026-10-04", level, new Rng(seedRng(seed)));

describe("quest periods (chapter 09: server-defined reset)", () => {
  it("days open at 21:00 UTC (04:00 Bangkok)", () => {
    expect(questPeriod(R, "daily", "2026-10-04T20:59:59.999Z")).toEqual({ id: "d:2026-10-03", startsAt: "2026-10-03T21:00:00.000Z", endsAt: "2026-10-04T21:00:00.000Z" });
    expect(questPeriod(R, "daily", "2026-10-04T21:00:00.000Z").id).toBe("d:2026-10-04");
  });
  it("weeks open on Monday at the reset hour", () => {
    // 2026-10-05 is a Monday.
    expect(questPeriod(R, "weekly", "2026-10-05T20:59:00Z")).toEqual({ id: "w:2026-09-28", startsAt: "2026-09-28T21:00:00.000Z", endsAt: "2026-10-05T21:00:00.000Z" });
    expect(questPeriod(R, "weekly", "2026-10-05T21:00:00Z").id).toBe("w:2026-10-05");
    expect(questPeriod(R, "weekly", "2026-10-11T23:00:00Z").id).toBe("w:2026-10-05");
  });
});

describe("quest boards (P13: daily 8 choose 4, weekly several ways)", () => {
  it("a daily board has 8 different valid goals with one of each available kind, same seed same board", () => {
    const b = roll(5);
    expect(b.goals).toHaveLength(8);
    for (const g of b.goals) expect(QuestGoalSchema.safeParse(g).success).toBe(true);
    expect(new Set(b.goals.map((g) => JSON.stringify(g))).size).toBe(8);
    const kinds = new Set(b.goals.map((g) => g.kind));
    for (const k of ["hunt", "craft", "deliver"]) expect(kinds.has(k as never)).toBe(true);
    expect(roll(5)).toEqual(b);
    expect(roll(5, "b")).not.toEqual(b);
  });

  it("names only monsters within reach, and capture goals now that capture has a profile (O07 → P18)", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const b = roll(1, seed);
      for (const g of b.goals) {
        if (g.kind === "hunt" || g.kind === "boss" || g.kind === "capture") for (const id of g.speciesIds) expect(content.species.get(id)!.fixedWildLevel).toBeLessThanOrEqual(4);
        expect(g.kind).not.toBe("boss");
      }
    }
    const withCapture = roll(5, "a", "daily", DEV_FIXTURE_RULES);
    expect(withCapture.goals.some((g) => g.kind === "capture")).toBe(true);
  });

  it("a weekly board can name the field boss once it is in reach, and never delivers", () => {
    const w = roll(6, "w", "weekly");
    expect(w.goals.length).toBeGreaterThanOrEqual(R.provisional.quests.value.weeklyMainNeeds);
    expect(w.goals.some((g) => g.kind === "boss" && g.speciesIds[0] === "species:crystal_crab_lord")).toBe(true);
    expect(w.goals.some((g) => g.kind === "deliver")).toBe(false);
  });

  it("rewards follow the level the board was rolled at", () => {
    const q = R.provisional.quests.value.daily;
    expect(questReward(R, "daily", 10)).toEqual({ coins: q.coinsBase + 10 * q.coinsPerLevel, exp: Math.floor((expToNext(R, "player", 10)! * q.expPctOfLevel) / 100), items: [{ itemId: q.itemId, quantity: q.itemQty }] });
    expect(questReward(R, "daily", 200).exp).toBe(0);
  });
});
