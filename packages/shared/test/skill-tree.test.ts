import { describe, expect, it } from "vitest";
import {
  CLASS1_DEFINITIONS,
  CLASS2_BRANCHES,
  CLASS3_ADVANCES,
  SKILL_TREES,
  STATUS_DEFINITIONS,
  SkillDefinitionSchema,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  elementMultiplier,
  expForLevel,
  jobCap,
  jobExpCap,
  jobExpForLevel,
  jobExpFromBase,
  jobLevelForExp,
  jobState,
  learnRefusal,
  pointsSpent,
  skillBudget,
  skillValue,
  treesFor,
  type BattleState,
  type KernelResult,
  type SkillDefinition,
} from "../src/index";
import { baseSetup, companion, content, rules } from "./fixtures";

const c = content();
const ok = (r: KernelResult) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r;
};
const sk = (id: string) => c.skills.get(id)!;
const statusesOf = (s: SkillDefinition) => s.effectSequence.flatMap((e) => ("statuses" in e ? (e.statuses ?? []) : []));
const kinds = (s: SkillDefinition) => {
  const k = new Set<string>();
  for (const e of s.effectSequence) {
    if (e.kind === "damage") k.add(e.damageType);
    if (e.kind === "heal" || e.kind === "revive") k.add("support");
  }
  for (const a of statusesOf(s)) k.add(STATUS_DEFINITIONS[a.statusId].harmful ? "debuff" : "support");
  return k;
};

describe("job levels (P29)", () => {
  it("each tier starts at Job 1 and reaches its cap with about the base EXP of its level band", () => {
    const tiers = rules.provisional.jobLevels.value.tiers;
    tiers.forEach((t, i) => {
      const tier = (i + 1) as 1 | 2 | 3;
      expect(jobCap(rules, tier)).toBe(t.cap);
      expect(jobExpForLevel(rules, tier, 1)).toBe(0);
      expect(jobExpCap(rules, tier)).toBe(expForLevel(rules, "player", t.baseTo) - expForLevel(rules, "player", t.baseFrom));
      for (let j = 2; j <= t.cap; j++) expect(jobExpForLevel(rules, tier, j)).toBeGreaterThan(jobExpForLevel(rules, tier, j - 1));
      expect(jobLevelForExp(rules, tier, jobExpForLevel(rules, tier, 7))).toBe(7);
      expect(jobLevelForExp(rules, tier, jobExpForLevel(rules, tier, 7) - 1)).toBe(6);
      expect(jobLevelForExp(rules, tier, Number.MAX_SAFE_INTEGER)).toBe(t.cap);
    });
    expect(jobExpFromBase(rules, 123)).toBe(123);
  });

  it("points are the job levels of every tier reached", () => {
    expect(jobState(rules, 1, [])).toMatchObject({ tier: 1, levels: [1], points: 1 });
    const s = jobState(rules, 2, [jobExpCap(rules, 1), jobExpForLevel(rules, 2, 10)]);
    expect(s.levels).toEqual([50, 10]);
    expect(s.points).toBe(60);
  });
});

