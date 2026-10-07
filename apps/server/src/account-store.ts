/**
 * Login accounts on D1 (migration 0026; O10/O11, Nut 2026-10-07). A user signs in with Google, Facebook
 * or a local ID and password, gets a session token, picks one of 10 character places, and from then on
 * every game route runs as that place's play account. Only the token's SHA-256 is stored.
 *
 * Races: a local ID is taken by whichever INSERT lands first (primary key); the loser's empty user row
 * is removed. A character place is created once (primary key on user + slot, unique play account).
 */
import {
  PasswordLoginRequestSchema,
  RegisterRequestSchema,
  SelectCharacterRequestSchema,
  characterSlots,
  playAccountId,
  type AccountView,
  type LoginProvider,
  type RulesConfig,
  type SessionGrant,
} from "@pmrpg/shared";
import type { SqlDb } from "./reward-ledger";

export type AccountRejection = "INVALID_REQUEST" | "LOGIN_ID_TAKEN" | "BAD_CREDENTIALS" | "LOCKED" | "UNAUTHENTICATED";
export type AccountResult<T> = ({ status: "ok" } & T) | { status: "rejected"; reason: AccountRejection; message: string };

export interface Session {
  tokenHash: string;
  userId: string;
  provider: LoginProvider;
  selectedSlot: number | null;
  /** The play account of the selected character place, or null on the character screen. */
  accountId: string | null;
}

const reject = (reason: AccountRejection, message: string) => ({ status: "rejected" as const, reason, message });
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const sha256Hex = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

