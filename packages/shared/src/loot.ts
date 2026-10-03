/**
 * Loot roll for one defeated enemy (chapter 06 "อัลกอริทึมที่รักษาSigil rateและAuto multiplier").
 *
 * 1. Roll the Sigil at its base p; a hit reserves one of the 5 slots.
 * 2. Roll the remaining ordinary slots; each may be empty. Pick pool by weight, then item by weight.
 * 3. That gives <= 5 base candidates.
 * 4. Auto Hunt keeps each candidate with q = 0.70, once. Manual / manual-start q = 1. No refill.
 * 5. Merge same item IDs.
 *
 * Actual Sigil rate is p * q. A captured enemy never reaches this function.
 */
import type { Rng } from "./rng";
import type { RulesConfig } from "./rules";
import type { LootTable } from "./schemas";

export type OriginMode = "manual" | "manual_start_auto" | "auto_hunt";

export interface LootLine {
  itemId: string;
  quantity: number;
}

export function lootRetention(rules: RulesConfig, origin: OriginMode): number {
  return origin === "auto_hunt"
    ? rules.provisional.autoHuntLootRetention.value
    : rules.provisional.manualStartLootRetention.value;
}

/** Party material bonus (P02): relative percent, and which items count as ordinary materials. */
export interface MaterialBonus {
  percent: number;
  isMaterial: (itemId: string) => boolean;
}

export function rollLoot(rules: RulesConfig, table: LootTable, origin: OriginMode, rng: Rng, material?: MaterialBonus): LootLine[] {
  const maxSlots = rules.confirmed.maxLootTypesPerEnemy.value;
  const candidates: LootLine[] = [];

  if (rng.chance(table.sigilRoll.probability)) {
    candidates.push({ itemId: table.sigilRoll.itemId, quantity: 1 });
  }

  const poolWeights = table.pools.map((p) => p.weight);
  const totalPoolWeight = poolWeights.reduce((s, w) => s + w, 0);
  const ordinarySlots = maxSlots - candidates.length;
  for (let slot = 0; slot < ordinarySlots; slot++) {
    // Slot is empty with weight emptySlotWeight against the summed pool weights.
    const pick = rng.pickWeighted([table.emptySlotWeight, totalPoolWeight]);
    if (pick === 0) continue;
    const pool = table.pools[rng.pickWeighted(poolWeights)]!;
    const entry = pool.entries[rng.pickWeighted(pool.entries.map((e) => e.weight))]!;
    const quantity = entry.minQty + rng.nextInt(entry.maxQty - entry.minQty + 1);
    candidates.push({ itemId: entry.itemId, quantity });
  }

  // Step 4, with the party bonus on ordinary materials folded into the same multiplier once:
  // r = q × (1 + b). Above 1, the line is kept and doubled with chance r − 1, so the expected
  // amount is r × quantity (1% becomes 1.06%, not 7%). With no bonus this is the plain q filter.
  const q = lootRetention(rules, origin);
  const kept: LootLine[] = [];
  for (const line of candidates) {
    const b = material !== undefined && material.percent > 0 && material.isMaterial(line.itemId) ? material.percent : 0;
    const r = (q * (100 + b)) / 100;
    if (r < 1 && !rng.chance(r)) continue;
    kept.push(line);
    if (r > 1 && rng.chance(r - 1)) kept.push({ ...line });
  }

  const merged = new Map<string, number>();
  for (const line of kept) merged.set(line.itemId, (merged.get(line.itemId) ?? 0) + line.quantity);
  return [...merged].map(([itemId, quantity]) => ({ itemId, quantity }));
}
