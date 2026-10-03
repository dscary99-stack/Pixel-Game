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

// ---------------------------------------------------------------- wire protocol

export const WorldClientMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("step"), seq: z.number().int().min(1).max(2 ** 31), dir: z.enum(DIRECTIONS) }).strict(),
  z.object({ t: z.literal("ping") }).strict(),
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
  | { t: "correct"; seq: number; x: number; y: number; reason: StepRejection | "STALE_SEQ" }
  | { t: "transfer"; mapId: string; channel: number }
  | { t: "kicked"; reason: "REPLACED" | "EVICTED" }
  | { t: "error"; code: WorldErrorCode; message: string }
  | { t: "pong"; serverTime: number };

export type WorldErrorCode =
  | "INVALID_MESSAGE"
  | "NOT_JOINED"
  | "CHANNEL_FULL"
  | "WRONG_MAP"
  | "NO_ACCOUNT"
  | "UNKNOWN_MAP"
  | "UNKNOWN_CHANNEL"
  | "SESSION_REPLACED";

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
  | { kind: "error"; out: Outgoing[] };

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
    return this.step(p, msg.seq, msg.dir, now);
  }

  private step(p: Presence, seq: number, dir: Direction, now: number): StepOutcome {
    if (seq <= p.lastSeq) {
      return { kind: "rejected", out: [{ to: "self", msg: { t: "correct", seq, x: p.pos.x, y: p.pos.y, reason: "STALE_SEQ" } }] };
    }
    p.lastSeq = seq;
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

  /** Remove a player (disconnect, portal, eviction). Others see them leave. */
  leave(accountId: string): { presence: Presence | null; out: Outgoing[] } {
    const p = this.players.get(accountId);
    if (p === undefined) return { presence: null, out: [] };
    this.players.delete(accountId);
    return { presence: p, out: [{ to: "others", msg: { t: "left", sid: p.sid } }] };
  }
}
