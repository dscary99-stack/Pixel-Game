import { describe, expect, it } from "vitest";
import {
  EXAMPLE_SPECIES,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  publicView,
  validTargets,
  withFixtureOverrides,
  type BattleContent,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type KernelResult,
  type RulesConfig,
} from "../src/index";
import { baseSetup, companion, content, fixtureRules, rules, speciesAtLevel } from "./fixtures";

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};

/** Plays until the player character's turn (companions basic-attack meanwhile). */
function untilPlayerTurn(r: RulesConfig, c: BattleContent, s: BattleState): BattleState {
  for (let i = 0; i < 50 && s.status === "active" && currentActor(s)?.kind !== "player"; i++) {
    s = ok(applyCommand(r, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
  }
  return s;
}

/** Runs Auto Battle to the end; returns all events. */
function autoToEnd(r: RulesConfig, c: BattleContent, start: BattleState): { state: BattleState; events: BattleEvent[] } {
  let s = start;
  const events: BattleEvent[] = [];
  for (let i = 0; i < 2000 && s.status === "active"; i++) {
    const res = ok(applyCommand(r, c, s, chooseAutoCommand(s)!, { source: "auto" }));
    s = res.state;
    events.push(...res.events);
  }
  return { state: s, events };
}

describe("battle setup", () => {
  const c = content();
  it("starts a 1 + 1 vs 2 fight and stops at the first ally turn", () => {
    const r = ok(createBattle(rules, c, baseSetup({ companions: [{ instance: companion("m1", "species:lantern_snail", "WATER"), row: "back", slot: 0 }] })));
    expect(r.state.units).toHaveLength(4);
    expect(r.events[0]?.type).toBe("BattleStarted");
    expect(currentActor(r.state)?.side).toBe("ally");
  });

  it("rejects 6 companions and duplicate species with different elements (C04)", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ instance: companion(`m${i}`, `species:x${i}`, "FIRE"), row: "back" as const, slot: i % 3 }));
    expect(createBattle(rules, c, baseSetup({ companions: six }))).toMatchObject({ ok: false, code: "TEAM_TOO_LARGE" });
    const dup = [
      { instance: companion("m1", "species:ember_fox", "FIRE"), row: "back" as const, slot: 0 },
      { instance: companion("m2", "species:ember_fox", "WIND"), row: "back" as const, slot: 1 },
    ];
    expect(createBattle(rules, c, baseSetup({ companions: dup }))).toMatchObject({ ok: false, code: "DUPLICATE_SPECIES" });
  });

  it("rejects 11 enemy units (C05) and accepts 10", () => {
    const enemies = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ unitId: `e${i}`, speciesId: "species:armor_crab", element: "EARTH" as const, row: i < 5 ? ("front" as const) : ("back" as const), slot: i % 5 }));
    expect(createBattle(rules, c, baseSetup({ enemies: enemies(11) }))).toMatchObject({ ok: false, code: "TOO_MANY_ENEMIES" });
    expect(createBattle(rules, c, baseSetup({ enemies: enemies(10) })).ok).toBe(true);
  });

  it("rejects companions the player does not own", () => {
    const m = { ...companion("m1", "species:ember_fox", "FIRE"), ownerId: "acct:other" };
    expect(createBattle(rules, c, baseSetup({ companions: [{ instance: m, row: "back", slot: 0 }] }))).toMatchObject({ ok: false, code: "NOT_OWNER" });
  });

  it("enforces combat bag caps: max 8 types, heal stacks 10", () => {
    expect(createBattle(rules, c, baseSetup({ bag: { "item:small_potion": 11 } }))).toMatchObject({ ok: false, code: "BAG_INVALID" });
  });

  it("uses the species' fixed wild level for every enemy (C29)", () => {
    const r = ok(createBattle(rules, c, baseSetup()));
    const fox = r.state.units.find((u) => u.unitId === "e2")!;
    expect(fox.level).toBe(EXAMPLE_SPECIES.find((s) => s.id === "species:ember_fox")!.fixedWildLevel);
  });

  it("never exposes the RNG state in the public view", () => {
    const r = ok(createBattle(rules, c, baseSetup()));
    expect("rng" in publicView(r.state)).toBe(false);
  });
});