describe("skill trees (Nut 2026-10-09)", () => {
  it("every node is a valid player skill, appears once, has its own cell, and needs only skills of the same character's trees", () => {
    const seen = new Set<string>();
    for (const cls of CLASS1_DEFINITIONS) {
      for (const b of [null, ...CLASS2_BRANCHES.filter((x) => x.classId === cls.id)]) {
        const trees = treesFor(SKILL_TREES, cls.id, b?.treeId);
        expect(trees).toHaveLength(b === null ? 1 : 2);
        const ids = new Set(trees.flatMap((t) => t.nodes.map((n) => n.skillId)));
        for (const n of trees.at(-1)!.nodes) {
          for (const r of n.requires) {
            expect(ids.has(r.skillId), `${n.skillId} needs ${r.skillId}`).toBe(true);
            const need = trees.flatMap((t) => t.nodes).find((x) => x.skillId === r.skillId)!;
            expect(r.level).toBeLessThanOrEqual(need.maxLevel);
          }
        }
      }
    }
    for (const t of SKILL_TREES.values()) {
      const cells = new Set(t.nodes.map((n) => `${n.col}:${n.row}`));
      expect(cells.size, t.id).toBe(t.nodes.length);
      for (const n of t.nodes) {
        expect(seen.has(n.skillId), n.skillId).toBe(false);
        seen.add(n.skillId);
        expect(SkillDefinitionSchema.safeParse(sk(n.skillId)).success, n.skillId).toBe(true);
        expect(n.maxLevel).toBeGreaterThanOrEqual(1);
        expect(n.maxLevel).toBeLessThanOrEqual(10);
      }
    }
  });

  it("every class and every branch has physical, magic, support and debuff skills and two passives", () => {
    for (const t of SKILL_TREES.values()) {
      const all = new Set(t.nodes.flatMap((n) => [...kinds(sk(n.skillId))]));
      expect([...all].sort(), t.id).toEqual(["debuff", "magic", "physical", "support"]);
      expect(t.nodes.filter((n) => sk(n.skillId).kind === "passive"), t.id).toHaveLength(2);
    }
  });

  it("branch and Class3 trees reach both sides: at least three skills per tree act on more than one target group", () => {
    for (const b of [...CLASS2_BRANCHES, ...CLASS3_ADVANCES]) {
      const t = SKILL_TREES.get(b.treeId)!;
      const multi = t.nodes.filter((n) => sk(n.skillId).effectSequence.length > 1);
      expect(multi.length, b.id).toBeGreaterThanOrEqual(3);
    }
  });

  // Job 50 (Nut 2026-10-09 17:14Z): Class1 points buy about half of one tree, so a character still picks a build.
  it("one class tree costs far more than Class1's points, so a character picks a build", () => {
    for (const cls of CLASS1_DEFINITIONS) {
      const t = SKILL_TREES.get(cls.id)!;
      expect(t.nodes.reduce((n, x) => n + x.maxLevel * x.cost, 0), cls.id).toBeGreaterThan(1.8 * jobCap(rules, 1));
    }
  });

  it("every Class1 tree ends each column in a capstone: Lv5 max, 2 points a level, after the column's deepest active", () => {
    for (const cls of CLASS1_DEFINITIONS) {
      const t = SKILL_TREES.get(cls.id)!;
      const caps = t.nodes.filter((n) => n.row === 4);
      expect(caps.map((n) => n.col).sort(), cls.id).toEqual([0, 1, 2, 3]);
      for (const n of caps) {
        expect([n.maxLevel, n.cost, sk(n.skillId).cooldown], n.skillId).toEqual([5, 2, 6]);
        const line = t.nodes.filter((x) => x.col === n.col && x.row < 4 && sk(x.skillId).kind === "active").sort((a, b) => b.row - a.row);
        expect(n.requires.map((r) => r.skillId), n.skillId).toEqual([line[0]!.skillId]);
      }
    }
  });

  it("every Class2 branch has one signature capstone: Lv5 max, 2 points a level, after its column's deepest active", () => {
    for (const b of CLASS2_BRANCHES) {
      const t = SKILL_TREES.get(b.treeId)!;
      const caps = t.nodes.filter((n) => n.row === 4);
      expect(caps, b.id).toHaveLength(1);
      const n = caps[0]!;
      expect([n.maxLevel, n.cost, sk(n.skillId).cooldown], n.skillId).toEqual([5, 2, 6]);
      const line = t.nodes.filter((x) => x.col === n.col && x.row < 4 && sk(x.skillId).kind === "active").sort((a, z) => z.row - a.row);
      expect(n.requires.map((r) => r.skillId), n.skillId).toEqual([line[0]!.skillId]);
    }
  });

  it("every Class2 branch has one Class3, whose tree is tier 3 with one signature capstone", () => {
    expect(CLASS3_ADVANCES.map((a) => a.branchId).sort()).toEqual(CLASS2_BRANCHES.map((b) => b.id).sort());
    for (const a of CLASS3_ADVANCES) {
      const t = SKILL_TREES.get(a.treeId)!;
      expect(t.tier, a.id).toBe(3);
      const caps = t.nodes.filter((n) => n.row === 4);
      expect(caps, a.id).toHaveLength(1);
      const n = caps[0]!;
      expect([n.maxLevel, n.cost, sk(n.skillId).cooldown], n.skillId).toEqual([5, 2, 6]);
      const line = t.nodes.filter((x) => x.col === n.col && x.row < 4 && sk(x.skillId).kind === "active").sort((p, z) => z.row - p.row);
      expect(n.requires.map((r) => r.skillId), n.skillId).toEqual([line[0]!.skillId]);
      // Class3 points (Job 70) buy most of its own tree but not all of it.
      const cost = t.nodes.reduce((x, y) => x + y.maxLevel * y.cost, 0);
      expect(cost, a.id).toBeGreaterThan(jobCap(rules, 3) * 0.9);
      expect(cost, a.id).toBeLessThan(jobCap(rules, 3) * 1.2);
    }
  });

  it("the Class3 tree counts only after a branch", () => {
    expect(treesFor(SKILL_TREES, "class:guardian", null, "class3:aegis_sovereign").map((t) => t.id)).toEqual(["class:guardian"]);
    expect(treesFor(SKILL_TREES, "class:guardian", "class2:bastion", "class3:aegis_sovereign").map((t) => t.id)).toEqual(["class:guardian", "class2:bastion", "class3:aegis_sovereign"]);
  });

  it("every active is worth its cost at Lv1 (P30 budget band)", () => {
    for (const t of SKILL_TREES.values()) {
      for (const n of t.nodes) {
        const s = sk(n.skillId);
        if (s.kind !== "active") continue;
        const ratio = skillValue(s) / skillBudget(t.tier, s.mpCost, s.cooldown);
        const pure = s.effectSequence.every((e) => e.kind === "status");
        expect(ratio, n.skillId).toBeGreaterThanOrEqual(pure ? 0.7 : 0.85);
        expect(ratio, n.skillId).toBeLessThanOrEqual(pure ? 1.25 : 1.15);
        for (const e of s.effectSequence) if ("coefficient" in e) expect(e.coefficient, n.skillId).toBeGreaterThanOrEqual(0.3);
        expect(s.levelSteps, n.skillId).toHaveLength(9);
      }
    }
  });

  it("learning goes one level at a time, after the skills it needs, within the points", () => {
    const trees = treesFor(SKILL_TREES, "class:striker", null);
    const learned: Record<string, number> = {};
    expect(learnRefusal(trees, learned, 1, "skill:guardian_shield_bash")?.code).toBe("NOT_IN_TREE");
    expect(learnRefusal(trees, learned, 1, "skill:striker_cleave")?.code).toBe("NEEDS_SKILL");
    expect(learnRefusal(trees, learned, 1, "skill:striker_heavy_slash")).toBeNull();
    learned["skill:striker_heavy_slash"] = 1;
    expect(learnRefusal(trees, learned, 1, "skill:striker_heavy_slash")?.code).toBe("NO_POINTS");
    learned["skill:striker_heavy_slash"] = 10;
    expect(learnRefusal(trees, learned, 99, "skill:striker_heavy_slash")?.code).toBe("MAX_LEVEL");
    expect(learnRefusal(trees, learned, 12, "skill:striker_fighting_blood")?.code).toBe("NO_POINTS");
    expect(learnRefusal(trees, learned, 13, "skill:striker_fighting_blood")).toBeNull();
    expect(pointsSpent(trees, { ...learned, "skill:striker_fighting_blood": 1, "skill:guardian_cover": 5 })).toBe(13);
    // A branch node can need a Class1 skill.
    const withBranch = treesFor(SKILL_TREES, "class:striker", "class2:elementalist");
    expect(withBranch).toHaveLength(2);
  });
});

