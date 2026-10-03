/**
 * DEV / TEST ONLY. Values for OPEN rules so the prototype can be exercised end to end.
 * These are not decisions: O07 (capture table) and O15 (cooldown tick) are still OPEN.
 * BattleRoom refuses any rules with fixture overrides outside the "dev" environment.
 */
import { PRODUCTION_RULES, withFixtureOverrides } from "./rules";

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
