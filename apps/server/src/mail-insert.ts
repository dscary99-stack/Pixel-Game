/** The one statement that puts a letter in a mailbox (mail-store.ts); kept apart so any store can add it to its own batch. */
import { hasAttachments, mailExpiry, type MailPayload, type MailSource, type RulesConfig } from "@pmrpg/shared";
import type { SqlBound, SqlDb } from "./reward-ledger";

export interface NewLetter {
  mailId: string;
  accountId: string;
  source: MailSource;
  title: string;
  body?: string;
  payload: MailPayload;
}

/**
 * The statement that puts a letter in a mailbox; with `guard` it lands only when that SQL holds (so a
 * sender can make it part of its own batch). The same mail id twice is one letter.
 */
export function mailInsert(db: SqlDb, rules: RulesConfig, l: NewLetter, at: string, guard?: { sql: string; args: unknown[] }): SqlBound {
  return db
    .prepare(
      `INSERT INTO mail (id, account_id, source, title_th, body_th, payload_json, companions, has_assets, created_at, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard?.sql ?? "1"} ON CONFLICT DO NOTHING`,
    )
    .bind(l.mailId, l.accountId, l.source, l.title, l.body ?? "", JSON.stringify(l.payload), l.payload.companions.length, hasAttachments(l.payload) ? 1 : 0, at, mailExpiry(rules, at), ...(guard?.args ?? []));
}
