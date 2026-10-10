/**
 * Runs the D1 migrations on node:sqlite through a tiny D1-shaped adapter.
 * This checks SQL and idempotency logic; it is not a substitute for testing on real D1.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import type { SqlBound, SqlDb } from "../src/reward-ledger";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export type Db = InstanceType<typeof DatabaseSync>;

export class SqliteD1 implements SqlDb {
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
          all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] }),
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


const migrationsDir = new URL("../migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, migrationsDir), "utf8"));

/** A new in-memory database with every migration applied in order, foreign keys on (as on D1). */
export function freshDb(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations) db.exec(sql);
  return db;
}