describe("turn order and determinism", () => {
  const c = content();
  const setup = baseSetup({
    companions: [
      { instance: companion("m1", "species:lantern_snail", "WATER"), row: "back", slot: 0 },
      { instance: companion("m2", "species:ember_fox", "FIRE"), row: "front", slot: 0 },
    ],
  });

  it("orders each round by SPD, highest first", () => {
    const r = ok(createBattle(rules, c, setup));
    const started = r.events.find((e) => e.type === "RoundStarted")!;
    if (started.type !== "RoundStarted") throw new Error();
    const spds = started.order.map((id) => r.state.units.find((u) => u.unitId === id)!.stats.spd);
    expect([...spds].sort((a, b) => b - a)).toEqual(spds);
  });

  it("replays identically from the same seed and commands", () => {
    const a = autoToEnd(rules, c, ok(createBattle(rules, c, setup)).state);
    const b = autoToEnd(rules, c, ok(createBattle(rules, c, setup)).state);
    expect(a.events).toEqual(b.events);
    expect(a.state).toEqual(b.state);
  });

  it("breaks SPD ties with the server seed, deterministically", () => {
    const tie = baseSetup({
      enemies: [
        { unitId: "e1", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0 },
        { unitId: "e2", speciesId: "species:armor_crab", element: "WATER", row: "front", slot: 1 },
      ],
    });
    const orders = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const r1 = ok(createBattle(rules, c, { ...tie, seed }));
      const r2 = ok(createBattle(rules, c, { ...tie, seed }));
      expect(r1.state.turnOrder).toEqual(r2.state.turnOrder);
      orders.add(r1.state.turnOrder.filter((id) => id.startsWith("e")).join(","));
    }
    expect(orders.size).toBe(2);
  });

  it("does not mutate the input state", () => {
    const s = ok(createBattle(rules, c, setup)).state;
    const snapshot = structuredClone(s);
    applyCommand(rules, c, s, chooseAutoCommand(s)!, { source: "player" });
    expect(s).toEqual(snapshot);
  });

  it("rejects commands for a unit whose turn it is not", () => {
    const s = ok(createBattle(rules, c, setup)).state;
    const other = s.units.find((u) => u.side === "ally" && u.unitId !== currentActor(s)!.unitId)!;
    expect(applyCommand(rules, c, s, { type: "guard", actorId: other.unitId }, { source: "player" })).toMatchObject({ ok: false, code: "NOT_YOUR_TURN" });
  });
});

