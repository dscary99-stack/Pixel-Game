/**
 * Runs the D1 migration and RewardLedger SQL on node:sqlite through a tiny D1-shaped adapter.
 * This checks SQL and idempotency logic; it is not a substitute for testing on real D1.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES, type Entitlement } from "@pmrpg/shared";
import { RewardLedger, type SqlBound, type SqlDb } from "../src/reward-ledger";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type Db = InstanceType<typeof DatabaseSync>;

class SqliteD1 implements SqlDb {
  constructor(readonly db: Db) {}
  prepare(sql: string) {
    const db = this.db;
    return {
      bind(...values: unknown[]): SqlBound & { exec(): void } {
        const params = values as (string | number | null)[];
        return {
          exec: () => void db.prepare(sql).run(...params),
          run: async () => db.prepare(sql).run(...params),
          first: async <T>() => (db.prepare(sql).get(...params) ?? null) as T | null,
        };
      },
    };
  }
  /** D1 batch semantics: all statements in one transaction, rolled back on any error. */
  async batch(statements: SqlBound[]): Promise<unknown[]> {
    this.db.exec("BEGIN");
    try {
      for (const s of statements) (s as SqlBound & { exec(): void }).exec();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return [];
  }
}

const migration = readFileSync(new URL("../migrations/0001_phase_a_core.sql", import.meta.url), "utf8");

let db: Db;
let ledger: RewardLedger;
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migration);
  db.prepare("INSERT INTO accounts (id, created_at) VALUES (?, ?)").run("acct:1", "2026-10-03T00:00:00Z");
  ledger = new RewardLedger(new SqliteD1(db), PRODUCTION_RULES, () => "2026-10-03T00:00:00Z");
});

const kill: Entitlement = {
  entitlementId: "battle:1:e1:defeated",
  kind: "kill",
  enemyUnitId: "e1",
  speciesId: "species:armor_crab",
  originMode: "manual",
  items: [
    { itemId: "item:crab_shell", quantity: 2 },
    { itemId: "item:river_pebble", quantity: 1 },
  ],
};
const capture: Entitlement = {
  entitlementId: "battle:1:e2:captured",
  kind: "capture",
  enemyUnitId: "e2",
  speciesId: "species:ember_fox",
  element: "WIND",
  level: 1,
};

const balance = (item: string) =>
  (db.prepare("SELECT quantity FROM inventory_balances WHERE account_id = 'acct:1' AND item_id = ?").get(item) as { quantity: number } | undefined)?.quantity ?? 0;

describe("RewardLedger on the D1 migration", () => {
  it("grants a kill reward once; a retry is already_granted and changes nothing", async () => {
    expect(await ledger.grant(kill, "acct:1")).toMatchObject({ status: "granted" });
    expect(await ledger.grant(kill, "acct:1")).toMatchObject({ status: "already_granted" });
    expect(balance("item:crab_shell")).toBe(2);
    expect(balance("item:river_pebble")).toBe(1);
  });

  it("refuses the same entitlement id with a different payload", async () => {
    await ledger.grant(kill, "acct:1");
    const tampered = { ...kill, items: [{ itemId: "item:crab_shell", quantity: 99 }] };
    expect(await ledger.grant(tampered, "acct:1")).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
    expect(balance("item:crab_shell")).toBe(2);
  });

  it("creates one Lv1, Bond 0 companion from a capture, even if delivered twice", async () => {
    await ledger.grant(capture, "acct:1");
    await ledger.grant(capture, "acct:1");
    const rows = db.prepare("SELECT current_level, bond, element, owner_id FROM monster_instances").all();
    expect(rows).toEqual([{ current_level: 1, bond: 0, element: "WIND", owner_id: "acct:1" }]);
  });

  it("rolls the whole grant back if any write fails (no receipt without items)", async () => {
    const bad = { ...kill, entitlementId: "battle:1:e9:defeated", items: [{ itemId: "item:x", quantity: 1 }] };
    // Unknown recipient violates the accounts foreign key inside the batch.
    await expect(ledger.grant(bad, "acct:missing")).rejects.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM reward_receipts").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM item_ledger").get()).toEqual({ n: 0 });
  });

  it("allows only one unfinished battle reservation per account", () => {
    const ins = db.prepare(
      "INSERT INTO battle_reservations (reservation_id, account_id, battle_id, status, loadout_json, bag_json, created_at, updated_at) VALUES (?, 'acct:1', ?, ?, '{}', '{}', 't', 't')",
    );
    ins.run("r1", "b1", "active");
    expect(() => ins.run("r2", "b2", "reserved")).toThrow();
    ins.run("r3", "b3", "settled");
  });
});
