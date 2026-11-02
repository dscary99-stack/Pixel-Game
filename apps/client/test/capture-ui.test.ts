import { describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES, createBattle, exampleContentMaps, type BattleSetup, type PublicBattleState } from "@pmrpg/shared";
import { capturePreview, pct2 } from "../src/capture-ui";

const content = exampleContentMaps();
function state(level: number, bag: Record<string, number>, foxHp?: number): PublicBattleState {
  const setup: BattleSetup = {
    battleId: "battle:ui",
    originMode: "manual",
    seed: "ui",
    player: { accountId: "a", name: "n", level, element: "FIRE", primaryStats: { STR: 30, VIT: 25, INT: 10, DEX: 15, AGI: 40, SPI: 10 }, gear: {}, skillIds: [], basicAttackRange: "melee", row: "front", slot: 1 },
    companions: [],
    enemies: [{ unitId: "w", speciesId: "species:ember_fox", element: "FIRE", row: "front", slot: 0 }],
    bag,
  };
  const r = createBattle(DEV_FIXTURE_RULES, content, setup);
  if (!r.ok) throw new Error(r.message);
  const s = structuredClone(r.state) as PublicBattleState;
  const w = s.units.find((u) => u.unitId === "w")!;
  if (foxHp !== undefined) w.hp = Math.floor(w.stats.maxHp * foxHp);
  return s;
}

describe("capture preview text", () => {
  it("shows the chance with two decimals, the factors and what a try costs", () => {
    const pv = capturePreview(DEV_FIXTURE_RULES, state(10, { "item:ember_fox_capture": 1 }, 0.25), content, "player", "w");
    expect(pv.ok).toBe(true);
    expect(pv.itemId).toBe("item:ember_fox_capture");
    expect(pv.lines[0]).toContain("40.00%");
    expect(pv.lines[1]).toContain("HP ×2");
    expect(pv.lines.join("\n")).toContain("แม้พลาด");
    expect(pct2(0.123456)).toBe("12.35%");
  });

  it("says why a capture cannot be tried: no item, level too low (with the level needed)", () => {
    expect(capturePreview(DEV_FIXTURE_RULES, state(10, {}), content, "player", "w").lines[0]).toContain("ไม่มีเครื่องจับ");
    const low = capturePreview(DEV_FIXTURE_RULES, state(1, { "item:ember_fox_capture": 1 }), content, "player", "w");
    expect(low.ok).toBe(false);
    expect(low.lines[0]).toContain("อย่างน้อย 3");
  });
});