describe("actions", () => {
  const c = content();

  it("melee must hit a living front-row enemy first", () => {
    const setup = baseSetup({
      enemies: [
        { unitId: "front", speciesId: "species:armor_crab", element: "EARTH", row: "front", slot: 0 },
        { unitId: "back", speciesId: "species:lantern_snail", element: "WATER", row: "back", slot: 0 },
      ],
    });
    const s = untilPlayerTurn(rules, c, ok(createBattle(rules, c, setup)).state);
    expect(validTargets(s, "enemy", "melee").map((u) => u.unitId)).toEqual(["front"]);
    expect(validTargets(s, "enemy", "ranged").map((u) => u.unitId).sort()).toEqual(["back", "front"]);
    expect(applyCommand(rules, c, s, { type: "attack", actorId: "player", targetId: "back" }, { source: "player" })).toMatchObject({ ok: false, code: "INVALID_TARGET" });
  });

  it("guard multiplies incoming damage by 0.6 until the guard's next turn", () => {
    const s = untilPlayerTurn(rules, c, ok(createBattle(rules, c, baseSetup())).state);
    const r = ok(applyCommand(rules, c, s, { type: "guard", actorId: "player" }, { source: "player" }));
    const hits = r.events.filter((e) => e.type === "ActionResolved" && e.targetId === "player" && e.hit);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) if (h.type === "ActionResolved") expect(h.breakdown?.guardMultiplier).toBe(0.6);
    expect(r.events.some((e) => e.type === "TurnStarted" && e.unitId === "player" && e.guardEnded)).toBe(r.state.status === "active");
  });

  it("uses a heal item exactly once and discards overheal", () => {
    let s = untilPlayerTurn(rules, c, ok(createBattle(rules, c, baseSetup())).state);
    const before = s.units.find((u) => u.unitId === "player")!;
    const r = ok(applyCommand(rules, c, s, { type: "item", actorId: "player", itemId: "item:small_potion", targetId: "player" }, { source: "player" }));
    s = r.state;
    expect(s.bag["item:small_potion"]).toBe(2);
    expect(s.consumed["item:small_potion"]).toBe(1);
    const heal = r.events.find((e) => e.type === "ActionResolved" && e.action === "item");
    if (heal?.type !== "ActionResolved") throw new Error();
    expect(heal.heal).toBe(Math.min(150, before.stats.maxHp - before.hp));
  });

  it("rejects a skill with a cooldown while O15 is open, and runs it with a fixture override", () => {
    const fox = { instance: companion("m1", "species:ember_fox", "FIRE"), row: "front" as const, slot: 0 };
    const setup = baseSetup({ companions: [fox] });
    const findFoxTurn = (r: RulesConfig) => {
      let s = ok(createBattle(r, c, setup)).state;
      for (let i = 0; i < 20 && currentActor(s)?.unitId !== "ally:m1"; i++) s = ok(applyCommand(r, c, s, chooseAutoCommand(s)!, { source: "player" })).state;
      return s;
    };
    const cmd = { type: "skill" as const, actorId: "ally:m1", skillId: "skill:fox_consume_mark", targetId: "e1" };
    const s0 = findFoxTurn(rules);
    expect(applyCommand(rules, c, s0, cmd, { source: "player" })).toMatchObject({ ok: false, code: "UNRESOLVED_RULE" });
    const s1 = findFoxTurn(fixtureRules);
    const r = ok(applyCommand(fixtureRules, c, s1, cmd, { source: "player" }));
    const fox1 = r.state.units.find((u) => u.unitId === "ally:m1")!;
    expect(fox1.mp).toBe(s1.units.find((u) => u.unitId === "ally:m1")!.mp - 10);
  });

  it("flee and revive stay UNRESOLVED_RULE until O15 is decided", () => {
    const s = untilPlayerTurn(rules, c, ok(createBattle(rules, c, baseSetup({ bag: { "item:phoenix_feather": 1 } }))).state);
    expect(applyCommand(rules, c, s, { type: "flee", actorId: "player" }, { source: "player" })).toMatchObject({ ok: false, code: "UNRESOLVED_RULE" });
    expect(applyCommand(rules, c, s, { type: "item", actorId: "player", itemId: "item:phoenix_feather", targetId: "player" }, { source: "player" })).toMatchObject({
      ok: false,
      code: "UNRESOLVED_RULE",
    });
  });

  it("lets a unit be moved at most once per round", () => {
    const setup = baseSetup({ companions: [{ instance: companion("m1", "species:lantern_snail", "WATER"), row: "back", slot: 1 }] });
    let s = ok(createBattle(rules, c, setup)).state;
    s = untilPlayerTurn(rules, c, s);
    const r = ok(applyCommand(rules, c, s, { type: "move", actorId: "player", row: "back", slot: 1 }, { source: "player" }));
    const p = r.state.units.find((u) => u.unitId === "player")!;
    const snail = r.state.units.find((u) => u.unitId === "ally:m1")!;
    expect(r.state.round > s.round || snail.movedThisRound).toBe(true);
    if (r.state.round === s.round && currentActor(r.state)?.unitId === "ally:m1") {
      expect(applyCommand(rules, c, r.state, { type: "move", actorId: "ally:m1", row: "front", slot: 0 }, { source: "player" })).toMatchObject({ ok: false });
    }
    expect([p.row, p.slot, snail.row, snail.slot]).toEqual(["back", 1, "front", 1]);
  });
});

