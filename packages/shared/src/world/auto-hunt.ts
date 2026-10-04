/**
 * Auto Hunt (C14, chapter 08): the server walks the player to visible packs on the current map and
 * fights them with Auto Battle, one after another, while the game is open and connected.
 *
 * - Reward mode is fixed at the start of each fight as `auto_hunt` (P01 drop ×0.70, EXP unchanged);
 *   stopping mid-fight hands control back but never changes that fight's reward mode.
 * - Normal and Elite packs only (Elite opt-in); never bosses, portals or towns (chapter 08 settings).
 * - It never captures (C15) and never buys, sells or releases anything.
 * - The planner only uses what the player can see: the pack's leader, rank and size range.
 *
 * Pure: the Map Channel Durable Object owns the loop and calls these each tick.
 */
import { z } from "zod";
import type { RulesConfig } from "../rules";
import { portalAt, type MapDefinition, type TilePos } from "./map";
import { findPathWhere, type Direction } from "./movement";
import { inEngageRange, type VisiblePack } from "./encounter";
import { AutoItemRuleSchema, AutoSkillRuleSchema } from "../battle/auto-policy";

const SpeciesRef = z.string().regex(/^species:[a-z0-9_]+$/);

/** The player's Auto Hunt settings (chapter 08 "Auto settings", PROVISIONAL). */
export const AutoHuntSettingsSchema = z
  .object({
    /** Only packs led by one of these; empty = any species. */
    targetSpecies: z.array(SpeciesRef).max(20).default([]),
    /** Skip packs that could be bigger than this (by the visible size range). */
    maxPackSize: z.number().int().min(1).max(10).default(10),
    allowElite: z.boolean().default(false),
    /** Stop and tell the player when a pack led by one of these is in sight (for a manual capture). */
    stopOnSpecies: z.array(SpeciesRef).max(20).default([]),
    /** Stop between fights when the character's HP is below this percent of max (0 = never). */
    stopBelowHpPercent: z.number().int().min(0).max(90).default(30),
    /** Stop between fights when the character's MP is below this percent of max (0 = never). */
    stopBelowMpPercent: z.number().int().min(0).max(90).default(0),
    /** Stop between fights when any team companion's HP is below this percent of max (0 = never). */
    stopBelowCompanionHpPercent: z.number().int().min(0).max(90).default(0),
    /** Items Auto may use in fights, in priority order (chapter 08 allowed items / max spend). */
    itemRules: z.array(AutoItemRuleSchema).max(5).default([]),
    /** How Auto uses skills in fights (heal, cleanse, buff, debuff, damage; MP reserve). */
    skills: AutoSkillRuleSchema.prefault({}),
    /** Stop between fights once every item in the rules has run out. */
    stopWhenItemsOut: z.boolean().default(false),
  })
  .strict();
export type AutoHuntSettings = z.infer<typeof AutoHuntSettingsSchema>;

export type AutoStopReason =
  /** The player pressed stop, walked by hand, or took over a fight. */
  | "PLAYER_STOPPED"
  /** A pack led by a species on the stop list is in sight. */
  | "FOUND_SPECIES"
  /** The character's HP fell below the setting between fights. */
  | "LOW_HP"
  /** The character's MP fell below the setting between fights. */
  | "LOW_MP"
  /** A team companion's HP fell below the setting between fights. */
  | "COMPANION_LOW_HP"
  /** Every item in the item rules has run out. */
  | "ITEMS_OUT"
  /** Everyone in the team is knocked out. */
  | "NEED_REST"
  /** The team lost; the player is sent back to town. */
  | "DEFEATED"
  /** No pack on this map can ever match the settings, or none can be reached. */
  | "NO_TARGETS"
  /** The connection closed (no offline farming, C14). */
  | "DISCONNECTED"
  | "NO_HUNT_HERE"
  | "NO_CHARACTER"
  /** The server refused a fight for another reason (shown with the code). */
  | "REFUSED";