export async function hashPassword(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** Same-length hex compare without an early exit. */
const sameHex = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export class AccountStore {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly nowMs: () => number = () => Date.now(),
    private readonly newUserId: () => string = () => `u${randomHex(10)}`,
    private readonly newToken: () => string = () => b64url(crypto.getRandomValues(new Uint8Array(32))),
  ) {}

  private get L() {
    return this.rules.provisional.login.value;
  }
  private iso(ms = this.nowMs()) {
    return new Date(ms).toISOString();
  }

  /** Make a local ID; the caller is signed in straight away. */
  async register(raw: unknown): Promise<AccountResult<{ grant: SessionGrant }>> {
    const parsed = RegisterRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", `ID ${this.L.loginIdMin}–${this.L.loginIdMax} of A–Z a–z 0–9 _ . -, password ${this.L.passwordMin}–${this.L.passwordMax}`);
    const { loginId, password } = parsed.data;
    const salt = randomHex(16);
    const iter = this.L.pbkdf2Iterations;
    const hash = await hashPassword(password, salt, iter);
    const userId = await this.claimIdentity("local", loginId, { hash, salt, iter });
    if (userId === null) return reject("LOGIN_ID_TAKEN", "that ID is taken");
    return { status: "ok", grant: await this.startSession(userId, "local") };
  }

  async passwordLogin(raw: unknown): Promise<AccountResult<{ grant: SessionGrant }>> {
    const parsed = PasswordLoginRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("BAD_CREDENTIALS", "wrong ID or password");
    const { loginId, password } = parsed.data;
    const row = await this.db
      .prepare(`SELECT user_id, password_hash, password_salt, password_iter, failed_count, failed_since FROM user_identities WHERE provider = 'local' AND subject = ?`)
      .bind(loginId)
      .first<{ user_id: string; password_hash: string; password_salt: string; password_iter: number; failed_count: number; failed_since: string | null }>();
    const windowStart = this.iso(this.nowMs() - this.L.failedLoginWindowMs);
    if (row === null) {
      // Same work as a real check, so a missing ID does not answer faster.
      await hashPassword(password, "00".repeat(16), this.L.pbkdf2Iterations);
      return reject("BAD_CREDENTIALS", "wrong ID or password");
    }
    if (row.failed_since !== null && row.failed_since >= windowStart && row.failed_count >= this.L.failedLoginLimit) {
      return reject("LOCKED", "too many wrong passwords; try again later");
    }
    const ok = sameHex(await hashPassword(password, row.password_salt, row.password_iter), row.password_hash);
    if (!ok) {
      const now = this.iso();
      await this.db
        .prepare(
          `UPDATE user_identities SET
             failed_count = CASE WHEN failed_since IS NULL OR failed_since < ? THEN 1 ELSE failed_count + 1 END,
             failed_since = CASE WHEN failed_since IS NULL OR failed_since < ? THEN ? ELSE failed_since END
           WHERE provider = 'local' AND subject = ?`,
        )
        .bind(windowStart, windowStart, now, loginId)
        .run();
      return reject("BAD_CREDENTIALS", "wrong ID or password");
    }
    await this.db.prepare(`UPDATE user_identities SET failed_count = 0, failed_since = NULL WHERE provider = 'local' AND subject = ?`).bind(loginId).run();
    return { status: "ok", grant: await this.startSession(row.user_id, "local") };
  }

  /** Google or Facebook, after the provider check: the first sign-in makes the user. */
  async externalLogin(provider: Exclude<LoginProvider, "local">, subject: string): Promise<SessionGrant> {
    const existing = await this.identityUser(provider, subject);
    const userId = existing ?? (await this.claimIdentity(provider, subject, null)) ?? (await this.identityUser(provider, subject));
    if (userId === null) throw new Error("identity vanished");
    return this.startSession(userId, provider);
  }

  async resolve(token: string | null): Promise<Session | null> {
    if (token === null || token.length < 20 || token.length > 200) return null;
    const tokenHash = await sha256Hex(token);
    const row = await this.db
      .prepare(
        `SELECT s.user_id, s.provider, s.selected_slot, c.account_id FROM sessions s
         LEFT JOIN user_characters c ON c.user_id = s.user_id AND c.slot = s.selected_slot
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
      )
      .bind(tokenHash, this.iso())
      .first<{ user_id: string; provider: LoginProvider; selected_slot: number | null; account_id: string | null }>();
    if (row === null) return null;
    return { tokenHash, userId: row.user_id, provider: row.provider, selectedSlot: row.selected_slot, accountId: row.account_id };
  }

  async view(userId: string, selectedSlot: number | null): Promise<AccountView> {
    const { results: ids } = await this.db.prepare(`SELECT provider FROM user_identities WHERE user_id = ? ORDER BY provider`).bind(userId).all<{ provider: LoginProvider }>();
    const { results } = await this.db
      .prepare(
        `SELECT u.slot, ch.name, ch.level, ch.class_id FROM user_characters u
         LEFT JOIN characters ch ON ch.account_id = u.account_id WHERE u.user_id = ?`,
      )
      .bind(userId)
      .all<{ slot: number; name: string | null; level: number | null; class_id: string | null }>();
    const bySlot = new Map(results.map((r) => [r.slot, r]));
    return {
      userId,
      providers: ids.map((r) => r.provider),
      maxCharacters: this.rules.confirmed.maxCharactersPerAccount.value,
      slots: characterSlots(this.rules).map((slot) => {
        const r = bySlot.get(slot);
        return { slot, character: r?.name == null ? null : { name: r.name, level: r.level ?? 1, classId: r.class_id ?? "" } };
      }),
      selectedSlot,
    };
  }

  /**
   * Play one character place (empty or not). The place's play account is made the first time, so the
   * normal character creation (POST /character) then runs on it.
   */
  async select(session: Session, raw: unknown): Promise<AccountResult<{ account: AccountView; accountId: string }>> {
    const parsed = SelectCharacterRequestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.slot > this.rules.confirmed.maxCharactersPerAccount.value) {
      return reject("INVALID_REQUEST", `slot 1–${this.rules.confirmed.maxCharactersPerAccount.value}`);
    }
    const { slot } = parsed.data;
    const accountId = playAccountId(session.userId, slot);
    const at = this.iso();
    await this.db.batch([
      this.db.prepare(`INSERT INTO accounts (id, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(accountId, at),
      this.db.prepare(`INSERT INTO user_characters (user_id, slot, account_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`).bind(session.userId, slot, accountId, at),
      this.db.prepare(`UPDATE sessions SET selected_slot = ? WHERE token_hash = ? AND revoked_at IS NULL`).bind(slot, session.tokenHash),
    ]);
    return { status: "ok", account: await this.view(session.userId, slot), accountId };
  }

  /** Back to the character screen. */
  async deselect(session: Session): Promise<AccountView> {
    await this.db.prepare(`UPDATE sessions SET selected_slot = NULL WHERE token_hash = ?`).bind(session.tokenHash).run();
    return this.view(session.userId, null);
  }

  async logout(session: Session): Promise<void> {
    await this.db.prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`).bind(this.iso(), session.tokenHash).run();
  }

  private async identityUser(provider: LoginProvider, subject: string): Promise<string | null> {
    const r = await this.db.prepare(`SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?`).bind(provider, subject).first<{ user_id: string }>();
    return r?.user_id ?? null;
  }

  /** A new user holding this identity, or null when someone already holds it. */
  private async claimIdentity(provider: LoginProvider, subject: string, password: { hash: string; salt: string; iter: number } | null): Promise<string | null> {
    const userId = this.newUserId();
    const at = this.iso();
    await this.db.batch([
      this.db.prepare(`INSERT INTO users (id, created_at) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM user_identities WHERE provider = ? AND subject = ?)`).bind(userId, at, provider, subject),
      this.db
        .prepare(
          `INSERT INTO user_identities (provider, subject, user_id, password_hash, password_salt, password_iter, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) ON CONFLICT DO NOTHING`,
        )
        .bind(provider, subject, userId, password?.hash ?? null, password?.salt ?? null, password?.iter ?? null, at, userId),
    ]);
    if ((await this.identityUser(provider, subject)) === userId) return userId;
    // Lost a race: drop the user row this call made (nothing refers to it yet).
    await this.db.prepare(`DELETE FROM users WHERE id = ? AND NOT EXISTS (SELECT 1 FROM user_identities WHERE user_id = ?)`).bind(userId, userId).run();
    return null;
  }

  private async startSession(userId: string, provider: LoginProvider): Promise<SessionGrant> {
    const token = this.newToken();
    const now = this.nowMs();
    const expiresAt = this.iso(now + this.L.sessionDays * 86_400_000);
    await this.db
      .prepare(`INSERT INTO sessions (token_hash, user_id, provider, selected_slot, created_at, expires_at) VALUES (?, ?, ?, NULL, ?, ?)`)
      .bind(await sha256Hex(token), userId, provider, this.iso(now), expiresAt)
      .run();
    return { token, expiresAt, account: await this.view(userId, null) };
  }
}
