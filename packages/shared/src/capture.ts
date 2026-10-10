/**
 * Capture chance (O07; CAPTURE_DESIGN_O07_V1, Nut chose this approach 2026-10-07, numbers PROVISIONAL).
 *
 * Eligibility comes first and is never turned into a minimum chance: a dead or retired target, a wild
 * level above player + 5 (C09), a boss whose capture window is shut, a wrong or missing capture item,
 * an item quality the profile does not accept, an Auto command (C15) or an actor whose status forbids
 * items all mean "cannot capture", with nothing spent and no roll.
 *
 * Then, from the fight state at the moment the command runs:
 *
 *   raw = species base × rank factor × HP factor × best status factor × item quality × mastery
 *   p   = clamp(raw, rank min, rank max)
 *
 * - rank = the unit's rank (an Elite leader of a NORMAL species is ELITE), else the species rank.
 * - HP uses the unit's real max HP in the fight (Elite/boss/tower scaling included), never shields.
 * - Only the single best active status counts (no stacking, nothing for expired statuses or DoTs).
 * - No pity, no class/race/gear/party/Premium bonus, mastery 1 for everyone (v1).
 *
 * The server rolls `rng.chance(p)` (roll < p succeeds). The client calls the same function to show the
 * breakdown before the player confirms; the server checks again when it runs.
 */
import type { CaptureProfile, Rank, RulesConfig } from "./rules";
import type { BattleUnit } from "./battle/types";
import type { ItemDefinition, SpeciesDefinition } from "./schemas";
import { STATUS_DEFINITIONS, statusBlocks, type StatusId } from "./status";

export type CaptureRefusal =
  | "AUTO_CAPTURE_FORBIDDEN"
  | "STATUS_BLOCKED"
  | "INVALID_TARGET"
  | "LEVEL_INELIGIBLE"
  | "NO_VALID_CAPTURE_WINDOW"
  | "INVALID_COMMAND"
  | "QUALITY_NOT_ENABLED"
  | "INSUFFICIENT_RESOURCE";

export interface CaptureBreakdown {
  ok: true;
  profileVersion: string;
  rank: Rank;
  base: number;
  rankFactor: number;
  hpFactor: number;
  /** The status that gave the factor, or null when none did. */
  statusId: StatusId | null;
  statusFactor: number;
  qualityFactor: number;
  masteryFactor: number;
  /** Before the rank bounds. */
  raw: number;
  /** The chance the server rolls against (0–1, not rounded). */
  probability: number;
  /** Set when the bounds changed the result. */
  capped: "min" | "max" | null;
  bounds: readonly [number, number];
}

export interface CaptureRefused {
  ok: false;
  code: CaptureRefusal;
  message: string;
  /** Level gate: the player level needed for this target. */
  minPlayerLevel?: number;
}

export interface CaptureInput {
  source: "player" | "auto";
  actor: Pick<BattleUnit, "kind" | "level" | "statuses">;
  target: Pick<BattleUnit, "side" | "hp" | "stats" | "level" | "rank" | "statuses" | "retired" | "ko" | "captureWindowOpen" | "speciesId">;
  species: Pick<SpeciesDefinition, "id" | "rank" | "captureBaseRate"> | undefined;
  item: Pick<ItemDefinition, "id" | "kind" | "captureSpeciesId" | "captureQuality"> | undefined;
  /** Copies of the item left in the fight's reserved bag. */
  inBag: number;
}

const refuse = (code: CaptureRefusal, message: string, extra: Partial<CaptureRefused> = {}): CaptureRefused => ({ ok: false, code, message, ...extra });

/** The chance from the fight state alone (eligibility already checked). */
export function captureChance(
  profile: CaptureProfile,
  species: Pick<SpeciesDefinition, "rank" | "captureBaseRate">,
  target: Pick<BattleUnit, "hp" | "stats" | "rank" | "statuses">,
  quality: number,
): CaptureBreakdown {
  const rank = target.rank ?? species.rank;
  const ratio = target.hp / target.stats.maxHp;
  const step = [...profile.hpFactor].sort((a, b) => a.maxHpRatio - b.maxHpRatio).find((s) => ratio <= s.maxHpRatio);
  const hpFactor = step?.factor ?? 1;
  let statusId: StatusId | null = null;
  let statusFactor = 1;
  for (const st of target.statuses ?? []) {
    const f = profile.statusFactors[st.statusId];
    if (f !== undefined && st.turnsLeft > 0 && f > statusFactor) {
      statusFactor = f;
      statusId = st.statusId;
    }
  }
  const qualityFactor = profile.qualityFactors[String(quality)] ?? 0;
  const rankFactor = profile.rankFactors[rank];
  const raw = species.captureBaseRate * rankFactor * hpFactor * statusFactor * qualityFactor * profile.masteryFactor;
  const bounds = profile.rankBounds[rank];
  const probability = Math.min(bounds[1], Math.max(bounds[0], raw));
  return {
    ok: true,
    profileVersion: profile.version,
    rank,
    base: species.captureBaseRate,
    rankFactor,
    hpFactor,
    statusId,
    statusFactor,
    qualityFactor,
    masteryFactor: profile.masteryFactor,
    raw,
    probability,
    capped: raw < bounds[0] ? "min" : raw > bounds[1] ? "max" : null,
    bounds,
  };
}

