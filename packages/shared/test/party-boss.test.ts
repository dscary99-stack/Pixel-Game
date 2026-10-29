/**
 * Party boss fights (Nut 2026-10-07): up to 5 players, 1 companion each = 10 ally places, one shared
 * fight. Each member commands only their own units, uses their own bag, and gets their own rewards.
 */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_BOSSES,
  applyCommand,
  chooseAutoCommand,
  combatBagOf,
  controllerOf,
  createBattle,
  currentActor,
  secretFightFacts,
  type BattleCommand,
  type BattleSetup,
  type BattleState,
  type KernelResult,
  type PartyMemberSetup,
} from "../src/index";
import { baseSetup, companion, content, rules as baseRules, withCaptureProfile } from "./fixtures";

const rules = structuredClone(baseRules);
(rules.provisional.hitChanceClampPct as { value: readonly [number, number] }).value = [100, 100];
const LORD = EXAMPLE_BOSSES[0]!;
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const c = content();
c.bosses.set(LORD.id, LORD);
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;
const run = (s: BattleState, cmd: BattleCommand) => applyCommand(rules, c, s, cmd, { source: "player" });

const pet = (owner: string, id: string, speciesId: string) => ({ ...companion(id, speciesId, speciesId === "species:armor_crab" ? "EARTH" : "WATER"), ownerId: owner });
function member(n: number, over: Partial<PartyMemberSetup["player"]> = {}): PartyMemberSetup {
  const acct = `acct:${n}`;
  const base = baseSetup().player;
  return {
    player: { ...base, accountId: acct, name: `P${n}`, level: 200, gear: { PDEF: 600, MDEF: 600, HP: 80_000, PATK: 10 }, row: "front", slot: n - 1, ...over },
    companions: [{ instance: pet(acct, `m${n}`, "species:lantern_snail"), row: "back", slot: n - 1 }],
    bag: { "item:small_potion": n },
  };
}
function party(size: number, over: (s: BattleSetup) => void = () => {}) {
  const setup = baseSetup({ enemies: [], boss: { bossId: LORD.id } });
  const lead = member(1);
  setup.player = lead.player;
  setup.companions = lead.companions;
  setup.bag = { "item:small_potion": 1, "item:crystal_crab_lord_capture": 1 };
  setup.partyMembers = Array.from({ length: size - 1 }, (_, i) => member(i + 2));
  over(setup);
  return setup;
}
/** Everyone guards until `who` is up. */
const until = (s: BattleState, who: string) => {
  for (let i = 0; i < 200 && s.status === "active" && currentActor(s)?.unitId !== who; i++) s = ok(run(s, { type: "guard", actorId: currentActor(s)!.unitId })).state;
  return s;
};

