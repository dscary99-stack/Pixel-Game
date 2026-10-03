/**
 * Battle Durable Object: one object per battle (chapter 11 §1). Wraps BattleRoom with DO storage.
 * DO storage.put(entries) is atomic, and the DO handles one request at a time per object,
 * which is what BattleRoom's read-check-write relies on.
 */
import { DurableObject } from "cloudflare:workers";
import { DEV_FIXTURE_RULES, PRODUCTION_RULES, exampleContentMaps, type BattleSetup } from "@pmrpg/shared";
import { BattleRoom, RoomError, type Environment, type RoomStorage } from "./battle-room";

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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Fixture rules (OPEN values filled) exist only in dev; BattleRoom refuses them elsewhere.
    const rules = env.ENVIRONMENT === "dev" ? DEV_FIXTURE_RULES : PRODUCTION_RULES;
    // Phase A ships EXAMPLE content only; a versioned content bundle replaces this later.
    this.room = new BattleRoom(new DoStorage(ctx.storage), rules, exampleContentMaps(), env.ENVIRONMENT);
  }

  /** Called by the Worker after it authenticated the caller. accountId never comes from the body. */
  async handle(accountId: string, op: RoomOp): Promise<RoomReply> {
    try {
      switch (op.kind) {
        case "create":
          if (op.setup.player.accountId !== accountId) return { ok: false, code: "NOT_OWNER", message: "setup owner mismatch" };
          return { ok: true, body: await this.room.create(op.setup) };
        case "claim":
          return { ok: true, body: { sessionGeneration: await this.room.claimSession(accountId) } };
        case "view":
          return { ok: true, body: { state: await this.room.view(accountId), actor: await this.room.actor() } };
        case "events":
          await this.room.view(accountId);
          return { ok: true, body: { events: await this.room.eventsSince(op.cursor) } };
        case "command":
          return { ok: true, body: await this.room.command(accountId, op.body, "player") };
        case "auto":
          return { ok: true, body: await this.room.command(accountId, op.body, "auto") };
      }
    } catch (e) {
      if (e instanceof RoomError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  }
}

export type RoomOp =
  | { kind: "create"; setup: BattleSetup }
  | { kind: "claim" }
  | { kind: "view" }
  | { kind: "events"; cursor: number }
  | { kind: "command"; body: unknown }
  | { kind: "auto"; body: unknown };

export type RoomReply = { ok: true; body: unknown } | { ok: false; code: string; message: string };
