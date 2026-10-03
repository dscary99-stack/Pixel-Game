/**
 * DEV / TEST ONLY. Values for OPEN rules so the prototype can be exercised end to end.
 * These are not decisions: O07 (capture table) and O15 (cooldown tick) are still OPEN.
 * BattleRoom refuses any rules with fixture overrides outside the "dev" environment.
 */
import { PRODUCTION_RULES, withFixtureOverrides } from "./rules";
import type { BattleSetup } from "./battle/types";

export const DEV_FIXTURE_RULES = withFixtureOverrides(PRODUCTION_RULES, {
  captureRates: {
    rankBounds: { NORMAL: [0.05, 0.95], ELITE: [0.02, 0.6], BOSS: [0.01, 0.3] },
    hpFactor: [
      { maxHpRatio: 0.25, factor: 2 },
      { maxHpRatio: 0.5, factor: 1.5 },
      { maxHpRatio: 1, factor: 1 },
    ],
  },
  cooldownTick: "owner_turn_start",
});

/**
 * DEV ONLY stand-in character. There is no character table yet (Phase D: stats, level, gear and
 * companions persisted per account), so dev fights use this fixed Lv10 player. Outside dev the
 * server refuses to start encounters (NO_CHARACTER) rather than inventing a character.
 */
export function devPlayer(accountId: string, name: string): BattleSetup["player"] {
  return {
    accountId,
    name,
    level: 10,
    element: "FIRE",
    primaryStats: { STR: 25, VIT: 18, INT: 10, DEX: 14, AGI: 14, SPI: 10 },
    gear: { PATK: 30 },
    skillIds: ["skill:player_power_strike"],
    basicAttackRange: "melee",
    row: "front",
    slot: 1,
  };
}

/** DEV ONLY items a new dev account starts with, so encounters have a bag to reserve. */
export const DEV_STARTER_ITEMS: Record<string, number> = {
  "item:small_potion": 5,
  "item:armor_crab_capture": 3,
  "item:ember_fox_capture": 3,
  "item:lantern_snail_capture": 3,
};