describe("capture (C08, C09, C15)", () => {
  const crab = EXAMPLE_SPECIES[0]!;
  const lv25 = speciesAtLevel(crab, "species:crab_lv25", 25);
  const lv26 = speciesAtLevel(crab, "species:crab_lv26", 26);
  const boss = speciesAtLevel(crab, "species:crab_boss", 10, "BOSS");
  const c = content([lv25, lv26, boss]);
  // Capture items are species-specific; reuse the crab item by pointing the test species at it.
  for (const s of [lv25, lv26, boss]) {
    c.items.set(`item:${s.id.slice(8)}_capture`, { ...c.items.get("item:armor_crab_capture")!, id: `item:${s.id.slice(8)}_capture` as never, captureSpeciesId: s.id });
  }
  const setupWith = (speciesId: string, over: Partial<BattleSetup> = {}) =>
    baseSetup({
      enemies: [{ unitId: "w", speciesId, element: "EARTH", row: "front", slot: 0 }],
      bag: { [`item:${speciesId.slice(8)}_capture`]: 3 },
      ...over,
    });
  const capture = (r: RulesConfig, s: BattleState, speciesId: string, source: "player" | "auto" = "player") =>
    applyCommand(r, c, s, { type: "capture", actorId: "player", targetId: "w", itemId: `item:${speciesId.slice(8)}_capture` }, { source });

  it("player Lv20 can try wild Lv25 but not Lv26, and the item is not used on rejection", () => {
    const s26 = untilPlayerTurn(fixtureRules, c, ok(createBattle(fixtureRules, c, setupWith(lv26.id))).state);
    expect(capture(fixtureRules, s26, lv26.id)).toMatchObject({ ok: false, code: "LEVEL_INELIGIBLE" });
    expect(s26.bag[`item:crab_lv26_capture`]).toBe(3);
    const s25 = untilPlayerTurn(fixtureRules, c, ok(createBattle(fixtureRules, c, setupWith(lv25.id))).state);
    expect(capture(fixtureRules, s25, lv25.id).ok).toBe(true);
  });

  it("refuses any capture from Auto (C15)", () => {
    const s = untilPlayerTurn(fixtureRules, c, ok(createBattle(fixtureRules, c, setupWith(lv25.id))).state);
    expect(capture(fixtureRules, s, lv25.id, "auto")).toMatchObject({ ok: false, code: "AUTO_CAPTURE_FORBIDDEN" });
  });

  it("is UNRESOLVED_RULE without the O07 rate table, before consuming the item", () => {
    const s = untilPlayerTurn(rules, c, ok(createBattle(rules, c, setupWith(lv25.id))).state);
    expect(capture(rules, s, lv25.id)).toMatchObject({ ok: false, code: "UNRESOLVED_RULE" });
  });

  it("needs an open capture window on bosses", () => {
    const s = untilPlayerTurn(fixtureRules, c, ok(createBattle(fixtureRules, c, setupWith(boss.id))).state);
    expect(capture(fixtureRules, s, boss.id)).toMatchObject({ ok: false, code: "NO_VALID_CAPTURE_WINDOW" });
    const open = setupWith(boss.id);
    open.enemies[0]!.captureWindowOpen = true;
    const s2 = untilPlayerTurn(fixtureRules, c, ok(createBattle(fixtureRules, c, open)).state);
    expect(capture(fixtureRules, s2, boss.id).ok).toBe(true);
  });

  it("success gives a Lv1 companion entitlement and no kill loot; failure uses the item once", () => {
    const always = withFixtureOverrides(fixtureRules, {
      captureRates: { rankBounds: { NORMAL: [1, 1], ELITE: [1, 1], BOSS: [1, 1] }, hpFactor: [{ maxHpRatio: 1, factor: 1 }] },
    });
    const never = withFixtureOverrides(fixtureRules, {
      captureRates: { rankBounds: { NORMAL: [0, 0], ELITE: [0, 0], BOSS: [0, 0] }, hpFactor: [{ maxHpRatio: 1, factor: 1 }] },
    });
    const sOk = untilPlayerTurn(always, c, ok(createBattle(always, c, setupWith(lv25.id))).state);
    const win = ok(capture(always, sOk, lv25.id));
    expect(win.state.status).toBe("victory");
    // A capture gives the kill EXP of the target: the reference EXP at wild Lv25 (20 + 6·25 + 2·25²).
    expect(win.state.entitlements).toEqual([
      { entitlementId: "battle:test:w:captured", kind: "capture", enemyUnitId: "w", speciesId: lv25.id, element: "EARTH", level: 1, exp: 1420 },
    ]);
    expect(win.events.some((e) => e.type === "EnemyDefeated")).toBe(false);

    const sNo = untilPlayerTurn(never, c, ok(createBattle(never, c, setupWith(lv25.id))).state);
    const miss = ok(capture(never, sNo, lv25.id));
    expect(miss.state.bag[`item:crab_lv25_capture`]).toBe(2);
    expect(miss.events.filter((e) => e.type === "ItemConsumed")).toHaveLength(1);
    expect(miss.state.entitlements).toEqual([]);
  });
});

