/**
 * Fight items beyond heal potions (Auto Hunt, chapter 08 allowed items): mana potions restore MP,
 * support items put helpful statuses on an ally (a buff, a cleanse), and Auto uses each kind on its own
 * trigger: heal below the HP %, mana below the MP %, revive a fallen ally once it may be revived, support
 * only when it would still do something.
 */
import { describe, expect, it } from "vitest";
import { ItemDefinitionSchema, applyCommand, chooseAutoCommand, createBattle, currentActor, type BattleState, type KernelResult } from "../src/index";
import { baseSetup, companion, content, rules } from "./fixtures";

const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const c = content();
const bag = { "item:small_potion": 3, "item:mana_potion": 3, "item:power_tonic": 2, "item:cleansing_herb": 2, "item:phoenix_feather": 2 };
const snail = { instance: companion("m1", "species:lantern_snail", "WATER", 10), row: "back" as const, slot: 0 };

function playerTurn(): BattleState {
  let s = ok(createBattle(rules, c, baseSetup({ bag, companions: [snail] }))).state;
  for (let i = 0; i < 50 && currentActor(s)?.kind !== "player"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
  return structuredClone(s);
}
const unit = (s: BattleState, id: string) => s.units.find((u) => u.unitId === id)!;

describe("fight items (mana, support)", () => {
  it("a mana potion restores MP up to max and is used once", () => {
    const s = playerTurn();
    const p = unit(s, "player");
    p.mp = 1;
    const r = ok(applyCommand(rules, c, s, { type: "item", actorId: "player", itemId: "item:mana_potion", targetId: "player" }, { source: "player" }));
    expect(unit(r.state, "player").mp).toBe(Math.min(p.stats.maxMp, 41));
    expect(r.state.consumed["item:mana_potion"]).toBe(1);
    expect(r.events.some((e) => e.type === "ResourceChanged" && e.source === "restore_mp" && e.unitId === "player")).toBe(true);
  });

  it("a support item buffs an ally; a cleansing herb clears harmful statuses", () => {
    let s = playerTurn();
    s = ok(applyCommand(rules, c, s, { type: "item", actorId: "player", itemId: "item:power_tonic", targetId: "ally:m1" }, { source: "player" })).state;
    expect(unit(s, "ally:m1").statuses?.some((x) => x.statusId === "atk_up")).toBe(true);
    const t = playerTurn();
    unit(t, "player").statuses = [{ statusId: "poison", sourceId: "e1", turnsLeft: 3, stacks: 1, fresh: false }];
    const r = ok(applyCommand(rules, c, t, { type: "item", actorId: "player", itemId: "item:cleansing_herb", targetId: "player" }, { source: "player" }));
    expect(unit(r.state, "player").statuses?.some((x) => x.statusId === "poison") ?? false).toBe(false);
  });

  it("items are for living allies, and support items cannot carry harmful statuses", () => {
    const s = playerTurn();
    expect(applyCommand(rules, c, s, { type: "item", actorId: "player", itemId: "item:mana_potion", targetId: "e1" }, { source: "player" })).toMatchObject({ ok: false, code: "INVALID_TARGET" });
    const bad = { id: "item:bad_tonic", status: "draft", example: true, name: { th: "x" }, kind: "support", statuses: [{ statusId: "poison", chancePct: 50, turns: 2 }], vendorPrice: 1 };
    expect(ItemDefinitionSchema.safeParse(bad).success).toBe(false);
    expect(ItemDefinitionSchema.safeParse({ ...bad, kind: "mana", statuses: undefined }).success).toBe(false);
  });
});

describe("Auto item rules per kind", () => {
  const rule = (itemId: string, extra = {}) => ({ itemId, maxPerFight: 3, ...extra });

  it("mana below the MP %, not above it", () => {
    const s = playerTurn();
    const p = unit(s, "player");
    p.mp = p.stats.maxMp;
    expect(chooseAutoCommand(s, c, { itemRules: [rule("item:mana_potion", { mpBelowPercent: 50 })], skills: { use: false } }, rules)?.type).toBe("attack");
    p.mp = Math.floor(p.stats.maxMp / 4);
    expect(chooseAutoCommand(s, c, { itemRules: [rule("item:mana_potion", { mpBelowPercent: 50, target: "self" })], skills: { use: false } }, rules)).toMatchObject({ type: "item", itemId: "item:mana_potion", targetId: "player" });
  });

  it("support only when it would do something: a buff the ally lacks, a status to cleanse", () => {
    const s = playerTurn();
    const first = chooseAutoCommand(s, c, { itemRules: [rule("item:power_tonic")], skills: { use: false } }, rules);
    expect(first).toMatchObject({ type: "item", itemId: "item:power_tonic" });
    for (const u of s.units.filter((x) => x.side === "ally")) u.statuses = [{ statusId: "atk_up", sourceId: "player", turnsLeft: 3, stacks: 1, fresh: false }];
    expect(chooseAutoCommand(s, c, { itemRules: [rule("item:power_tonic"), rule("item:cleansing_herb")], skills: { use: false } }, rules)?.type).toBe("attack");
    unit(s, "ally:m1").statuses!.push({ statusId: "burn", sourceId: "e1", turnsLeft: 2, stacks: 1, fresh: false });
    expect(chooseAutoCommand(s, c, { itemRules: [rule("item:cleansing_herb")], skills: { use: false } }, rules)).toMatchObject({ itemId: "item:cleansing_herb", targetId: "ally:m1" });
  });

  it("revive a fallen ally only once it may be revived, and only with the rules at hand", () => {
    const s = playerTurn();
    const m = unit(s, "ally:m1");
    m.ko = true;
    m.hp = 0;
    m.downRound = s.round;
    const policy = { itemRules: [rule("item:phoenix_feather")], skills: { use: false } };
    expect(chooseAutoCommand(s, c, policy, rules)?.type).toBe("attack");
    m.downRound = s.round - rules.confirmed.reviveAfterDownRounds.value;
    expect(chooseAutoCommand(s, c, policy, rules)).toMatchObject({ type: "item", itemId: "item:phoenix_feather", targetId: "ally:m1" });
    expect(chooseAutoCommand(s, c, policy)?.type).toBe("attack");
    const r = ok(applyCommand(rules, c, s, chooseAutoCommand(s, c, policy, rules)!, { source: "auto" }));
    expect(unit(r.state, "ally:m1").ko).toBe(false);
  });
});
