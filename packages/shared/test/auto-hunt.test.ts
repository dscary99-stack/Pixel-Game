import { describe, expect, it } from "vitest";
import {
  AutoHuntSettingsSchema,
  autoHuntReadiness,
  MapChannel,
  PRODUCTION_RULES as R,
  WorldClientMessageSchema,
  exampleMapRegistry,
  inEngageRange,
  mapHasTargets,
  packAllowed,
  planAutoHunt,
  portalAt,
  stopSpeciesPack,
  tryStep,
  type TilePos,
  type VisiblePack,
} from "../src";

const field = exampleMapRegistry().get("map:dawn_field")!;
const defaults = AutoHuntSettingsSchema.parse({});
const pack = (packId: string, x: number, y: number, speciesId: string, over: Partial<VisiblePack> = {}): VisiblePack => ({
  packId,
  spawnId: packId,
  x,
  y,
  rank: "NORMAL",
  sizeRange: [1, 1],
  leader: { speciesId, element: "EARTH", level: 2 },
  ...over,
});
const walk = (from: TilePos, dirs: readonly string[]) => {
  let at = { ...from };
  let ready = 0;
  for (const d of dirs) {
    const r = tryStep(R, field, at, d as never, ready, ready);
    if (!r.ok) throw new Error(`step ${d} from ${at.x},${at.y}: ${r.reason}`);
    at = r.pos;
    ready = r.readyAt;
    expect(portalAt(field, at.x, at.y)).toBeNull();
  }
  return at;
};

describe("Auto Hunt settings (chapter 08, PROVISIONAL)", () => {
  it("defaults: any species, any size, no Elite, stop below 30% HP", () => {
    expect(defaults).toEqual({
      targetSpecies: [],
      maxPackSize: 10,
      allowElite: false,
      stopOnSpecies: [],
      stopBelowHpPercent: 30,
      stopBelowMpPercent: 0,
      stopBelowCompanionHpPercent: 0,
      itemRules: [],
      stopWhenItemsOut: false,
    });
    expect(AutoHuntSettingsSchema.parse({ itemRules: [{ itemId: "item:small_potion" }] }).itemRules).toEqual([
      { itemId: "item:small_potion", target: "ally", hpBelowPercent: 40, maxPerFight: 3 },
    ]);
    expect(AutoHuntSettingsSchema.safeParse({ itemRules: [{ itemId: "item:small_potion", maxPerFight: 0 }] }).success).toBe(false);
    expect(AutoHuntSettingsSchema.safeParse({ maxPackSize: 11 }).success).toBe(false);
    expect(AutoHuntSettingsSchema.safeParse({ targetSpecies: ["mole"] }).success).toBe(false);
    expect(AutoHuntSettingsSchema.safeParse({ autoCapture: true }).success).toBe(false);
    expect(WorldClientMessageSchema.safeParse({ t: "autoHunt", settings: {} }).success).toBe(true);
  });

  it("filters packs by what the player can see: leader, rank and size range", () => {
    expect(packAllowed(defaults, pack("a", 1, 1, "species:supply_mole"))).toBe(true);
    expect(packAllowed(defaults, pack("a", 1, 1, "species:supply_mole", { rank: "ELITE" }))).toBe(false);
    expect(packAllowed({ ...defaults, allowElite: true }, pack("a", 1, 1, "species:supply_mole", { rank: "ELITE" }))).toBe(true);
    expect(packAllowed({ ...defaults, maxPackSize: 1 }, pack("a", 1, 1, "species:armor_crab", { sizeRange: [1, 2] }))).toBe(false);
    expect(packAllowed({ ...defaults, targetSpecies: ["species:bell_bird"] }, pack("a", 1, 1, "species:supply_mole"))).toBe(false);
  });

  it("knows when no spawn on the map can ever match", () => {
    expect(mapHasTargets(defaults, field)).toBe(true);
    expect(mapHasTargets({ ...defaults, targetSpecies: ["species:ember_fox"], maxPackSize: 1 }, field)).toBe(false);
    expect(mapHasTargets({ ...defaults, targetSpecies: ["species:lantern_snail"], maxPackSize: 1 }, field)).toBe(true);
    expect(mapHasTargets(defaults, exampleMapRegistry().get("map:dawn_town")!)).toBe(false);
  });

  it("reports a stop-list species in sight", () => {
    const packs = [pack("a", 6, 5, "species:supply_mole"), pack("b", 6, 11, "species:bell_bird")];
    expect(stopSpeciesPack({ ...defaults, stopOnSpecies: ["species:bell_bird"] }, packs)?.packId).toBe("b");
    expect(stopSpeciesPack(defaults, packs)).toBeNull();
  });
});

