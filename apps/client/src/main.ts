import Phaser from "phaser";
import type { BattleSetup, MonsterInstance } from "@pmrpg/shared";
import { BattleScene, GAME_SIZE } from "./battle-scene";
import { CharacterApi } from "./character-api";
import { createCharacterForm } from "./character-ui";
import { HttpTransport, LocalPreviewTransport, type BattleTransport } from "./transport";
import { WorldScene } from "./world-scene";
import { LocalWorldTransport, ServerWorldTransport } from "./world-transport";

// Default page: the walking slice (Phase B). `?battle` opens the battle preview instead.
// `?server` talks to `wrangler dev` through the Vite proxy (or `?server=https://host`);
// without it the page runs a local, non-authoritative preview.
const params = new URLSearchParams(location.search);
const server = params.get("server");
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  ...GAME_SIZE,
  pixelArt: true,
  backgroundColor: "#14121c",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
});

// Dev builds expose the game so browser checks can find things on screen.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

if (params.has("battle")) {
  // Each battle page load is a fresh dev account: an account with an unfinished battle cannot start
  // another one (reservation lock), and abandoning a fight has no policy yet (O11/O15).
  const transport: BattleTransport =
    server !== null
      ? new HttpTransport(server, `battle:${crypto.randomUUID().slice(0, 8)}`, `acct:dev_${crypto.randomUUID().slice(0, 8)}`)
      : new LocalPreviewTransport(previewSetup(params.get("seed") ?? "preview"));
  game.scene.add("battle", BattleScene, true, { transport });
} else {
  // Dev identity: `?account=name` picks one (open two tabs with different names to see each other);
  // otherwise one per browser tab, kept across reloads so a reload is a reconnect, not a new player.
  const account = params.get("account") ?? sessionAccount();
  if (server !== null) {
    // Server mode needs a stored character (Phase D); a new account makes one first.
    const api = new CharacterApi(server, account);
    void (async () => {
      const bundle = (await api.get()) ?? (await createCharacterForm(api));
      game.scene.add("world", WorldScene, true, { transport: new ServerWorldTransport(server, account), api, bundle });
    })();
  } else {
    game.scene.add("world", WorldScene, true, { transport: new LocalWorldTransport(), api: null, bundle: null });
  }
  // Started by the world scene when the player engages a pack.
  game.scene.add("battle", BattleScene, false);
}

function sessionAccount(): string {
  const key = "pmrpg.devAccount";
  try {
    const saved = sessionStorage.getItem(key);
    if (saved !== null) return saved;
    const made = `acct:dev_${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem(key, made);
    return made;
  } catch {
    return `acct:dev_${crypto.randomUUID().slice(0, 8)}`;
  }
}

function previewSetup(seed: string): BattleSetup {
  const pet = (id: string, speciesId: string, element: MonsterInstance["element"]): MonsterInstance => ({
    id,
    speciesId,
    ownerId: "acct:preview",
    currentLevel: 8,
    xp: 0,
    rebirthStage: 0,
    element,
    primaryStats: { STR: 16, VIT: 16, INT: 12, DEX: 12, AGI: 12, SPI: 16 },
    growthHistoryVersion: 1,
    growthSeed: "seed:fixture",
    trainedSkillLevels: {},
    bond: 0,
    originRecord: { kind: "starter", at: "2026-10-03T00:00:00Z" },
    ownershipVersion: 1,
    lockState: "in_battle",
  });
  return {
    battleId: "battle:preview",
    originMode: "manual",
    seed,
    player: {
      accountId: "acct:preview",
      name: "ผู้เล่น",
      level: 10,
      element: "FIRE",
      primaryStats: { STR: 25, VIT: 18, INT: 10, DEX: 14, AGI: 14, SPI: 10 },
      gear: { PATK: 30 },
      skillIds: ["skill:player_power_strike"],
      basicAttackRange: "melee",
      row: "front",
      slot: 1,
    },
    companions: [
      { instance: pet("pet1", "species:lantern_snail", "WATER"), row: "back", slot: 1 },
      { instance: pet("pet2", "species:armor_crab", "EARTH"), row: "front", slot: 0 },
    ],
    enemies: [
      { unitId: "e1", speciesId: "species:ember_fox", element: "FIRE", row: "front", slot: 1 },
      { unitId: "e2", speciesId: "species:armor_crab", element: "WATER", row: "front", slot: 3 },
      { unitId: "e3", speciesId: "species:lantern_snail", element: "LIGHT", row: "back", slot: 2 },
    ],
    bag: { "item:small_potion": 5, "item:ember_fox_capture": 3, "item:armor_crab_capture": 3, "item:lantern_snail_capture": 3 },
  };
}
