/**
 * Battle Durable Object: one object per battle (chapter 11 §1). Wraps BattleRoom with DO storage.
 * DO storage.put(entries) is atomic, and the DO handles one request at a time per object,
 * which is what BattleRoom's read-check-write relies on.
 *
 * The settlement outbox is drained from the DO alarm, never inline with a player request, so a
 * slow or failing D1 never delays combat acks and only one drain runs at a time per battle.
 */
import { DurableObject } from "cloudflare:workers";
import { DEV_FIXTURE_RULES, PRODUCTION_RULES, exampleContentMaps, type BattleSetup } from "@pmrpg/shared";
import { BattleRoom, RoomError, type Environment, type OutboxSummary, type RoomStorage } from "./battle-room";
import { Economy } from "./economy";

/** PROVISIONAL ops setting (not a game rule): wait between outbox retries while D1 is failing. */
const OUTBOX_RETRY_MS = 5_000;

export interface Env {
  BATTLE: DurableObjectNamespace<BattleDurableObject>;
  DB: D1Database;
  ENVIRONMENT: Environment;
  /** "true" only in local dev: lets x-dev-account stand in for auth (O11 auth provider not chosen). */
  DEV_AUTH?: string;
}

class DoStorage implements RoomStorage {
  constructor(private readonly s: DurableObjectStorage) {}
  get<T>(key: string): Promise<T | undefined> {
    return this.s.get<T>(key);
  }
  putMany(entries: Record<string, unknown>): Promise<void> {
    return this.s.put(entries);
  }
  list<T>(prefix: string): Promise<Map<string, T>> {
    return this.s.list<T>({ prefix });
  }
}

export class BattleDurableObject extends DurableObject<Env> {
  private readonly room: BattleRoom;
  private readonly economy: Economy;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Fixture rules (OPEN values filled) exist only in dev; BattleRoom refuses them elsewhere.
    const rules = env.ENVIRONMENT === "dev" ? DEV_FIXTURE_RULES : PRODUCTION_RULES;
    // Phase A ships EXAMPLE content only; a versioned content bundle replaces this later.
    this.room = new BattleRoom(new DoStorage(ctx.storage), rules, exampleContentMaps(), env.ENVIRONMENT);
    this.economy = new Economy(env.DB, rules);
  }

  /** Reconciler only (never routed from a player request). See BattleRoom.probe. */
  async probe(): Promise<"started" | "voided"> {
    return this.room.probe();
  }

  override async alarm(): Promise<void> {
    await this.room.drainOutbox(this.economy);
    // Re-read rather than trust the drain's snapshot: a command may have queued more meanwhile.
    // A refused entry (failed) blocks settlement until an operator acts, so retrying is pointless.
    const r = await this.room.outbox();
    if (r.pending > 0 && r.failed === 0) await this.ctx.storage.setAlarm(Date.now() + OUTBOX_RETRY_MS);
  }

  private async kickOutbox(): Promise<OutboxSummary> {
    const r = await this.room.outbox();
    if (r.pending > 0 && r.failed === 0 && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
    return r;
  }

  /** Called by the Worker after it authenticated the caller. accountId never comes from the body. */
  async handle(accountId: string, op: RoomOp): Promise<RoomReply> {
    try {
      switch (op.kind) {
        case "create": {
          if (op.setup.player.accountId !== accountId) return { ok: false, code: "NOT_OWNER", message: "setup owner mismatch" };
          const body = await this.room.create(op.setup, op.reservationId);
          await this.kickOutbox();
          return { ok: true, body };
        }
        case "claim":
          return { ok: true, body: { sessionGeneration: await this.room.claimSession(accountId) } };
        case "view":
          return { ok: true, body: { state: await this.room.view(accountId), actor: await this.room.actor(), settlement: await this.kickOutbox() } };
        case "events":
          await this.room.view(accountId);
          return { ok: true, body: { events: await this.room.eventsSince(op.cursor) } };
        case "command":
        case "auto": {
          const body = await this.room.command(accountId, op.body, op.kind === "auto" ? "auto" : "player");
          await this.kickOutbox();
          return { ok: true, body };
        }
      }
    } catch (e) {
      if (e instanceof RoomError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  }
}

export type RoomOp =
  | { kind: "create"; setup: BattleSetup; reservationId: string }
  | { kind: "claim" }
  | { kind: "view" }
  | { kind: "events"; cursor: number }
  | { kind: "command"; body: unknown }
  | { kind: "auto"; body: unknown };

export type RoomReply = { ok: true; body: unknown } | { ok: false; code: string; message: string };