/** Every check a capture command must pass, in order, then the chance. Pure: the kernel and the client both use it. */
export function captureCheck(rules: RulesConfig, profile: CaptureProfile, c: CaptureInput): CaptureBreakdown | CaptureRefused {
  if (c.source === "auto" || rules.confirmed.autoCapture.value !== false) return refuse("AUTO_CAPTURE_FORBIDDEN", "capture is a manual player command only (C15)");
  if (c.actor.kind !== "player") return refuse("INVALID_COMMAND", "only the player can capture");
  const blocked = statusBlocks(c.actor.statuses, "items");
  if (blocked !== undefined) return refuse("STATUS_BLOCKED", `${STATUS_DEFINITIONS[blocked.statusId].th}: cannot use items`);
  const t = c.target;
  if (t.side !== "enemy" || t.hp <= 0 || t.ko || t.retired || t.speciesId === null) return refuse("INVALID_TARGET", "capture needs a living enemy");
  const gap = rules.confirmed.captureWildLevelGap.value;
  if (t.level > c.actor.level + gap) return refuse("LEVEL_INELIGIBLE", `wild Lv${t.level} > player Lv${c.actor.level} + ${gap}`, { minPlayerLevel: t.level - gap });
  if (!t.captureWindowOpen) return refuse("NO_VALID_CAPTURE_WINDOW", "this target has no open capture window");
  const sp = c.species;
  if (sp === undefined || sp.id !== t.speciesId || !(sp.captureBaseRate > 0)) return refuse("INVALID_COMMAND", "this species has no capture rate");
  const it = c.item;
  if (it === undefined || it.kind !== "capture" || it.captureSpeciesId !== sp.id) return refuse("INVALID_COMMAND", `${it?.id ?? "that item"} cannot capture ${sp.id}`);
  const quality = it.captureQuality ?? 1;
  if (profile.qualityFactors[String(quality)] === undefined) return refuse("QUALITY_NOT_ENABLED", `capture quality ${quality} is not enabled in ${profile.version}`);
  if (c.inBag <= 0) return refuse("INSUFFICIENT_RESOURCE", `no ${it.id} in the combat bag`);
  return captureChance(profile, sp, t, quality);
}

/** Content check (validator): a profile that cannot produce nonsense. Returns problems, empty when fine. */
export function validateCaptureProfile(p: CaptureProfile): string[] {
  const out: string[] = [];
  const ranks: Rank[] = ["NORMAL", "ELITE", "BOSS"];
  for (const r of ranks) {
    const f = p.rankFactors[r];
    const b = p.rankBounds[r];
    if (!(Number.isFinite(f) && f > 0)) out.push(`rankFactors.${r} must be > 0`);
    if (b === undefined || !(b[0] > 0 && b[0] <= b[1] && b[1] <= 1)) out.push(`rankBounds.${r} must be 0 < min <= max <= 1`);
  }
  const steps = [...p.hpFactor].sort((a, b) => a.maxHpRatio - b.maxHpRatio);
  if (steps.length === 0 || steps.at(-1)!.maxHpRatio !== 1) out.push("hpFactor must end at maxHpRatio 1");
  if (new Set(steps.map((s) => s.maxHpRatio)).size !== steps.length) out.push("hpFactor thresholds repeat");
  // Lower HP never lowers the chance.
  for (let i = 1; i < steps.length; i++) if (steps[i]!.factor > steps[i - 1]!.factor) out.push("hpFactor must not drop as HP drops");
  for (const s of steps) if (!(s.maxHpRatio > 0 && Number.isFinite(s.factor) && s.factor >= 1)) out.push(`hpFactor step ${s.maxHpRatio} invalid`);
  for (const [id, f] of Object.entries(p.statusFactors)) {
    if (!(id in STATUS_DEFINITIONS)) out.push(`statusFactors: unknown status ${id}`);
    if (!(Number.isFinite(f) && f >= 1)) out.push(`statusFactors.${id} must be >= 1`);
  }
  if (Object.keys(p.qualityFactors).length === 0) out.push("no capture quality enabled");
  for (const [q, f] of Object.entries(p.qualityFactors)) if (!(Number(q) > 0 && Number.isFinite(f) && f > 0)) out.push(`qualityFactors.${q} invalid`);
  if (!(Number.isFinite(p.masteryFactor) && p.masteryFactor > 0)) out.push("masteryFactor must be > 0");
  return out;
}

/** Content check: every species can be captured (C08) with a base above 0 and a matching item of an enabled quality. */
export function validateCaptureContent(
  profile: CaptureProfile,
  species: Iterable<Pick<SpeciesDefinition, "id" | "captureBaseRate" | "captureItemId">>,
  items: ReadonlyMap<string, Pick<ItemDefinition, "kind" | "captureSpeciesId" | "captureQuality">>,
): string[] {
  const out: string[] = [];
  for (const sp of species) {
    if (!(Number.isFinite(sp.captureBaseRate) && sp.captureBaseRate > 0)) out.push(`${sp.id}: captureBaseRate must be > 0`);
    const it = items.get(sp.captureItemId);
    if (it === undefined || it.kind !== "capture" || it.captureSpeciesId !== sp.id) out.push(`${sp.id}: no capture item ${sp.captureItemId}`);
    else if (profile.qualityFactors[String(it.captureQuality ?? 1)] === undefined) out.push(`${sp.id}: capture item quality not enabled`);
  }
  return out;
}

/** The profile a fight uses: the one it pinned at start, else (states from before pinning) the current one. */
export const fightCaptureProfile = (rules: RulesConfig, pinned: CaptureProfile | undefined): CaptureProfile => pinned ?? rules.provisional.captureProfile.value;
