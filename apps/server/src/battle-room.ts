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
 * - the settlement outbox: activation, every entitlement and the final settlement are written as
 *   outbox entries in that same atomic write, then delivered to the economy service (D1) with
 *   retries until each has a receipt (chapter 11 §3 steps 3, 6–8)
 */
import {
  CommandEnvelopeSchema,
  applyCommand,
  chooseAutoCommand,
  AutoBattlePolicySchema,
  NO_AUTO_POLICY,
  type AutoBattlePolicy,
  type AutoBattlePolicyInput,
  createBattle,
  currentActor,
  publicView,
  secretFightFacts,
  type BattleCommand,
  type BattleContent,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type CommandResponse,
  type Entitlement,
  type ErrorCode,
  type PublicBattleState,
  type RulesConfig,
} from "@pmrpg/shared";
import { z } from "zod";
import type { ActivateResult, Settlement, SettleResult } from "./economy";
import type { GrantResult } from "./reward-ledger";

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

/** The part of the economy service (economy.ts) the battle journal delivers to. */
export interface EconomyPort {
  activate(reservationId: string): Promise<ActivateResult>;
  grant(entitlement: Entitlement, recipientId: string): Promise<GrantResult>;
  settle(settlement: Settlement): Promise<SettleResult>;
}

/**
 * One delivery owed to the economy service. `pending` until a receipt (or an equivalent
 * "already done" answer) comes back; `failed` when the economy refused it for good, which stops
 * settlement and needs an operator, never a silent re-roll.
 */
export type OutboxEntry =
  | { kind: "activate"; reservationId: string; status: OutboxStatus; detail?: string }
  | { kind: "grant"; entitlement: Entitlement; recipientId: string; status: OutboxStatus; detail?: string }
  | { kind: "settle"; settlement: Settlement; status: OutboxStatus; detail?: string };
export type OutboxStatus = "pending" | "delivered" | "failed";

export interface OutboxSummary {
  pending: number;
  delivered: number;
  failed: number;
  /** True once the final settlement reached the economy service. */
  settled: boolean;
}

