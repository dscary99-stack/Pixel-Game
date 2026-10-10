/**
 * Login accounts (O10/O11, Nut 2026-10-07) on the D1 migrations (node:sqlite stand-in): local IDs,
 * Google/Facebook checks, sessions, and 10 character places that share nothing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_RULES as R, exampleContentMaps, type RulesConfig } from "@pmrpg/shared";
import { AccountStore, sha256Hex } from "../src/account-store";
import { resolveAccount } from "../src/auth";
import { CharacterStore } from "../src/character-store";
import { TownServices } from "../src/town-services";
import { resetGoogleKeyCache, verifyFacebookToken, verifyGoogleIdToken } from "../src/identity-providers";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

/** Same rules with a cheap hash so the suite stays quick; one test runs the real 100,000. */
const FAST = { ...R, provisional: { ...R.provisional, login: { ...R.provisional.login, value: { ...R.provisional.login.value, pbkdf2Iterations: 1000 } } } } as unknown as RulesConfig;
const T0 = Date.parse("2026-10-07T00:00:00Z");

let db: Db;
let d1: SqliteD1;
let now: number;
let accounts: AccountStore;
let n = 0;

beforeEach(() => {
  db = freshDb();
  d1 = new SqliteD1(db);
  now = T0;
  accounts = new AccountStore(d1, FAST, () => now, () => `u${String(++n).padStart(20, "0")}`);
});

const register = async (loginId = "Nut_01", password = "correct horse") => {
  const r = await accounts.register({ loginId, password });
  if (r.status !== "ok") throw new Error(r.reason);
  return r.grant;
};
const sessionOf = async (token: string) => (await accounts.resolve(token))!;