describe("planAutoHunt", () => {
  const start = { x: 3, y: 8 };
  const packs = [pack("moles", 6, 5, "species:supply_mole"), pack("birds", 6, 11, "species:bell_bird"), pack("foxes", 19, 9, "species:ember_fox")];

  it("walks to the nearest allowed pack by walking distance, never over a portal, and ends next to it", () => {
    const plan = planAutoHunt(R, field, { x: 1, y: 7 }, packs, defaults);
    if (plan.kind !== "walk") throw new Error(plan.kind);
    const end = walk({ x: 1, y: 7 }, plan.path);
    const target = packs.find((p) => p.packId === plan.packId)!;
    expect(inEngageRange(R, end, target)).toBe(true);
    expect(["moles", "birds"]).toContain(plan.packId);
  });

  it("engages when already next to an allowed pack, and follows the species filter", () => {
    expect(planAutoHunt(R, field, { x: 6, y: 6 }, packs, defaults)).toEqual({ kind: "engage", packId: "moles" });
    const plan = planAutoHunt(R, field, start, packs, { ...defaults, targetSpecies: ["species:ember_fox"] });
    expect(plan).toMatchObject({ kind: "walk", packId: "foxes" });
  });

  it("waits when nothing allowed is in sight (respawn comes next cycle)", () => {
    expect(planAutoHunt(R, field, start, [], defaults)).toEqual({ kind: "wait" });
    expect(planAutoHunt(R, field, start, packs, { ...defaults, targetSpecies: ["species:lantern_snail"] })).toEqual({ kind: "wait" });
  });

  it("says unreachable when every allowed pack is walled off", () => {
    const walled = pack("walled", 0, 0, "species:supply_mole");
    // (0,0) is a wall corner: no walkable tile next to it except through walls.
    expect(planAutoHunt(R, field, start, [{ ...walled, x: -5, y: -5 }], defaults)).toEqual({ kind: "unreachable" });
  });
});

describe("server steps (MapChannel.autoStep)", () => {
  it("use the same speed and tile rules as client steps, and tell the player with autoMoved", () => {
    const ch = new MapChannel(R, field, 1, [], () => "sid1");
    ch.join("acct:a", "A", { x: 3, y: 8 }, 0);
    const first = ch.autoStep("acct:a", "E", 0);
    expect(first.kind).toBe("moved");
    expect(first.out[0]!.msg).toEqual({ t: "autoMoved", x: 4, y: 8, facing: "E" });
    // Steps at the same instant pass only within the burst allowance, then are refused.
    expect(ch.autoStep("acct:a", "E", 0).kind).toBe("moved");
    expect(ch.autoStep("acct:a", "E", 0).kind).toBe("moved");
    expect(ch.autoStep("acct:a", "E", 0).kind).toBe("rejected");
    // Into a wall: refused.
    ch.join("acct:b", "B", { x: 1, y: 1 }, 0);
    expect(ch.autoStep("acct:b", "N", 10_000).kind).toBe("rejected");
    // Not while in a fight.
    ch.setBattle("acct:b", "battle:x");
    expect(ch.autoStep("acct:b", "S", 20_000).kind).toBe("rejected");
  });
});

describe("autoHuntReadiness (between fights)", () => {
  const full = { hp: 100, maxHp: 100, mp: 50, maxMp: 50 };
  it("follows each stop setting, and 0 means never", () => {
    expect(autoHuntReadiness(defaults, full, [], {})).toBeNull();
    expect(autoHuntReadiness(defaults, { ...full, hp: 29 }, [], {})).toEqual({ stop: "LOW_HP", detail: "29/100" });
    expect(autoHuntReadiness({ ...defaults, stopBelowHpPercent: 0 }, { ...full, hp: 1 }, [], {})).toBeNull();
    expect(autoHuntReadiness({ ...defaults, stopBelowMpPercent: 50 }, { ...full, mp: 24 }, [], {})?.stop).toBe("LOW_MP");
    const s = { ...defaults, stopBelowCompanionHpPercent: 50 };
    expect(autoHuntReadiness(s, full, [{ ...full, hp: 60 }, { ...full, hp: 40 }], {})).toEqual({ stop: "COMPANION_LOW_HP", detail: "40/100" });
    expect(autoHuntReadiness({ ...defaults, stopBelowHpPercent: 0 }, { ...full, hp: 0 }, [{ ...full, hp: 0 }], {})?.stop).toBe("NEED_REST");
  });
  it("stops when every allowed item has run out, only if asked", () => {
    const rules = [{ itemId: "item:small_potion", target: "ally" as const, hpBelowPercent: 40, maxPerFight: 3 }];
    expect(autoHuntReadiness({ ...defaults, itemRules: rules }, full, [], {})).toBeNull();
    expect(autoHuntReadiness({ ...defaults, itemRules: rules, stopWhenItemsOut: true }, full, [], {})?.stop).toBe("ITEMS_OUT");
    expect(autoHuntReadiness({ ...defaults, itemRules: rules, stopWhenItemsOut: true }, full, [], { "item:small_potion": 1 })).toBeNull();
  });
});