const K = {
  state: "state",
  reservation: "reservation",
  /** Auto Hunt: the server plays the ally turns itself, one per alarm tick. */
  autopilot: "autopilot",
  autopolicy: "autopolicy",
  lastAutoAt: "lastAutoAt",
  /** Written by the reconciler's probe when no battle exists; the battle can never start after it. */
  voided: "voided",
  session: (account: string) => `session:${account}`,
  command: (id: string) => `cmd:${id}`,
  event: (seq: number) => `ev:${String(seq).padStart(8, "0")}`,
  outbox: "out:",
  activate: "out:0:activate",
  grant: (entitlementId: string) => `out:1:grant:${entitlementId}`,
  settle: "out:2:settle",
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
    private readonly now: () => number = Date.now,
  ) {
    // Chapter 12 validator 8: OPEN rules filled by fixtures never run outside dev.
    if (env !== "dev" && rules.fixtureOverrides.length > 0) {
      throw new RoomError("FIXTURE_RULES_IN_PRODUCTION", `fixture overrides present: ${rules.fixtureOverrides.join(", ")}`);
    }
  }

  /**
   * Idempotent: creating the same battle twice returns the existing one.
   * `reservationId` is the economy reservation (D1) that holds this battle's bag and companions;
   * the setup's bag must be the reserved bag. Activation is queued in the same write.
   */
  async create(setup: BattleSetup, reservationId: string): Promise<{ state: PublicBattleState; events: BattleEvent[] }> {
    const existing = await this.storage.get<BattleState>(K.state);
    if (existing !== undefined) {
      if (existing.battleId !== setup.battleId) throw new RoomError("INVALID_COMMAND", "room already holds another battle");
      if ((await this.storage.get<string>(K.reservation)) !== reservationId) throw new RoomError("INVALID_COMMAND", "battle holds another reservation");
      return { state: publicView(existing), events: await this.eventsSince(0) };
    }
    if ((await this.storage.get<boolean>(K.voided)) === true) {
      throw new RoomError("RESERVATION_RELEASED", "this battle was voided and its reservation released");
    }
    const r = createBattle(this.rules, this.content, setup);
    if (!r.ok) throw new RoomError(r.code, r.message);
    await this.storage.putMany({
      [K.state]: r.state,
      ...eventEntries(r.events),
      [K.session(setup.player.accountId)]: 0,
      [K.reservation]: reservationId,
      [K.activate]: { kind: "activate", reservationId, status: "pending" } satisfies OutboxEntry,
    });
    return { state: publicView(r.state), events: r.events };
  }

  /**
   * Reconciler probe for a reservation that was never activated. If the battle exists it has
   * started (activation is just not delivered yet) and nothing may be released. If not, the room
   * records a tombstone first, so a late create can never start a battle whose items went back.
   */
  async probe(): Promise<"started" | "voided"> {
    if ((await this.storage.get<BattleState>(K.state)) !== undefined) return "started";
    await this.storage.putMany({ [K.voided]: true });
    return "voided";
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
      // Auto Battle runs at the server's cadence, the same as Auto Hunt (chapter 08); a faster
      // client gets TOO_FAST and simply asks again. A little slack absorbs network jitter.
      const last = await this.storage.get<number>(K.lastAutoAt);
      const gap = this.rules.provisional.autoBattleActionMs.value - AUTO_JITTER_MS;
      if (last !== undefined && this.now() - last < gap) return rejectNow("TOO_FAST", `Auto acts once per ${this.rules.provisional.autoBattleActionMs.value} ms`);
      command = chooseAutoCommand(state, this.content, env.policy, this.rules);
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
    // One atomic write: state, events, the stored answer and what the economy is now owed.
    // Ack only after it lands.
    await this.storage.putMany({
      [K.state]: r.state,
      ...eventEntries(r.events),
      [K.command(env.commandId)]: { payload, response } satisfies StoredCommand,
      ...(kind === "auto" ? { [K.lastAutoAt]: this.now() } : {}),
      ...(await this.outboxFor(r.state, r.events)),
    });
    return response;
  }

  /**
   * Auto Hunt switch, set by the Map Channel for the owner. Off hands the fight back to the player;
   * the reward mode fixed at the start never changes (chapter 08).
   */
  async setAutopilot(accountId: string, on: boolean, policy: AutoBattlePolicyInput = {}): Promise<void> {
    const state = await this.requireState();
    if (state.ownerAccountId !== accountId) throw new RoomError("NOT_OWNER", "not your battle");
    await this.storage.putMany({ [K.autopilot]: on, [K.autopolicy]: AutoBattlePolicySchema.parse(policy) });
  }

  async autopilot(): Promise<boolean> {
    return (await this.storage.get<boolean>(K.autopilot)) === true;
  }

  /**
   * One Auto Hunt action: the same Auto Battle choice and validation as a player's Auto, written
   * the same way (state, events and what the economy is owed in one write). The Battle DO alarm
   * paces these; nothing runs once the Map Channel turns autopilot off (disconnect, stop).
   */
  async autopilotStep(): Promise<"acted" | "idle" | "over"> {
    if (!(await this.autopilot())) return "idle";
    const state = await this.requireState();
    if (state.status !== "active") return "over";
    const policy = (await this.storage.get<AutoBattlePolicy>(K.autopolicy)) ?? NO_AUTO_POLICY;
    const command = chooseAutoCommand(state, this.content, policy, this.rules);
    if (command === null) return "idle";
    const r = applyCommand(this.rules, this.content, state, command, { source: "auto", causeId: `autopilot:${state.stateVersion}` });
    if (!r.ok) return "idle";
    await this.storage.putMany({ [K.state]: r.state, ...eventEntries(r.events), ...(await this.outboxFor(r.state, r.events)) });
    return r.state.status === "active" ? "acted" : "over";
  }

  /** Outbox entries for the entitlements and the battle end a command produced. */
  private async outboxFor(state: BattleState, events: BattleEvent[]): Promise<Record<string, OutboxEntry>> {
    const out: Record<string, OutboxEntry> = {};
    for (const e of events) {
      if (e.type === "RewardEntitled") {
        out[K.grant(e.entitlement.entitlementId)] = { kind: "grant", entitlement: e.entitlement, recipientId: state.ownerAccountId, status: "pending" };
      } else if (e.type === "BattleEnded") {
        const reservationId = await this.storage.get<string>(K.reservation);
        if (reservationId === undefined) throw new Error("battle has no reservation");
        out[K.settle] = {
          kind: "settle",
          status: "pending",
          settlement: {
            reservationId,
            battleId: state.battleId,
            accountId: state.ownerAccountId,
            outcome: e.outcome,
            unused: e.unusedReserved,
            allies: e.allies,
            entitlementIds: state.entitlements.map((x) => x.entitlementId),
            // Secret quests (secret-progress.ts): what this fight did, from the final state only.
            secret: secretFightFacts(state, (id) => this.content.items.get(id)?.kind === "capture"),
          },
        };
      }
    }
    return out;
  }

  /**
   * Delivers what the economy service is owed, in order: activation, then every entitlement, then
   * the settlement (only once all entitlements have receipts, so items come back and locks open
   * only after rewards are safe). Safe to call repeatedly: every economy call is idempotent, and a
   * crash between a D1 commit and the local mark just gets an "already" answer next time.
   * A transient error leaves the entry pending; the caller schedules the next attempt.
   */
  async drainOutbox(economy: EconomyPort): Promise<OutboxSummary> {
    const entries = await this.storage.list<OutboxEntry>(K.outbox);
    const mark = async (key: string, entry: OutboxEntry, status: OutboxStatus, detail?: string) => {
      const next = { ...entry, status, ...(detail === undefined ? {} : { detail }) } as OutboxEntry;
      entries.set(key, next);
      await this.storage.putMany({ [key]: next });
    };
    const attempt = async (key: string, entry: OutboxEntry, run: () => Promise<OutboxStatus | [OutboxStatus, string]>) => {
      try {
        const r = await run();
        const [status, detail] = Array.isArray(r) ? r : [r, undefined];
        if (status !== "pending") await mark(key, entry, status, detail);
      } catch {
        // Transient (network, D1 busy). Stay pending; the next drain retries the same payload.
      }
    };

    // Keys sort as activate < grants < settle.
    for (const [key, entry] of [...entries].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (entry.status !== "pending") continue;
      if (entry.kind === "activate") {
        await attempt(key, entry, async () => {
          const r = await economy.activate(entry.reservationId);
          return r.status === "active" ? "delivered" : ["failed", `reservation is ${r.current ?? "missing"}`];
        });
        if (entries.get(key)?.status !== "delivered") break;
      } else if (entry.kind === "grant") {
        await attempt(key, entry, async () => {
          const r = await economy.grant(entry.entitlement, entry.recipientId);
          return r.status === "rejected" ? ["failed", r.reason] : "delivered";
        });
      } else {
        const blocked = [...entries].some(([k, e]) => k !== key && e.status !== "delivered");
        if (blocked) break;
        await attempt(key, entry, async () => {
          const r = await economy.settle(entry.settlement);
          if (r.status !== "rejected") return "delivered";
          // Receipts not visible yet is a retry, not a refusal.
          return r.reason === "RECEIPTS_MISSING" ? "pending" : ["failed", r.reason];
        });
      }
    }
    return this.outboxSummary(entries);
  }

  async outbox(): Promise<OutboxSummary> {
    return this.outboxSummary(await this.storage.list<OutboxEntry>(K.outbox));
  }

  private outboxSummary(entries: Map<string, OutboxEntry>): OutboxSummary {
    const all = [...entries.values()];
    const count = (s: OutboxStatus) => all.filter((e) => e.status === s).length;
    return {
      pending: count("pending"),
      delivered: count("delivered"),
      failed: count("failed"),
      settled: all.some((e) => e.kind === "settle" && e.status === "delivered"),
    };
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

/** Slack on the Auto cadence for network jitter. */
const AUTO_JITTER_MS = 100;

const AutoEnvelope = z
  .object({
    commandId: z.string().uuid(),
    sessionGeneration: z.number().int().min(0),
    expectedStateVersion: z.number().int().min(0),
    /** The page's Auto Battle item rules (chapter 08); none = basic attacks only. */
    policy: AutoBattlePolicySchema.optional(),
  })
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