describe("tree skills in the kernel", () => {
  const cast = (skillId: string, over: { element?: "FIRE" | "WATER"; level?: number; companions?: boolean; target?: string } = {}) => {
    const setup = baseSetup({
      battleId: `battle:${skillId}`,
      ...(over.companions ? { companions: [{ instance: companion("m1", "species:armor_crab", "EARTH", 20), row: "back" as const, slot: 0 }] } : {}),
    });
    setup.player = { ...setup.player, element: over.element ?? "FIRE", skillIds: [skillId], skillLevels: { [skillId]: over.level ?? 1 }, primaryStats: { ...setup.player.primaryStats, INT: 40 } };
    let s: BattleState = ok(createBattle(rules, c, setup)).state;
    for (let i = 0; i < 30 && currentActor(s)?.unitId !== "player"; i++) s = ok(applyCommand(rules, c, s, { type: "guard", actorId: currentActor(s)!.unitId }, { source: "player" })).state;
    return ok(applyCommand(rules, c, s, { type: "skill", actorId: "player", skillId, targetId: over.target ?? "e2" }, { source: "player" }));
  };

  it("an own-element skill takes the caster's element", () => {
    const hit = (element: "FIRE" | "WATER") => {
      const ev = cast("skill:arcanist_arcane_bolt", { element }).events.find((e) => e.type === "ActionResolved" && e.targetId === "e2");
      if (ev?.type !== "ActionResolved" || ev.breakdown === null) throw new Error("no hit");
      return ev.breakdown.elementMultiplier;
    };
    expect(hit("FIRE")).toBe(elementMultiplier(rules, "FIRE", "FIRE"));
    expect(hit("WATER")).toBe(elementMultiplier(rules, "WATER", "FIRE"));
    expect(hit("FIRE")).not.toBe(hit("WATER"));
  });

  it("a later effect reaches its own side: area damage plus a team buff, or a hit plus a shield on the caster", () => {
    const tune = cast("skill:c2_minstrel_element_tune", { companions: true });
    expect(tune.events.filter((e) => e.type === "ActionResolved" && e.actorId === "player").length).toBeGreaterThanOrEqual(2);
    const buffed = tune.events.filter((e) => e.type === "StatusChanged" && e.statusId === "matk_up" && e.change === "applied").map((e) => (e.type === "StatusChanged" ? e.unitId : ""));
    expect(buffed.sort()).toEqual(["ally:m1", "player"]);
    const wave = cast("skill:guardian_sacred_wave");
    expect(wave.events).toContainEqual(expect.objectContaining({ type: "ShieldChanged", unitId: "player", change: "gained" }));
  });

  it("the learned level raises a damage skill's power by its table", () => {
    const base = (level: number) => {
      const ev = cast("skill:striker_heavy_slash", { level }).events.find((e) => e.type === "ActionResolved" && e.targetId === "e2");
      if (ev?.type !== "ActionResolved" || ev.breakdown === null) throw new Error("no hit");
      return ev.breakdown.base;
    };
    expect(base(5) / base(1)).toBeCloseTo(1.28, 6);
  });

  it("refuses a level for a skill the player does not have or above the max", () => {
    const setup = baseSetup();
    setup.player.skillLevels = { "skill:striker_heavy_slash": 2 };
    expect(createBattle(rules, c, setup)).toMatchObject({ ok: false });
    setup.player.skillIds = ["skill:striker_heavy_slash"];
    setup.player.skillLevels = { "skill:striker_heavy_slash": 11 };
    expect(createBattle(rules, c, setup)).toMatchObject({ ok: false });
  });

  it("refuses a later effect on the wrong side", () => {
    const wave = sk("skill:guardian_sacred_wave");
    const bad = { ...wave, effectSequence: [wave.effectSequence[0]!, { kind: "status", target: "all_enemies", statuses: [{ statusId: "shield", chancePct: 100, turns: 2, shieldPct: 5 }] }] };
    expect(SkillDefinitionSchema.safeParse(bad).success).toBe(false);
    const noTarget = { ...wave, effectSequence: [wave.effectSequence[0]!, { kind: "status", statuses: [{ statusId: "atk_up", chancePct: 100, turns: 2 }] }] };
    expect(SkillDefinitionSchema.safeParse(noTarget).success).toBe(false);
  });

  it("every build of every class fights to the end on Auto", () => {
    for (const t of SKILL_TREES.values()) {
      if (t.tier !== 1) continue;
      for (const col of [0, 1, 2, 3]) {
        const nodes = t.nodes.filter((n) => n.col === col && sk(n.skillId).kind === "active");
        const setup = baseSetup({ battleId: `battle:${t.id}:${col}` });
        setup.player = { ...setup.player, skillIds: nodes.map((n) => n.skillId), skillLevels: Object.fromEntries(nodes.map((n) => [n.skillId, 3])) };
        let s = ok(createBattle(rules, c, setup)).state;
        for (let i = 0; i < 400 && s.status === "active"; i++) {
          const cmd = chooseAutoCommand(s, c, {}, rules) ?? { type: "guard" as const, actorId: currentActor(s)!.unitId };
          s = ok(applyCommand(rules, c, s, cmd, { source: "auto" })).state;
        }
        expect(s.status, `${t.id} col ${col}`).not.toBe("active");
      }
    }
  });
});