describe("rewards and Auto Battle", () => {
  const c = content();
  const team = [
    { instance: companion("m1", "species:lantern_snail", "WATER", 30), row: "back" as const, slot: 0 },
    { instance: companion("m2", "species:ember_fox", "FIRE", 30), row: "front" as const, slot: 0 },
    { instance: companion("m3", "species:armor_crab", "EARTH", 30), row: "front" as const, slot: 2 },
  ];

  it("creates exactly one kill entitlement per defeated enemy, keyed battle:enemy:resolution", () => {
    const { state, events } = autoToEnd(rules, c, ok(createBattle(rules, c, baseSetup({ companions: team }))).state);
    expect(state.status).toBe("victory");
    const ids = state.entitlements.map((e) => e.entitlementId);
    expect(ids.sort()).toEqual(["battle:test:e1:defeated", "battle:test:e2:defeated"]);
    expect(events.filter((e) => e.type === "RewardEntitled")).toHaveLength(2);
    const ended = events.at(-1)!;
    expect(ended.type).toBe("BattleEnded");
  });

  it("runs a full 1 + 5 vs 10 fight to an end under Auto without capturing", () => {
    const five = [
      ...team,
      { instance: companion("m4", "species:a", "FIRE", 30), row: "back" as const, slot: 1 },
      { instance: companion("m5", "species:b", "FIRE", 30), row: "back" as const, slot: 2 },
    ];
    const extra = ["species:a", "species:b"].map((id) => speciesAtLevel(EXAMPLE_SPECIES[1]!, id, 8));
    const cc = content(extra);
    for (const s of extra) s.allowedElements = ["FIRE"];
    const enemies = Array.from({ length: 10 }, (_, i) => ({
      unitId: `e${i}`,
      speciesId: EXAMPLE_SPECIES[i % 3]!.id,
      element: EXAMPLE_SPECIES[i % 3]!.allowedElements[0]!,
      row: i < 5 ? ("front" as const) : ("back" as const),
      slot: i % 5,
    }));
    const start = ok(createBattle(rules, cc, baseSetup({ companions: five, enemies, originMode: "auto_hunt" }))).state;
    const { state, events } = autoToEnd(rules, cc, start);
    expect(state.status).not.toBe("active");
    expect(events.some((e) => e.type === "CaptureResolved")).toBe(false);
    for (const e of state.entitlements) if (e.kind === "kill") expect(e.originMode).toBe("auto_hunt");
    expect(new Set(state.entitlements.map((e) => e.entitlementId)).size).toBe(state.entitlements.length);
  });

  it("rejects commands after the battle is over", () => {
    const { state } = autoToEnd(rules, c, ok(createBattle(rules, c, baseSetup({ companions: team }))).state);
    expect(applyCommand(rules, c, state, { type: "guard", actorId: "player" }, { source: "player" })).toMatchObject({ ok: false, code: "BATTLE_OVER" });
  });
});
