/**
 * One Map + Channel (chapter 11 §1 "Map Channel Durable Object": presence, validated positions).
 * Transport-agnostic and pure apart from its own presence table, so it runs in tests, in the
 * Durable Object, and (non-authoritatively) in the client's local preview.
 *
 * One presence per account per channel: a second join from the same account replaces the first
 * connection instead of adding a second player (P14: one controlling session per account).
 */
import { z } from "zod";
import type { RulesConfig } from "../rules";
import { portalAt, type MapDefinition, type Portal, type TilePos } from "./map";
import { DIRECTIONS, artFacing, tryStep, type Direction, type StepRejection } from "./movement";
import type { VisiblePack } from "./encounter";
import { AutoHuntSettingsSchema, type AutoStopReason } from "./auto-hunt";

// ---------------------------------------------------------------- wire protocol

export const WorldClientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("step"), seq: z.number().int().min(1).max(2 ** 31), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ t: z.literal("ping") }).strict(),
  /** Start a private fight against a visible pack (O05). */
  z.object({ t: z.literal("engage"), packId: z.string().min(1).max(120) }).strict(),
  /** Back from a fight: the server checks the fight is over before letting the player walk. */
  z.object({ t: z.literal("resume") }).strict(),
  /** Start Auto Hunt on this map with these settings (C14); the server walks and fights. */
  z.object({ t: z.literal("autoHunt"), settings: AutoHuntSettingsSchema }).strict(),
  z.object({ t: z.literal("autoStop") }).strict(),
]);
export type WorldClientMessage = z.infer<typeof WorldClientMessageSchema>;

export type Facing = "N" | "E" | "S" | "W";

/** What other players may see. No account id, no timing state. */
export interface PublicPlayer {
  sid: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
}

export type WorldServerMessage =
  | { t: "welcome"; mapId: string; channel: number; rulesVersion: string; self: PublicPlayer; others: PublicPlayer[] }
  | { t: "joined"; player: PublicPlayer }
  | { t: "left"; sid: string }
  | { t: "moved"; sid: string; x: number; y: number; facing: Facing }
  | { t: "ack"; seq: number; x: number; y: number }
  | { t: "correct"; seq: number; x: number; y: number; reason: StepRejection | "STALE_SEQ" | "IN_BATTLE" }
  /** The packs this player can engage right now (already-fought ones are left out). */
  | { t: "packs"; packs: VisiblePack[] }
  /** A private fight exists for this player; `resumed` when it was already running (reconnect). */
  | { t: "encounter"; battleId: string; resumed: boolean }
  | { t: "resumed" }
  /** HP/MP of the character and free companions are full again (town rest, chapter 03 §3). */
  | { t: "rested" }
  | { t: "transfer"; mapId: string; channel: number }
  | { t: "kicked"; reason: "REPLACED" | "EVICTED" }
  | { t: "error"; code: WorldErrorCode; message: string }
  | { t: "pong"; serverTime: number }
  /** Auto Hunt turned on or off; when off, why (and the pack/species for FOUND_SPECIES). */
  | { t: "auto"; on: boolean; reason?: AutoStopReason; detail?: string; packId?: string }
  /** The server moved this player (Auto Hunt). */
  | { t: "autoMoved"; x: number; y: number; facing: Facing };

export type WorldErrorCode =
  | "INVALID_MESSAGE"
  | "NOT_JOINED"
  | "CHANNEL_FULL"
  | "WRONG_MAP"
  | "NO_ACCOUNT"
  | "UNKNOWN_MAP"
  | "UNKNOWN_CHANNEL"
  | "SESSION_REPLACED"
  | "IN_BATTLE"
  | "TOO_FAR"
  | "NO_SUCH_PACK"
  | "NO_HUNT_HERE"
  | "NO_CHARACTER"
  | "ENCOUNTER_REFUSED"
  /** Nobody in the team can fight; rest in town first. */
  | "NEED_REST"
  /** The fight ended but its rewards are still being recorded; ask again shortly. */
  | "SETTLING";

// ---------------------------------------------------------------- presence

export interface Presence {
  accountId: string;
  sid: string;
  name: string;
  pos: TilePos;
  facing: Facing;
  /** Earliest server time the next step may start (see movement.ts). */
  readyAt: number;
  /** Highest step seq handled; repeats and older seqs never move the player again. */
  lastSeq: number;
  /** Moved since the last position save. */
  dirty: boolean;
  /** Set while the player is in a private fight; they cannot walk until it is over. */
  battleId: string | null;
}

/** A message for the acting player, for everyone else in the channel, or for one player. */
export type Outgoing = { to: "self" | "others"; msg: WorldServerMessage };

export const publicPlayer = (p: Presence): PublicPlayer => ({ sid: p.sid, name: p.name, x: p.pos.x, y: p.pos.y, facing: p.facing });

export type JoinResult =
  | { ok: true; presence: Presence; replaced: boolean; out: Outgoing[] }
  | { ok: false; code: WorldErrorCode; message: string };

export type StepOutcome =
  | { kind: "moved"; presence: Presence; out: Outgoing[]; portal: Portal | null }
  | { kind: "rejected"; out: Outgoing[] }
  | { kind: "error"; out: Outgoing[] }
  /** Needs the server (D1 / Battle DO): the Durable Object finishes it. */
  | { kind: "intent"; presence: Presence; msg: Extract<WorldClientMessage, { t: "engage" | "resume" | "autoHunt" | "autoStop" }>; out: Outgoing[] };

export class MapChannel {
  private readonly players = new Map<string, Presence>();

  constructor(
    private readonly rules: RulesConfig,
    readonly map: MapDefinition,
    readonly channel: number,
    restored: Presence[] = [],
    private readonly newSid: () => string = () => crypto.randomUUID().slice(0, 8),
  ) {
    for (const p of restored) this.players.set(p.accountId, p);
  }

