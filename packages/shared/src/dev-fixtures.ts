/**
 * DEV / TEST ONLY. Values for OPEN rules so the prototype can be exercised end to end.
 * No battle rule is OPEN any more: capture (O07, P18) and cooldown/flee/revive/fight end (O15, decided
 * 2026-10-07) use the production rules, so this currently overrides nothing. It stays as the one place a
 * future OPEN rule gets a dev value; BattleRoom refuses any rules with fixture overrides outside "dev".
 */
import { PRODUCTION_RULES, withFixtureOverrides } from "./rules";
import type { BattleSetup } from "./battle/types";

export const DEV_FIXTURE_RULES = withFixtureOverrides(PRODUCTION_RULES, {});

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
  "item:supply_mole_capture": 3,
  "item:bell_bird_capture": 3,
};

/**
 * DEV ONLY: a few Sigils and coins so install/removal can be tried without ~2000 kills per Sigil
 * (chapter 06 rates). Granted under their own operation ids, never outside dev.
 */
export const DEV_STARTER_SIGILS: Record<string, number> = {
  "item:ember_fox_sigil": 2,
  "item:supply_mole_sigil": 1,
};
export const DEV_STARTER_COINS = 1000;
