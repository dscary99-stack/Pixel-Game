import { describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES as R, EXAMPLE_ITEMS, ItemDefinitionSchema, UseResetRequestSchema, startingStats } from "../src";

describe("reset scrolls (Nut 2026-10-09)", () => {
  it("ships a stat scroll and a skill scroll, and only reset items name what they reset", () => {
    const resets = EXAMPLE_ITEMS.filter((i) => i.kind === "reset").map((i) => i.resets);
    expect(resets.sort()).toEqual(["skills", "stats"]);
    const scroll = EXAMPLE_ITEMS.find((i) => i.id === "item:stat_reset_scroll")!;
    expect(ItemDefinitionSchema.safeParse({ ...scroll, resets: undefined }).success).toBe(false);
    expect(ItemDefinitionSchema.safeParse({ ...scroll, kind: "material" }).success).toBe(false);
  });

  it("starting stats match character creation and the request needs an operation id", () => {
    expect(Object.values(startingStats(R)).every((v) => v === R.provisional.primaryStatStart.value)).toBe(true);
    expect(UseResetRequestSchema.safeParse({ itemId: "item:stat_reset_scroll" }).success).toBe(false);
  });
});
