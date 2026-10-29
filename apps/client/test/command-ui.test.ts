import { describe, expect, it } from "vitest";
import { DEV_FIXTURE_RULES, createBattle, exampleContentMaps, type BattleSetup, type PublicBattleState } from "@pmrpg/shared";
import { fleePreview, refusalTh, reviveRefusal, skillButtonLine } from "../src/command-ui";

const content = exampleContentMaps();
const R = DEV_FIXTURE_RULES;
function state(): PublicBattleState {
  const setup: BattleSetup = {
    battleId: "battle:ui",
    originMode: "manual",
    seed: "ui",
    player: { accountId: "a", name: "n", level: 10, element: "FIRE", primaryStats: { STR: 30, VIT: 25, INT: 10, DEX: 15, AGI: 40, SPI: 10 }, gear: {}, skillIds: [], basicAttackRange: "melee", row: "front", slot: 1 },
    companions: [],
    enemies: [{ unitId: "w", speciesId: "species:ember_fox", element: "FIRE", row: "front", slot: 0 }],
    bag: {},
  };
  const r = createBattle(R, content, setup);
  if (!r.ok) throw new Error(r.message);
  return structuredClone(r.state) as PublicBattleState;
}

describe("flee / revive / cooldown text (O15)", () => {
  it("flee shows the chance with two decimals and where it comes from", () => {
    const pv = fleePreview(R, state(), content.species, "player", (id) => id);
    expect(pv.ok).toBe(true);
    expect(pv.lines[0]).toMatch(/^โอกาสหนี \d+\.\d\d%/);
    expect(pv.lines[1]).toContain("SPD เรา");
    expect(pv.lines.join("\n")).toContain("เสียตานี้");
  });

  it("revive says when a fallen ally can come back", () => {
    const s = state();
    const p = s.units.find((u) => u.unitId === "player")!;
    expect(reviveRefusal(R, s, "player", "player")).toContain("เฉพาะพวกเราที่ล้ม");
    p.ko = true;
    p.downRound = s.round;
    expect(reviveRefusal(R, s, "player", "player")).toContain(`รอบ ${s.round + 1}`);
  });

  it("skill buttons show how often and how long until ready", () => {
    const sk = content.skills.get("skill:player_power_strike")!;
    expect(skillButtonLine(sk, 0)).toBe(`${sk.mpCost} MP · ทุก ${sk.cooldown} ตา`);
    expect(skillButtonLine(sk, 2)).toBe(`${sk.mpCost} MP · รออีก 2 ตา`);
    expect(refusalTh("FLEE_FORBIDDEN", "x")).toBe("ไฟต์นี้หนีไม่ได้");
  });
});