describe("local ID (O11)", () => {
  it("register signs in; the ID is case-insensitive; the password is stored only as a PBKDF2 hash", async () => {
    const g = await register();
    expect(g.account).toMatchObject({ providers: ["local"], maxCharacters: 10, selectedSlot: null });
    expect(g.account.slots).toHaveLength(10);
    expect(g.account.slots.every((s) => s.character === null)).toBe(true);
    const row = db.prepare("SELECT subject, password_hash, password_iter FROM user_identities").get() as Record<string, unknown>;
    expect(row).toMatchObject({ subject: "nut_01", password_iter: 1000 });
    expect(String(row.password_hash)).not.toContain("correct");
    expect(db.prepare("SELECT token_hash FROM sessions").get()).toEqual({ token_hash: await sha256Hex(g.token) });
    expect(await accounts.passwordLogin({ loginId: "NUT_01", password: "correct horse" })).toMatchObject({ status: "ok" });
  });

  it("bad input and a taken ID are refused; two racing for one ID: one wins, no stray user", async () => {
    expect(await accounts.register({ loginId: "ab", password: "12345678" })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await accounts.register({ loginId: "has space", password: "12345678" })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await accounts.register({ loginId: "abcd", password: "short" })).toMatchObject({ reason: "INVALID_REQUEST" });
    const r = await Promise.all([accounts.register({ loginId: "same", password: "password1" }), accounts.register({ loginId: "SAME", password: "password2" })]);
    expect(r.map((x) => x.status).sort()).toEqual(["ok", "rejected"]);
    expect(r.find((x) => x.status === "rejected")).toMatchObject({ reason: "LOGIN_ID_TAKEN" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
  });

  it("wrong password and unknown ID look the same; 10 wrong in 15 minutes lock that ID until the window passes", async () => {
    await register("lockme", "right password");
    expect(await accounts.passwordLogin({ loginId: "nobody", password: "x" })).toMatchObject({ reason: "BAD_CREDENTIALS", message: "wrong ID or password" });
    for (let i = 0; i < 10; i++) expect(await accounts.passwordLogin({ loginId: "lockme", password: "wrong" })).toMatchObject({ reason: "BAD_CREDENTIALS" });
    expect(await accounts.passwordLogin({ loginId: "lockme", password: "right password" })).toMatchObject({ reason: "LOCKED" });
    now += 15 * 60_000 + 1;
    expect(await accounts.passwordLogin({ loginId: "lockme", password: "right password" })).toMatchObject({ status: "ok" });
    expect(db.prepare("SELECT failed_count FROM user_identities").get()).toEqual({ failed_count: 0 });
  });

  it("production rules hash with 100,000 iterations (the Workers maximum)", async () => {
    const real = new AccountStore(d1, R, () => now);
    const r = await real.register({ loginId: "realhash", password: "password!" });
    expect(r.status).toBe("ok");
    expect(db.prepare("SELECT password_iter FROM user_identities WHERE subject = 'realhash'").get()).toEqual({ password_iter: 100_000 });
    expect(await real.passwordLogin({ loginId: "realhash", password: "password!" })).toMatchObject({ status: "ok" });
  });
});

describe("sessions", () => {
  it("expire after 30 days and end on logout", async () => {
    const g = await register();
    expect(await accounts.resolve(g.token)).not.toBeNull();
    expect(await accounts.resolve("x".repeat(43))).toBeNull();
    now += 30 * 86_400_000;
    expect(await accounts.resolve(g.token)).toBeNull();
    now = T0;
    await accounts.logout(await sessionOf(g.token));
    expect(await accounts.resolve(g.token)).toBeNull();
  });
});

describe("10 characters per account (O10)", () => {
  const content = exampleContentMaps();
  const create = async (accountId: string, name: string) => {
    const r = await new CharacterStore(d1, R, content, () => "2026-10-07T00:00:00Z").create(accountId, {
      operationId: `op_create_${accountId.replace(/[^a-z0-9]/g, "")}`.slice(0, 64),
      name,
      classId: "class:striker",
      raceId: "race:human",
      element: "FIRE",
    });
    expect(r.status).toBe("created");
  };

  it("each place is its own play account: separate characters, coins and bag; a place outside 1–10 is refused", async () => {
    const g = await register();
    const s = await sessionOf(g.token);
    expect(await accounts.select(s, { slot: 11 })).toMatchObject({ reason: "INVALID_REQUEST" });
    expect(await accounts.select(s, { slot: 0 })).toMatchObject({ reason: "INVALID_REQUEST" });
    const one = await accounts.select(s, { slot: 1 });
    if (one.status !== "ok") throw new Error("select");
    expect((await sessionOf(g.token)).accountId).toBe(one.accountId);
    await create(one.accountId, "ดาบ");
    const ten = await accounts.select(s, { slot: 10 });
    if (ten.status !== "ok") throw new Error("select");
    expect(ten.accountId).not.toBe(one.accountId);
    await create(ten.accountId, "เวท");
    const town = new TownServices(d1, R, { ...content, shops: new Map(), recipes: new Map() } as never, ["map:dawn_town"]);
    const start = await town.coins(ten.accountId);
    await town.devGrantCoins("devcoins:one", one.accountId, 500);
    expect(await town.coins(one.accountId)).toBe(start + 500);
    expect(await town.coins(ten.accountId)).toBe(start);
    const view = await accounts.view(s.userId, 10);
    expect(view.slots.filter((x) => x.character !== null).map((x) => [x.slot, x.character!.name])).toEqual([
      [1, "ดาบ"],
      [10, "เวท"],
    ]);
    // Back to the character screen: game routes have no account until a place is picked again.
    await accounts.deselect(s);
    expect((await sessionOf(g.token)).accountId).toBeNull();
  });

  it("another user's places are never reachable, and picking a place twice at once makes it once", async () => {
    const a = await sessionOf((await register("usera")).token);
    const b = await sessionOf((await register("userb")).token);
    const r = await Promise.all([accounts.select(a, { slot: 3 }), accounts.select(a, { slot: 3 })]);
    expect(r.map((x) => x.status)).toEqual(["ok", "ok"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_characters WHERE user_id = ?").get(a.userId)).toEqual({ n: 1 });
    const rb = await accounts.select(b, { slot: 3 });
    expect(rb.status === "ok" && r[0]!.status === "ok" && rb.accountId !== r[0]!.accountId).toBe(true);
  });
});

describe("resolveAccount", () => {
  const env = (over: Record<string, unknown> = {}) => ({ ENVIRONMENT: "production" as const, DB: d1, ...over });

  it("a Bearer token plays the selected place; nothing selected or a bad token gets nothing", async () => {
    const g = await register();
    const bearer = (t: string) => new Request("https://x/character", { headers: { authorization: `Bearer ${t}` } });
    expect(await resolveAccount(bearer(g.token), env())).toBeNull();
    const sel = await accounts.select(await sessionOf(g.token), { slot: 2 });
    expect(await resolveAccount(bearer(g.token), env())).toBe(sel.status === "ok" ? sel.accountId : "");
    expect(await resolveAccount(bearer("z".repeat(43)), env())).toBeNull();
  });

  it("?session= works only on a WebSocket upgrade", async () => {
    const g = await register();
    await accounts.select(await sessionOf(g.token), { slot: 1 });
    const url = `https://x/world/map:dawn_town/1?session=${g.token}`;
    expect(await resolveAccount(new Request(url), env())).toBeNull();
    expect(await resolveAccount(new Request(url, { headers: { Upgrade: "websocket" } }), env())).toMatch(/^acct:u\d+-c1$/);
  });

  it("the dev header is taken only in dev with DEV_AUTH", async () => {
    const req = new Request("https://x/battles/b", { headers: { "x-dev-account": "acct:nut" } });
    expect(await resolveAccount(req, env({ ENVIRONMENT: "dev", DEV_AUTH: "true" }))).toBe("acct:nut");
    expect(await resolveAccount(req, env({ ENVIRONMENT: "dev" }))).toBeNull();
    expect(await resolveAccount(req, env({ DEV_AUTH: "true" }))).toBeNull();
  });
});

describe("Google and Facebook (O11)", () => {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  let keys: CryptoKeyPair;
  let jwk: JsonWebKey;
  const certs = async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] }), { headers: { "cache-control": "max-age=600" } });
  const sign = async (claims: Record<string, unknown>, kid = "k1", key = keys.privateKey) => {
    const head = `${b64({ alg: "RS256", kid })}.${b64(claims)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head));
    return `${head}.${Buffer.from(sig).toString("base64url")}`;
  };
  const good = { iss: "https://accounts.google.com", aud: "client-1", sub: "1122", exp: T0 / 1000 + 600 };

  beforeEach(async () => {
    resetGoogleKeyCache();
    keys = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    jwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey;
  });

  it("Google: a token signed by Google's key for our client is accepted; anything else is not", async () => {
    const opts = { clientId: "client-1", fetch: certs, nowMs: T0 };
    expect(await verifyGoogleIdToken(await sign(good), opts)).toEqual({ ok: true, subject: "1122" });
    expect(await verifyGoogleIdToken(await sign({ ...good, aud: "other" }), opts)).toMatchObject({ ok: false, reason: "INVALID_TOKEN" });
    expect(await verifyGoogleIdToken(await sign({ ...good, iss: "evil.example" }), opts)).toMatchObject({ ok: false });
    expect(await verifyGoogleIdToken(await sign({ ...good, exp: T0 / 1000 - 1 }), opts)).toMatchObject({ ok: false });
    expect(await verifyGoogleIdToken(await sign(good, "k2"), opts)).toMatchObject({ ok: false });
    const other = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    expect(await verifyGoogleIdToken(await sign(good, "k1", other.privateKey), opts)).toMatchObject({ ok: false, message: "bad signature" });
    expect(await verifyGoogleIdToken(await sign(good), { ...opts, clientId: undefined })).toMatchObject({ reason: "NOT_CONFIGURED" });
  });

  it("Facebook: debug_token must say valid and our app", async () => {
    const fb = (data: unknown) => async () => new Response(JSON.stringify({ data }));
    const opts = { appId: "app-1", appSecret: "s", nowMs: T0 };
    const token = "EAAB".padEnd(40, "x");
    expect(await verifyFacebookToken(token, { ...opts, fetch: fb({ is_valid: true, app_id: "app-1", user_id: "998877" }) })).toEqual({ ok: true, subject: "998877" });
    expect(await verifyFacebookToken(token, { ...opts, fetch: fb({ is_valid: true, app_id: "app-2", user_id: "998877" }) })).toMatchObject({ ok: false });
    expect(await verifyFacebookToken(token, { ...opts, fetch: fb({ is_valid: false }) })).toMatchObject({ ok: false });
    expect(await verifyFacebookToken(token, { appId: "app-1", appSecret: undefined })).toMatchObject({ reason: "NOT_CONFIGURED" });
  });

  it("the first Google sign-in makes the user, the next finds it; racing first sign-ins share one user", async () => {
    const r = await Promise.all([accounts.externalLogin("google", "1122"), accounts.externalLogin("google", "1122")]);
    expect(r[0]!.account.userId).toBe(r[1]!.account.userId);
    expect((await accounts.externalLogin("google", "1122")).account).toMatchObject({ userId: r[0]!.account.userId, providers: ["google"] });
    expect((await accounts.externalLogin("facebook", "1122")).account.userId).not.toBe(r[0]!.account.userId);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 2 });
  });
});