/** Whether a visible pack is one the settings allow fighting. */
export function packAllowed(settings: AutoHuntSettings, pack: VisiblePack): boolean {
  if (pack.rank === "ELITE" && !settings.allowElite) return false;
  if (pack.sizeRange[1] > settings.maxPackSize) return false;
  return settings.targetSpecies.length === 0 || settings.targetSpecies.includes(pack.leader.speciesId);
}

/** Whether any spawn on the map could ever roll a pack the settings allow. */
export function mapHasTargets(settings: AutoHuntSettings, map: MapDefinition): boolean {
  return map.spawns.some(
    (s) =>
      (s.rank !== "ELITE" || settings.allowElite) &&
      s.packSize[1] <= settings.maxPackSize &&
      (settings.targetSpecies.length === 0 || s.entries.some((e) => settings.targetSpecies.includes(e.speciesId))),
  );
}

/** A visible pack led by a species on the stop list, if any. */
export function stopSpeciesPack(settings: AutoHuntSettings, packs: readonly VisiblePack[]): VisiblePack | null {
  return packs.find((p) => settings.stopOnSpecies.includes(p.leader.speciesId)) ?? null;
}

export type AutoHuntPlan =
  /** Already next to it: engage. */
  | { kind: "engage"; packId: string }
  /** Walk this path, then engage. */
  | { kind: "walk"; packId: string; path: Direction[] }
  /** Nothing to fight right now (all fought this cycle, or none allowed in sight): wait for respawn. */
  | { kind: "wait" }
  /** Allowed packs are in sight but none can be reached. */
  | { kind: "unreachable" };

/** The nearest allowed pack by walking distance, and the path to stand next to it. */
export function planAutoHunt(rules: RulesConfig, map: MapDefinition, pos: TilePos, packs: readonly VisiblePack[], settings: AutoHuntSettings): AutoHuntPlan {
  const allowed = packs.filter((p) => packAllowed(settings, p));
  if (allowed.length === 0) return { kind: "wait" };
  const near = allowed.find((p) => inEngageRange(rules, pos, p));
  if (near !== undefined) return { kind: "engage", packId: near.packId };
  // One BFS to whichever allowed pack is reached first, so the choice is the nearest by walking.
  // Portals are never crossed: Auto Hunt stays on this map.
  let reached: VisiblePack | undefined;
  const path = findPathWhere(
    map,
    pos,
    (t) => {
      reached = allowed.find((p) => inEngageRange(rules, t, p));
      return reached !== undefined;
    },
    4096,
    (t) => portalAt(map, t.x, t.y) !== null,
  );
  if (path === null || reached === undefined) return { kind: "unreachable" };
  return { kind: "walk", packId: reached.packId, path };
}

/** HP/MP of one unit between fights. */
export interface Vital {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
}

/**
 * Whether the team may start the next Auto Hunt fight (chapter 08 stop conditions), checked between
 * fights. `itemsOwned` is what the account holds of each item named in the item rules.
 */
export function autoHuntReadiness(
  settings: AutoHuntSettings,
  character: Vital,
  companions: readonly Vital[],
  itemsOwned: Readonly<Record<string, number>>,
): { stop: AutoStopReason; detail?: string } | null {
  const below = (v: number, max: number, pct: number) => pct > 0 && v * 100 < pct * max;
  if (character.hp <= 0 && companions.every((c) => c.hp <= 0)) return { stop: "NEED_REST" };
  if (below(character.hp, character.maxHp, settings.stopBelowHpPercent)) return { stop: "LOW_HP", detail: `${character.hp}/${character.maxHp}` };
  if (below(character.mp, character.maxMp, settings.stopBelowMpPercent)) return { stop: "LOW_MP", detail: `${character.mp}/${character.maxMp}` };
  const weak = companions.find((c) => below(c.hp, c.maxHp, settings.stopBelowCompanionHpPercent));
  if (weak !== undefined) return { stop: "COMPANION_LOW_HP", detail: `${weak.hp}/${weak.maxHp}` };
  if (settings.stopWhenItemsOut && settings.itemRules.length > 0 && settings.itemRules.every((r) => (itemsOwned[r.itemId] ?? 0) <= 0)) {
    return { stop: "ITEMS_OUT" };
  }
  return null;
}