describe("party boss fight setup", () => {
  it("5 players with 1 companion each fill 10 ally places, players in front, companions behind", () => {
    const s = ok(createBattle(rules, c, party(5))).state;
    const allies = s.units.filter((u) => u.side === "ally");
    expect(allies).toHaveLength(10);
    expect(allies.filter((u) => u.kind === "player").map((u) => [u.unitId, u.row, u.slot])).toEqual([
      ["player", "front", 0],
      ["player:2", "front", 1],
      ["player:3", "front", 2],
      ["player:4", "front", 3],
      ["player:5", "front", 4],
    ]);
    expect(allies.every((u) => u.controllerId !== undefined)).toBe(true);
    expect(unit(s, "ally:m3").controllerId).toBe("acct:3");
    expect(s.members?.map((m) => [m.accountId, m.playerUnitId, m.bag["item:small_potion"]])).toEqual([
      ["acct:2", "player:2", 2],
      ["acct:3", "player:3", 3],
      ["acct:4", "player:4", 4],
      ["acct:5", "player:5", 5],
    ]);
  });

  it("refuses a 6th player, a 2nd companion, the same player twice, a non-boss fight, and someone else's companion", () => {
    expect(createBattle(rules, c, party(5, (s) => s.partyMembers!.push(member(6, { row: "back", slot: 4 }))))).toMatchObject({ ok: false });
    expect(createBattle(rules, c, party(2, (s) => s.partyMembers![0]!.companions.push({ instance: pet("acct:2", "m2b", "species:armor_crab"), row: "back", slot: 4 })))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(createBattle(rules, c, party(2, (s) => (s.partyMembers![0]!.player.accountId = "acct:1")))).toMatchObject({ ok: false });
    expect(createBattle(rules, c, party(2, (s) => ((s.boss = undefined), (s.enemies = baseSetup().enemies))))).toMatchObject({ ok: false, code: "INVALID_COMMAND" });
    expect(createBattle(rules, c, party(2, (s) => (s.partyMembers![0]!.companions[0]!.instance.ownerId = "acct:1")))).toMatchObject({ ok: false, code: "NOT_OWNER" });
  });

  it("two members may bring the same species (C04 is per player's own team)", () => {
    expect(createBattle(rules, c, party(3)).ok).toBe(true);
  });
});

describe("party boss fight play", () => {
  it("a member's items come from their own bag; Auto uses that bag too", () => {
    let s = until(ok(createBattle(rules, c, party(3))).state, "player:3");
    expect(controllerOf(s, unit(s, "player:3"))).toBe("acct:3");
    s = ok(run(s, { type: "item", actorId: "player:3", itemId: "item:small_potion", targetId: "player:3" })).state;
    expect(s.members!.find((m) => m.accountId === "acct:3")!.bag["item:small_potion"]).toBe(2);
    expect(s.bag["item:small_potion"]).toBe(1);
    // acct:2 has 2 potions, acct:1 one; neither moved.
    expect(combatBagOf(s, unit(s, "player:2")).bag["item:small_potion"]).toBe(2);
    s = until(s, "player:2");
    unit(s, "player:2").hp = 10;
    const auto = chooseAutoCommand(s, c, { itemRules: [{ itemId: "item:small_potion", hpBelowPercent: 50, maxPerFight: 1, target: "self" }] });
    expect(auto).toMatchObject({ type: "item", actorId: "player:2" });
  });

  it("a win gives every member their own kill reward and fight result; the capture goes to whoever caught it", () => {
    let s = ok(createBattle(rules, c, party(2))).state;
    // Finish the adds and the boss quickly: everyone attacks with huge damage.
    for (const u of s.units) if (u.side === "ally") u.stats.patk = 999_999;
    for (let i = 0; i < 300 && s.status === "active"; i++) {
      const a = currentActor(s)!;
      const t = s.units.find((u) => u.side === "enemy" && !u.ko && !u.retired)!;
      s = ok(run(s, { type: "attack", actorId: a.unitId, targetId: t.unitId })).state;
    }
    expect(s.status).toBe("victory");
    const byRecipient = (who: string | undefined) => s.entitlements.filter((e) => e.recipientId === who);
    const kills1 = byRecipient(undefined).filter((e) => e.kind === "kill");
    const kills2 = byRecipient("acct:2").filter((e) => e.kind === "kill");
    expect(kills1.length).toBeGreaterThan(0);
    expect(kills2.map((e) => e.entitlementId)).toEqual(kills1.map((e) => e.entitlementId));
    expect(Object.keys(kills1[0]!.companionExp ?? {})).toEqual(["m1"]);
    expect(Object.keys(kills2[0]!.companionExp ?? {})).toEqual(["m2"]);
    expect(byRecipient("acct:2").find((e) => e.kind === "fight_result")).toMatchObject({ companions: { m2: expect.any(Object) } });
    expect(byRecipient(undefined).find((e) => e.kind === "fight_result")).toMatchObject({ companions: { m1: expect.any(Object) } });
  });

  it("a capture goes to the member who caught it; the others get the same EXP and no monster", () => {
    const sure = withCaptureProfile(rules, { rankBounds: { NORMAL: [1, 1], ELITE: [1, 1], BOSS: [0.01, 0.3] } });
    const setup = party(2, (x) => (x.partyMembers![0]!.bag = { "item:lantern_snail_capture": 1 }));
    let s = ok(createBattle(sure, c, setup)).state;
    const add = s.units.find((u) => u.side === "enemy" && u.speciesId === "species:lantern_snail")!;
    for (let i = 0; i < 200 && s.status === "active" && currentActor(s)?.unitId !== "player:2"; i++) s = ok(applyCommand(sure, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
    unit(s, add.unitId).hp = 1;
    const r = ok(applyCommand(sure, c, s, { type: "capture", actorId: "player:2", targetId: add.unitId, itemId: "item:lantern_snail_capture" }, { source: "player" }));
    const got = r.state.entitlements.filter((e) => e.entitlementId.endsWith(`${add.unitId}:captured`));
    expect(got.map((e) => [e.kind, e.recipientId])).toEqual([
      ["kill", undefined],
      ["capture", "acct:2"],
    ]);
    expect(got[0]!.exp).toBe(got[1]!.exp);
    expect(r.state.members![0]!.bag["item:lantern_snail_capture"]).toBe(0);
  });

  it("BattleEnded carries each member's own bag result; secret facts are per member", () => {
    let s = until(ok(createBattle(rules, c, party(2))).state, "player:2");
    s = ok(run(s, { type: "item", actorId: "player:2", itemId: "item:small_potion", targetId: "player:2" })).state;
    for (const u of s.units) if (u.side === "ally") u.stats.patk = 999_999;
    let ended: unknown;
    for (let i = 0; i < 300 && s.status === "active"; i++) {
      const a = currentActor(s)!;
      const t = s.units.find((u) => u.side === "enemy" && !u.ko && !u.retired)!;
      const r = ok(run(s, { type: "attack", actorId: a.unitId, targetId: t.unitId }));
      ended = r.events.find((e) => e.type === "BattleEnded") ?? ended;
      s = r.state;
    }
    expect(ended).toMatchObject({ consumed: {}, members: { "acct:2": { consumed: { "item:small_potion": 1 }, unusedReserved: { "item:small_potion": 1 } } } });
    expect(secretFightFacts(s, () => false, "acct:2")).toMatchObject({ itemsUsed: 1, companions: [expect.any(Object)] });
    expect(secretFightFacts(s, () => false)).toMatchObject({ itemsUsed: 0 });
  });

  it("a solo boss fight is unchanged: no controller, no members, front row still 3 cells", () => {
    const solo = baseSetup({ enemies: [], boss: { bossId: LORD.id } });
    const s = ok(createBattle(rules, c, solo)).state;
    expect(s.members).toBeUndefined();
    expect(s.units.some((u) => u.controllerId !== undefined)).toBe(false);
    solo.player.slot = 4;
    expect(createBattle(rules, c, solo)).toMatchObject({ ok: false, code: "FORMATION_INVALID" });
  });
});
