/**
 * Server-authoritative battle room (chapter 11 §2–§3, chapter 12 §4).
 *
 * Transport- and platform-agnostic so it can be tested without Cloudflare. The Battle Durable
 * Object (battle-do.ts) wraps it with real storage. Responsibilities here, not in the kernel:
 * - auth-derived ownership (accountId comes from the server's auth, never the request body)
 * - session generation (a newer session revokes commands from an older one; P14)
 * - commandId idempotency (a retry returns the stored answer; nothing is re-rolled or re-used)
 * - expectedStateVersion (STALE_STATE)
 * - persisting state + events + the answer in one atomic write before acking
 */
import {
  CommandEnvelopeSchema,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  publicView,
  type BattleCommand,
  type BattleContent,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type CommandResponse,
  type ErrorCode,
  type PublicBattleState,
  type RulesConfig,
} from "@pmrpg/shared";
import { z } from "zod";

/** Minimal storage contract. `putMany` must be atomic (DO storage.put(entries) is). */
export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  putMany(entries: Record<string, unknown>): Promise<void>;
  list<T>(prefix: string): Promise<Map<string, T>>;
}

export type Environment = "dev" | "staging" | "production";

interface StoredCommand {
  payload: string;
  response: CommandResponse;
}

const K = {
  state: "state",
  session: (account: string) => `session:${account}`,
  command: (id: string) => `cmd:${id}`,
  event: (seq: number) => `ev:${String(seq).padStart(8, "0")}`,
};

