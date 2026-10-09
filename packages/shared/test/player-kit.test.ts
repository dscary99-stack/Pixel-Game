import { describe, expect, it } from "vitest";
import {
  CLASS1_DEFINITIONS,
  CLASS_KITS,
  RACE_DEFINITIONS,
  RACE_PASSIVES,
  SkillDefinitionSchema,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  playerKit,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type KernelResult,
} from "../src/index";
import { baseSetup, content, rules } from "./fixtures";

const c = content();
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const triggered = (events: BattleEvent[], sourceId: string) => events.some((e) => e.type === "PassiveTriggered" && e.sourceId === sourceId);
/** Play the enemies' turns with guard until it is the player's turn again. */
function toPlayer(s: BattleState): { s: BattleState; events: BattleEvent[] } {
  const events: BattleEvent[] = [];
  for (let i = 0; i < 50 && s.status === "active" && currentActor(s)?.unitId !== "player"; i++) {
    const r = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" }));
    events.push(...r.events);
    s = r.state;
  }
  return { s, events };
}

describe("Class1 kits and race passives (chapter 02, P16)", () => {
  it("every class has a passive and four actives, every race a passive, all valid player skills", () => {
    expect(Object.keys(CLASS_KITS).sort()).toEqual(CLASS1_DEFINITIONS.map((d) => d.id).sort());
    expect(Object.keys(RACE_PASSIVES).sort()).toEqual(RACE_DEFINITIONS.map((d) => d.id).sort());
    for (const k of Object.values(CLASS_KITS)) {
      expect(k.actives).toHaveLength(4);
      const p = c.skills.get(k.passiveId)!;
      expect(p).toMatchObject({ kind: "passive", ownerKind: "player" });
      for (const a of k.actives) {
        const sk = c.skills.get(a.skillId)!;
        expect(SkillDefinitionSchema.safeParse(sk).success).toBe(true);
        expect(sk).toMatchObject({ kind: "active", ownerKind: "player" });
      }
    }
    for (const id of Object.values(RACE_PASSIVES)) expect(c.skills.get(id)?.passive).toBeDefined();
  });

  it("opens by level: two actives at Lv1, the third at 8, the fourth at 20", () => {
    expect(playerKit("class:striker", "race:human", 1)).toEqual({
      skillIds: ["skill:striker_heavy_slash", "skill:striker_cleave"],
      passiveIds: ["skill:striker_fighting_blood", "skill:race_human_grit"],
      locked: [
        { skillId: "skill:striker_armor_break", level: 8 },
        { skillId: "skill:striker_all_in", level: 20 },
      ],
    });
    expect(playerKit("class:striker", "race:human", 8).skillIds).toHaveLength(3);
    expect(playerKit("class:striker", "race:human", 20).locked).toEqual([]);
    expect(playerKit("class:nope", "race:nope", 50)).toEqual({ skillIds: [], passiveIds: [], locked: [] });
  });

  it("every class's full kit fights through Auto to the end without a refused command", () => {
    for (const cls of CLASS1_DEFINITIONS) {
      const k = playerKit(cls.id, "race:human", 20);
      const setup = baseSetup({ battleId: `battle:${cls.id}` });
      setup.player.skillIds = k.skillIds;
      setup.player.passiveIds = k.passiveIds;
      setup.player.basicAttackRange = cls.basicAttackRange;
      let s = ok(createBattle(rules, c, setup)).state;
      for (let i = 0; i < 400 && s.status === "active"; i++) {
        const actor = currentActor(s)!;
        const cmd = chooseAutoCommand(s, c, {}, rules) ?? { type: "guard" as const, actorId: actor.unitId };
        s = ok(applyCommand(rules, c, s, cmd, { source: "auto" })).state;
      }
      expect(s.status, cls.id).not.toBe("active");
    }
  });

  it("new passive events: an item use (มนุษย์), a move (ชาวเวหา), a debuff from the enemy (ชาวสนธยา)", () => {
    const start = (raceId: string, over: (s: BattleSetup) => void = () => {}) => {
      const setup = baseSetup();
      setup.player.passiveIds = [RACE_PASSIVES[raceId]!];
      over(setup);
      return toPlayer(ok(createBattle(rules, c, setup)).state).s;
    };
    const human = start("race:human");
    human.units.find((u) => u.unitId === "player")!.hp -= 50;
    const used = ok(applyCommand(rules, c, human, { type: "item", actorId: "player", itemId: "item:small_potion", targetId: "player" }, { source: "player" }));
    expect(triggered(used.events, "skill:race_human_grit")).toBe(true);
    expect(used.events).toContainEqual(expect.objectContaining({ type: "ShieldChanged", unitId: "player", change: "gained" }));

    const sky = start("race:skyborn");
    const moved = ok(applyCommand(rules, c, sky, { type: "move", actorId: "player", row: "back", slot: 1 }, { source: "player" }));
    expect(triggered(moved.events, "skill:race_skyborn_wind")).toBe(true);

    // The fox's bite tries mark (80%) and bleed: give it the skill turn until a debuff lands.
    let veil = ok(createBattle(rules, c, (() => {
      const setup = baseSetup();
      setup.player.passiveIds = [RACE_PASSIVES["race:veilborn"]!];
      return setup;
    })())).state;
    let fired = false;
    for (let i = 0; i < 200 && veil.status === "active" && !fired; i++) {
      const actor = currentActor(veil)!;
      const r = ok(applyCommand(rules, c, veil, { type: "guard", actorId: actor.unitId }, { source: "player" }));
      fired = r.events.some((e) => e.type === "PassiveTriggered" && e.sourceId === "skill:race_veilborn_shade");
      if (fired) {
        const debuffed = r.events.findIndex((e) => e.type === "StatusChanged" && e.unitId === "player" && e.change === "applied");
        expect(debuffed).toBeGreaterThanOrEqual(0);
      }
      veil = r.state;
    }
    expect(fired).toBe(true);
  });
});
