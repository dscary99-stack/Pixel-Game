/**
 * EXAMPLE refining content (refine.ts, REFINEMENT_DESIGN v2.1): refine stones per tier, wards per
 * tier and target, and one ward recipe each. Stone drops and stone recipes are OPEN, so stones come
 * only from dev grants for now. Tier 1 wards use the example monsters' own drops (common: crab
 * shell, rare: crystal shard from the guardian); tiers 2–4 and every Elite core are placeholder
 * materials until real species, drop tables and alternative recipes exist.
 */
import type { Recipe } from "../craft";
import { refineStoneItemId, refineWardCraftCoins, refineWardItemId, REFINE_TIER_NAME_TH, type RefineTier } from "../refine";
import { PRODUCTION_RULES } from "../rules";
import type { ItemDefinition } from "../schemas";

const meta = { version: 1, status: "draft", example: true } as const;
const RULES = PRODUCTION_RULES;
const TIERS: RefineTier[] = [1, 2, 3, 4];
const tierRange = (t: RefineTier) => {
  const [lo, hi] = RULES.provisional.refineStoneTiers.value[t - 1]!;
  return `Lv${lo}–${hi}`;
};

/** Ward materials per tier: common and rare monster materials and an Elite core (EXAMPLE). */
const WARD_MATERIALS: Record<RefineTier, { common: string; rare: string; core: string }> = {
  1: { common: "item:crab_shell", rare: "item:crystal_shard", core: "item:elite_core_t1" },
  2: { common: "item:wild_hide_t2", rare: "item:wild_gem_t2", core: "item:elite_core_t2" },
  3: { common: "item:wild_hide_t3", rare: "item:wild_gem_t3", core: "item:elite_core_t3" },
  4: { common: "item:wild_hide_t4", rare: "item:wild_gem_t4", core: "item:elite_core_t4" },
};

const WARD_TARGETS = RULES.provisional.refineWardCraft.value.map((r) => r.target);

export const EXAMPLE_REFINE_ITEMS: ItemDefinition[] = [
  ...TIERS.map((t): ItemDefinition => ({ id: refineStoneItemId(t), ...meta, name: { th: `หินตีบวก${REFINE_TIER_NAME_TH[t]}` }, kind: "material", vendorPrice: 0 })),
  ...TIERS.flatMap((t) =>
    WARD_TARGETS.map((target): ItemDefinition => ({ id: refineWardItemId(t, target), ...meta, name: { th: `ตราคุ้มครองการหลอม +${target} (${tierRange(t)})` }, kind: "material", vendorPrice: 0 })),
  ),
  ...TIERS.map((t): ItemDefinition => ({ id: `item:elite_core_t${t}`, ...meta, name: { th: `แก่น Elite (${tierRange(t)})` }, kind: "material", vendorPrice: 0 })),
  ...([2, 3, 4] as const).flatMap((t): ItemDefinition[] => [
    { id: `item:wild_hide_t${t}`, ...meta, name: { th: `หนังอสูร (${tierRange(t)})` }, kind: "material", vendorPrice: 0 },
    { id: `item:wild_gem_t${t}`, ...meta, name: { th: `อัญมณีอสูร (${tierRange(t)})` }, kind: "material", vendorPrice: 0 },
  ]),
];

/** One ward recipe per tier and target: coins plus monster materials, always succeeds, makes one ward. */
export const EXAMPLE_WARD_RECIPES: Recipe[] = TIERS.flatMap((t) =>
  RULES.provisional.refineWardCraft.value.map((row): Recipe => {
    const m = WARD_MATERIALS[t];
    const inputs = [
      { itemId: m.common, quantity: row.common },
      { itemId: m.rare, quantity: row.rare },
      ...(row.core > 0 ? [{ itemId: m.core, quantity: row.core }] : []),
    ];
    return {
      id: `recipe:refine_ward_t${t}_p${row.target}`,
      ...meta,
      name: { th: `ตราคุ้มครองการหลอม +${row.target} (${tierRange(t)})` },
      profession: "jeweler",
      inputs,
      coins: refineWardCraftCoins(RULES, row.target, t),
      output: { kind: "item", itemId: refineWardItemId(t, row.target), quantity: 1 },
      requiredMastery: 0,
      masteryGain: 2,
      masteryCap: 200,
    };
  }),
);
