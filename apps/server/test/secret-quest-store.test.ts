/**
 * Secret quests on the D1 migrations (node:sqlite stand-in): rolled once at creation from an HMAC
 * seed of account id + name, never rerolled by a replay or a race, backfilled once for older
 * characters, and invisible to the client while locked.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { EXAMPLE_SECRET_QUEST_TEMPLATES as T, PRODUCTION_RULES as R, exampleContentMaps, exampleMapRegistry, rollSecretQuests } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { DEV_SECRET_QUEST_KEY, SecretQuestStore, secretQuestKey, secretQuestSeed } from "../src/secret-quest-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const B = "acct:b";
const KEY = "test-secret-quest-key";
const content = exampleContentMaps();
const sqContent = { ...content, maps: exampleMapRegistry() };
const now = () => "2026-10-05T00:00:00Z";
let db: Db;
let d1: SqliteD1;
let secrets: SecretQuestStore;
let store: CharacterStore;

const req = (over: Record<string, unknown> = {}) => ({ operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH", ...over });
const rows = () => db.prepare("SELECT character_id, account_id, generator_version, quests_json, revealed_at FROM character_secret_quests ORDER BY character_id").all() as {
  character_id: string;
  account_id: string;
  generator_version: number;
  quests_json: string;
  revealed_at: string | null;
}[];
const secretsWith = (key: string | null) => new SecretQuestStore(d1, R, T, sqContent, key, now);
const expected = async (key: string, account: string, name: string, element = "EARTH" as const, raceId = "race:stonekin") =>
  rollSecretQuests(R, await secretQuestSeed(key, account, name), { element, raceId }, T, sqContent);

beforeEach(() => {
  db = freshDb();
  d1 = new SqliteD1(db);
  secrets = secretsWith(KEY);
  store = new CharacterStore(d1, R, content, now, secrets);
});

describe("seed and key", () => {
  it("is HMAC-SHA256(key, v1\\n<account>\\n<name>)", async () => {
    const seed = await secretQuestSeed(KEY, A, "นัท");
    const want = createHmac("sha256", KEY).update(`v1\n${A}\nนัท`, "utf8").digest();
    expect(Buffer.from(seed).equals(want)).toBe(true);
  });

  it("uses the Worker secret; a fixed key only in dev; none elsewhere", () => {
    expect(secretQuestKey({ ENVIRONMENT: "production", SECRET_QUEST_KEY: "k" })).toBe("k");
    expect(secretQuestKey({ ENVIRONMENT: "dev" })).toBe(DEV_SECRET_QUEST_KEY);
    expect(secretQuestKey({ ENVIRONMENT: "dev", SECRET_QUEST_KEY: "k" })).toBe("k");
    expect(secretQuestKey({ ENVIRONMENT: "production" })).toBeNull();
    expect(secretQuestKey({ ENVIRONMENT: "staging", SECRET_QUEST_KEY: "" })).toBeNull();
  });

  it("without a key outside dev, creation fails loudly and stores nothing", async () => {
    const noKey = new CharacterStore(d1, R, content, now, secretsWith(null));
    await expect(noKey.create(A, req())).rejects.toThrow(/SECRET_QUEST_KEY/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM characters").get()).toEqual({ n: 0 });
    expect(rows()).toEqual([]);
  });
});

describe("rolled at creation", () => {
  it("stores the set in the create batch: same inputs give the same set", async () => {
    const r = await store.create(A, req());
    expect(r.status).toBe("created");
    const [row] = rows();
    const want = await expected(KEY, A, "นัท");
    expect(row).toMatchObject({ account_id: A, generator_version: want.generatorVersion, revealed_at: null });
    expect(JSON.parse(row!.quests_json)).toEqual(want.quests);
    expect(await secrets.roll(A, { name: "นัท", element: "EARTH", raceId: "race:stonekin" })).toEqual(want);
  });

  it("a different name, account or key gives a different set", async () => {
    const base = JSON.stringify(await expected(KEY, A, "นัท"));
    const names = ["Nut", "Mali", "Somchai", "Pim", "Kai", "Fah", "Ton", "Bee"];
    const byName = await Promise.all(names.map(async (n) => JSON.stringify(await expected(KEY, A, n))));
    const byAccount = await Promise.all(names.map(async (_, i) => JSON.stringify(await expected(KEY, `acct:x${i}`, "นัท"))));
    const byKey = await Promise.all(names.map(async (_, i) => JSON.stringify(await expected(`${KEY}-${i}`, A, "นัท"))));
    for (const sets of [byName, byAccount, byKey]) {
      expect(sets).not.toContain(base);
      expect(new Set(sets).size).toBeGreaterThanOrEqual(sets.length - 1);
    }
  });

  it("a replayed create does not reroll, even if the replay carries another name", async () => {
    await store.create(A, req());
    const first = rows();
    expect(await store.create(A, req())).toMatchObject({ status: "created" });
    expect(await store.create(A, req({ name: "ชื่ออื่น" }))).toMatchObject({ status: "created", character: { name: "นัท" } });
    expect(rows()).toEqual(first);
  });

  it("concurrent creates store one set, the winner's", async () => {
    const out = await Promise.all([
      store.create(A, req({ operationId: "op_race_1", name: "หนึ่ง" })),
      store.create(A, req({ operationId: "op_race_2", name: "สอง" })),
      store.create(A, req({ operationId: "op_race_3", name: "สาม" })),
    ]);
    const won = out.find((r) => r.status === "created");
    expect(out.filter((r) => r.status === "created")).toHaveLength(1);
    const all = rows();
    expect(all).toHaveLength(1);
    const name = won!.status === "created" ? won!.character.name : "";
    expect(JSON.parse(all[0]!.quests_json)).toEqual((await expected(KEY, A, name)).quests);
  });
});

describe("older characters (made before secret quests)", () => {
  it("get their set on first read, once, from the same inputs, even when reads race", async () => {
    const old = new CharacterStore(d1, R, content, now);
    await old.create(A, req());
    expect(rows()).toEqual([]);
    const views = await Promise.all(Array.from({ length: 5 }, () => secrets.view(A)));
    for (const v of views) expect(v).toStrictEqual({ locked: true });
    const all = rows();
    expect(all).toHaveLength(1);
    expect(JSON.parse(all[0]!.quests_json)).toEqual((await expected(KEY, A, "นัท")).quests);
    await secrets.view(A);
    expect(rows()).toEqual(all);
  });

  it("no character, no set", async () => {
    expect(await secrets.view(B)).toBeNull();
    expect(await secrets.devReveal(B)).toBeNull();
    expect(rows()).toEqual([]);
  });
});

describe("locked means nothing leaks", () => {
  it("the view is exactly { locked: true } and the character bundle carries no quest data", async () => {
    const created = await store.create(A, req());
    const view = await secrets.view(A);
    expect(view).toStrictEqual({ locked: true });
    expect(Object.keys(view!)).toEqual(["locked"]);
    const bundle = JSON.stringify({ created, character: await store.get(A), companions: await store.companions(A), equipment: await store.equipment(A) });
    const quests = (await expected(KEY, A, "นัท")).quests;
    expect(bundle).not.toMatch(/sqt?:|secret/i);
    for (const q of quests) expect(bundle).not.toContain(q.templateId);
  });

  it("the dev reveal returns the stored set and unlocks the view; revealing twice keeps it", async () => {
    await store.create(A, req());
    const want = (await expected(KEY, A, "นัท")).quests;
    expect(await secrets.devReveal(A)).toEqual({ locked: false, quests: want });
    expect(await secrets.view(A)).toEqual({ locked: false, quests: want });
    const at = rows()[0]!.revealed_at;
    expect(at).toBe(now());
    expect(await secrets.devReveal(A)).toEqual({ locked: false, quests: want });
    expect(rows()[0]!.revealed_at).toBe(at);
  });
});