  get size(): number {
    return this.players.size;
  }

  get(accountId: string): Presence | undefined {
    return this.players.get(accountId);
  }

  all(): Presence[] {
    return [...this.players.values()];
  }

  /**
   * Enter the channel at `pos` (from the canonical saved position). An account already here keeps
   * its live position and public id: the old connection is replaced, nobody sees a second player.
   */
  join(accountId: string, name: string, pos: TilePos, now: number): JoinResult {
    const existing = this.players.get(accountId);
    if (existing === undefined && this.players.size >= this.rules.provisional.channelCapacity.value) {
      return { ok: false, code: "CHANNEL_FULL", message: `channel ${this.channel} is full` };
    }
    const presence: Presence = existing ?? {
      accountId,
      sid: this.newSid(),
      name,
      pos: { ...pos },
      facing: "S",
      readyAt: now,
      lastSeq: 0,
      dirty: false,
      battleId: null,
    };
    // A fresh connection starts its own step numbering.
    presence.lastSeq = 0;
    this.players.set(accountId, presence);
    const out: Outgoing[] = [
      {
        to: "self",
        msg: {
          t: "welcome",
          mapId: this.map.id,
          channel: this.channel,
          rulesVersion: this.rules.rulesVersion,
          self: publicPlayer(presence),
          others: this.all()
            .filter((p) => p.accountId !== accountId)
            .map(publicPlayer),
        },
      },
    ];
    if (existing === undefined) out.push({ to: "others", msg: { t: "joined", player: publicPlayer(presence) } });
    return { ok: true, presence, replaced: existing !== undefined, out };
  }

  /** Handle one untrusted client message. */
  handle(accountId: string, raw: unknown, now: number): StepOutcome {
    const parsed = WorldClientMessageSchema.safeParse(raw);
    if (!parsed.success) return { kind: "error", out: [{ to: "self", msg: { t: "error", code: "INVALID_MESSAGE", message: "malformed message" } }] };
    const p = this.players.get(accountId);
    if (p === undefined) return { kind: "error", out: [{ to: "self", msg: { t: "error", code: "NOT_JOINED", message: "join first" } }] };
    const msg = parsed.data;
    if (msg.t === "ping") return { kind: "rejected", out: [{ to: "self", msg: { t: "pong", serverTime: now } }] };
    if (msg.t === "engage" || msg.t === "resume" || msg.t === "autoHunt" || msg.t === "autoStop") return { kind: "intent", presence: p, msg, out: [] };
    return this.step(p, msg.seq, msg.dir, now);
  }

  /** Mark a player as in (or out of) a private fight. */
  setBattle(accountId: string, battleId: string | null): Presence | null {
    const p = this.players.get(accountId);
    if (p === undefined) return null;
    p.battleId = battleId;
    return p;
  }

  private step(p: Presence, seq: number, dir: Direction, now: number): StepOutcome {
    if (seq <= p.lastSeq) {
      return { kind: "rejected", out: [{ to: "self", msg: { t: "correct", seq, x: p.pos.x, y: p.pos.y, reason: "STALE_SEQ" } }] };
    }
    p.lastSeq = seq;
    if (p.battleId !== null) {
      return { kind: "rejected", out: [{ to: "self", msg: { t: "correct", seq, x: p.pos.x, y: p.pos.y, reason: "IN_BATTLE" } }] };
    }
    const r = tryStep(this.rules, this.map, p.pos, dir, p.readyAt, now);
    if (!r.ok) {
      return { kind: "rejected", out: [{ to: "self", msg: { t: "correct", seq, x: p.pos.x, y: p.pos.y, reason: r.reason } }] };
    }
    p.pos = r.pos;
    p.readyAt = r.readyAt;
    p.facing = artFacing(dir);
    p.dirty = true;
    return {
      kind: "moved",
      presence: p,
      portal: portalAt(this.map, p.pos.x, p.pos.y),
      out: [
        { to: "self", msg: { t: "ack", seq, x: p.pos.x, y: p.pos.y } },
        { to: "others", msg: { t: "moved", sid: p.sid, x: p.pos.x, y: p.pos.y, facing: p.facing } },
      ],
    };
  }

  /**
   * A step the server takes for the player (Auto Hunt). Same tile, corner and speed rules as a
   * client step; the player is told with `autoMoved` instead of an ack.
   */
  autoStep(accountId: string, dir: Direction, now: number): StepOutcome {
    const p = this.players.get(accountId);
    if (p === undefined) return { kind: "error", out: [] };
    if (p.battleId !== null) return { kind: "rejected", out: [] };
    const r = tryStep(this.rules, this.map, p.pos, dir, p.readyAt, now);
    if (!r.ok) return { kind: "rejected", out: [] };
    p.pos = r.pos;
    p.readyAt = r.readyAt;
    p.facing = artFacing(dir);
    p.dirty = true;
    return {
      kind: "moved",
      presence: p,
      portal: portalAt(this.map, p.pos.x, p.pos.y),
      out: [
        { to: "self", msg: { t: "autoMoved", x: p.pos.x, y: p.pos.y, facing: p.facing } },
        { to: "others", msg: { t: "moved", sid: p.sid, x: p.pos.x, y: p.pos.y, facing: p.facing } },
      ],
    };
  }

  /** Remove a player (disconnect, portal, eviction). Others see them leave. */
  leave(accountId: string): { presence: Presence | null; out: Outgoing[] } {
    const p = this.players.get(accountId);
    if (p === undefined) return { presence: null, out: [] };
    this.players.delete(accountId);
    return { presence: p, out: [{ to: "others", msg: { t: "left", sid: p.sid } }] };
  }
}