export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class BattleRoom {
  constructor(
    private readonly storage: RoomStorage,
    private readonly rules: RulesConfig,
    private readonly content: BattleContent,
    env: Environment,
  ) {
    // Chapter 12 validator 8: OPEN rules filled by fixtures never run outside dev.
    if (env !== "dev" && rules.fixtureOverrides.length > 0) {
      throw new RoomError("FIXTURE_RULES_IN_PRODUCTION", `fixture overrides present: ${rules.fixtureOverrides.join(", ")}`);
    }
  }

  /** Idempotent: creating the same battle twice returns the existing one. */
  async create(setup: BattleSetup): Promise<{ state: PublicBattleState; events: BattleEvent[] }> {
    const existing = await this.storage.get<BattleState>(K.state);
    if (existing !== undefined) {
      if (existing.battleId !== setup.battleId) throw new RoomError("INVALID_COMMAND", "room already holds another battle");
      return { state: publicView(existing), events: await this.eventsSince(0) };
    }
    const r = createBattle(this.rules, this.content, setup);
    if (!r.ok) throw new RoomError(r.code, r.message);
    await this.storage.putMany({ [K.state]: r.state, ...eventEntries(r.events), [K.session(setup.player.accountId)]: 0 });
    return { state: publicView(r.state), events: r.events };
  }

  /** A reconnect claims a new generation; commands from older generations are refused. */
  async claimSession(accountId: string): Promise<number> {
    const state = await this.requireState();
    if (state.ownerAccountId !== accountId) throw new RoomError("NOT_OWNER", "not your battle");
    const next = ((await this.storage.get<number>(K.session(accountId))) ?? 0) + 1;
    await this.storage.putMany({ [K.session(accountId)]: next });
    return next;
  }

  async view(accountId: string): Promise<PublicBattleState> {
    const state = await this.requireState();
    if (state.ownerAccountId !== accountId) throw new RoomError("NOT_OWNER", "not your battle");
    return publicView(state);
  }

  async eventsSince(cursor: number): Promise<BattleEvent[]> {
    const all = await this.storage.list<BattleEvent>("ev:");
    return [...all.values()].filter((e) => e.seq > cursor).sort((a, b) => a.seq - b.seq);
  }

  /**
   * A player command. `accountId` is the authenticated caller. `raw` is the untrusted body.
   * Auto Battle uses `kind: "auto"`: the server picks the action, and the client's heartbeat
   * request is what drives it, so nothing runs while the client is closed (C14, no offline farming).
   */
  async command(accountId: string, raw: unknown, kind: "player" | "auto" = "player"): Promise<CommandResponse> {
    const parsed = kind === "auto" ? AutoEnvelope.safeParse(raw) : CommandEnvelopeSchema.safeParse(raw);
    const commandId = typeof (raw as { commandId?: unknown })?.commandId === "string" ? (raw as { commandId: string }).commandId : "";
    const state = await this.requireState();
    const rejectNow = (code: ErrorCode, message: string): CommandResponse => ({
      status: "rejected",
      commandId,
      reasonCode: code,
      message,
      stateVersion: state.stateVersion,
      eventCursor: state.eventSeq,
    });
    if (!parsed.success) return rejectNow("INVALID_COMMAND", "malformed command");
    const env = parsed.data;
    if (state.ownerAccountId !== accountId) return rejectNow("NOT_OWNER", "not your battle");

    const payload = JSON.stringify({ kind, env });
    const stored = await this.storage.get<StoredCommand>(K.command(env.commandId));
    if (stored !== undefined) {
      if (stored.payload !== payload) return rejectNow("INVALID_COMMAND", "commandId reused with a different payload");
      return stored.response.status === "accepted" ? { ...stored.response, replayed: true } : stored.response;
    }

    const generation = (await this.storage.get<number>(K.session(accountId))) ?? 0;
    if (env.sessionGeneration !== generation) return rejectNow("SESSION_REVOKED", "an older session cannot command this battle");
    if (env.expectedStateVersion !== state.stateVersion) return rejectNow("STALE_STATE", `state is at v${state.stateVersion}`);

    let command: BattleCommand | null;
    if ("command" in env) command = env.command as BattleCommand;
    else {
      command = chooseAutoCommand(state);
      if (command === null) return rejectNow("BATTLE_OVER", "nothing to do");
    }
    const r = applyCommand(this.rules, this.content, state, command, { source: kind, causeId: env.commandId });
    if (!r.ok) {
      const response = rejectNow(r.code, r.message);
      await this.storage.putMany({ [K.command(env.commandId)]: { payload, response } satisfies StoredCommand });
      return response;
    }
    const response: CommandResponse = {
      status: "accepted",
      commandId: env.commandId,
      stateVersion: r.state.stateVersion,
      eventCursor: r.state.eventSeq,
      events: r.events,
      replayed: false,
    };
    // One atomic write: state, events and the stored answer. Ack only after it lands.
    await this.storage.putMany({
      [K.state]: r.state,
      ...eventEntries(r.events),
      [K.command(env.commandId)]: { payload, response } satisfies StoredCommand,
    });
    return response;
  }

  /** Whose turn it is, for the client UI. */
  async actor(): Promise<string | null> {
    return currentActor(await this.requireState())?.unitId ?? null;
  }

  private async requireState(): Promise<BattleState> {
    const s = await this.storage.get<BattleState>(K.state);
    if (s === undefined) throw new RoomError("INVALID_COMMAND", "no battle in this room");
    return s;
  }
}

const AutoEnvelope = z
  .object({ commandId: z.string().uuid(), sessionGeneration: z.number().int().min(0), expectedStateVersion: z.number().int().min(0) })
  .strict();

function eventEntries(events: BattleEvent[]): Record<string, BattleEvent> {
  return Object.fromEntries(events.map((e) => [K.event(e.seq), e]));
}

/** In-memory storage for tests and local preview. Copies values like a real store would. */
export class MemoryStorage implements RoomStorage {
  readonly data = new Map<string, unknown>();
  /** Set to make the next putMany throw, to simulate a crash before persist. */
  failNextWrite = false;
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async putMany(entries: Record<string, unknown>): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated storage failure");
    }
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v));
  }
  async list<T>(prefix: string): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const [k, v] of this.data) if (k.startsWith(prefix)) out.set(k, structuredClone(v) as T);
    return out;
  }
}
