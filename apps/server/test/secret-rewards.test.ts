/**
 * Secret quests outside fights on the D1 migrations (node:sqlite stand-in): visits counted once per map
 * per window, materials handed in at a town (idempotent, never past the count, raced safely), and a
 * finished quest's rewards granted once even when claims race.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  EXAMPLE_SECRET_QUEST_TEMPLATES as T,
  PRODUCTION_RULES as R,
  exampleContentMaps,
  exampleMapRegistry,
  exampleSecretRewardRegistry,
  secretTitleId,
  type SecretQuest,
} from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy } from "../src/economy";
import { JournalStore } from "../src/journal-store";
import { SecretProgressStore } from "../src/secret-progress-store";
import { SecretQuestStore } from "../src/secret-quest-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const TOWN = "map:dawn_town";
const FIELD = "map:dawn_field";
const content = exampleContentMaps();
const rewards = exampleSecretRewardRegistry();
const sqContent = { ...content, maps: exampleMapRegistry(), frontierFloors: R.confirmed.frontierFloors.value, rewards };
let clock = "2026-10-06T10:00:00Z";
const now = () => clock;
let db: Db;
let eco: Economy;
let secrets: SecretQuestStore;
let progress: SecretProgressStore;
let journal: JournalStore;
let characterId: string;

const ALL_KINDS = [
  { kind: "title", rewardId: "srw:title_lone_star", variantId: "v0000abcd" },
  { kind: "fashion", rewardId: "srw:fashion_star_aura", variantId: "v0000abce" },
  { kind: "companion", rewardId: "srw:companion_gilded_mole", variantId: "v0000abcf", innateId: "skill:bird_innate_resist" },
  { kind: "gear", rewardId: "srw:gear_oathblade", variantId: "v0000abd0" },
] as const;
const QUESTS: SecretQuest[] = [
  { id: "sq:personal:home", kind: "personal", templateId: "sqt:personal_homecoming", goal: "explore", params: { count: 3, mapId: FIELD }, rewards: [ALL_KINDS[0]] },
  { id: "sq:personal:gift", kind: "personal", templateId: "sqt:personal_offering", goal: "deliver", params: { count: 10, itemId: "item:crab_shell" }, rewards: [...ALL_KINDS] },
  { id: "sq:element:x", kind: "element", templateId: "sqt:element_fire", goal: "win", params: { count: 99 }, rewards: [ALL_KINDS[1]] },
];

const prog = (q: string) => (db.prepare("SELECT progress, completed_at FROM secret_quest_progress WHERE quest_id = ?").get(q) as { progress: number; completed_at: string | null } | undefined) ?? null;
const shells = () => eco.balance(A, "item:crab_shell");
const at = (map: string) => db.prepare("UPDATE player_positions SET map_id = ? WHERE account_id = ?").run(map, A);

beforeEach(async () => {
  clock = "2026-10-06T10:00:00Z";
  db = freshDb();
  const d1 = new SqliteD1(db);
  eco = new Economy(d1, R, now);
  secrets = new SecretQuestStore(d1, R, T, sqContent, "test-key", now);
  progress = new SecretProgressStore(d1, R, { species: content.species, equipment: content.equipment, rewards }, [TOWN], now);
  journal = new JournalStore(d1, R, content, now);
  const r = await new CharacterStore(d1, R, content, now, secrets).create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  if (r.status !== "created") throw new Error("create failed");
  characterId = r.character.id;
  db.prepare("UPDATE character_secret_quests SET quests_json = ? WHERE character_id = ?").run(JSON.stringify(QUESTS), characterId);
  db.prepare(`INSERT INTO player_positions (account_id, map_id, channel, x, y, generation, updated_at) VALUES (?, ?, 1, 1, 1, 1, 'x')`).run(A, TOWN);
  await eco.devGrant("seed:shells", A, { "item:crab_shell": 30 });
});

describe("visits (explore)", () => {
  it("count nothing while locked", async () => {
    await progress.creditVisit(A, FIELD);
    expect(prog("sq:personal:home")).toBeNull();
  });

  it("count once per map per window, only on the quest's map, up to the count", async () => {
    await secrets.devReveal(A);
    await progress.creditVisit(A, FIELD);
    await progress.creditVisit(A, FIELD);
    await progress.creditVisit(A, TOWN);
    expect(prog("sq:personal:home")).toEqual({ progress: 1, completed_at: null });
    for (const t of ["11", "12", "13", "14"]) {
      clock = `2026-10-06T${t}:00:00Z`;
      await progress.creditVisit(A, FIELD);
    }
    expect(prog("sq:personal:home")).toMatchObject({ progress: 3 });
    expect(prog("sq:personal:home")!.completed_at).not.toBeNull();
  });
});

describe("hand-ins (deliver)", () => {
  beforeEach(() => secrets.devReveal(A));
  const req = (operationId: string, quantity: number, questId = "sq:personal:gift") => ({ operationId, questId, quantity });

  it("take the items and move the progress once; a retry replays", async () => {
    expect(await progress.deliver(A, req("op_give_0001", 4))).toMatchObject({ status: "done", replayed: false });
    expect(await progress.deliver(A, req("op_give_0001", 4))).toMatchObject({ status: "done", replayed: true });
    expect(await shells()).toBe(26);
    expect(prog("sq:personal:gift")).toMatchObject({ progress: 4 });
    expect(await progress.deliver(A, req("op_give_0001", 5))).toMatchObject({ status: "rejected", reason: "PAYLOAD_MISMATCH" });
  });

  it("refuse outside a town, past the count, without the items, or for another goal", async () => {
    at(FIELD);
    expect(await progress.deliver(A, req("op_give_0002", 1))).toMatchObject({ reason: "NOT_IN_TOWN" });
    at(TOWN);
    expect(await progress.deliver(A, req("op_give_0003", 11))).toMatchObject({ reason: "TOO_MANY" });
    db.prepare("UPDATE character_secret_quests SET quests_json = ? WHERE character_id = ?").run(
      JSON.stringify(QUESTS.map((q) => (q.id === "sq:personal:gift" ? { ...q, params: { ...q.params, count: 100 } } : q))),
      characterId,
    );
    expect(await progress.deliver(A, req("op_give_0004", 31))).toMatchObject({ reason: "INSUFFICIENT_ITEMS" });
    expect(await progress.deliver(A, req("op_give_0005", 1, "sq:personal:home"))).toMatchObject({ reason: "WRONG_GOAL" });
    expect(await shells()).toBe(30);
    expect(prog("sq:personal:gift")).toBeNull();
  });

  it("racing hand-ins never take more than the quest needs", async () => {
    const rs = await Promise.all([1, 2, 3].map((n) => progress.deliver(A, req(`op_race_000${n}`, 6))));
    expect(rs.filter((r) => r.status === "done")).toHaveLength(1);
    expect(await shells()).toBe(24);
    expect(prog("sq:personal:gift")).toMatchObject({ progress: 6 });
  });

  it("are refused while locked", async () => {
    db.prepare("UPDATE character_secret_quests SET revealed_at = NULL").run();
    expect(await progress.deliver(A, req("op_give_0006", 1))).toMatchObject({ reason: "LOCKED" });
  });
});

describe("claims", () => {
  beforeEach(() => secrets.devReveal(A));

  it("refuse an unfinished quest", async () => {
    expect(await progress.claim(A, { questId: "sq:personal:gift" })).toMatchObject({ status: "rejected", reason: "NOT_DONE" });
  });

  it("grant every reward once (title, fashion, a Lv1 companion, the gear) even when claims race", async () => {
    await progress.deliver(A, { operationId: "op_give_0007", questId: "sq:personal:gift", quantity: 10 });
    const rs = await Promise.all([1, 2, 3].map(() => progress.claim(A, { questId: "sq:personal:gift" })));
    expect(rs.every((r) => r.status === "done")).toBe(true);
    expect(rs.filter((r) => r.status === "done" && !r.replayed)).toHaveLength(1);
    expect(db.prepare("SELECT kind, reward_id FROM character_secret_rewards ORDER BY reward_no").all()).toEqual(ALL_KINDS.map((k) => ({ kind: k.kind, reward_id: k.rewardId })));
    const mon = db.prepare("SELECT species_id, owner_id, current_level, origin_json FROM monster_instances WHERE id LIKE 'mon:secret:%'").all() as { species_id: string; owner_id: string; current_level: number; origin_json: string }[];
    expect(mon).toHaveLength(1);
    expect(mon[0]).toMatchObject({ species_id: "species:supply_mole", owner_id: A, current_level: R.confirmed.capturedInitialLevel.value });
    expect(JSON.parse(mon[0]!.origin_json)).toMatchObject({ kind: "secret_reward", rewardId: "srw:companion_gilded_mole", innateId: "skill:bird_innate_resist" });
    expect(db.prepare("SELECT definition_id, owner_id, rarity FROM equipment_instances WHERE id LIKE 'eq:secret:%'").all()).toEqual([{ definition_id: "equip:wooden_sword", owner_id: A, rarity: "COMMON" }]);
    expect(await secrets.view(A)).toMatchObject({ claimed: ["sq:personal:gift"] });
  });

  it("a claimed title can be shown", async () => {
    for (const t of ["10", "11", "12"]) {
      clock = `2026-10-06T${t}:00:00Z`;
      await progress.creditVisit(A, FIELD);
    }
    expect(await progress.claim(A, { questId: "sq:personal:home" })).toMatchObject({ status: "done" });
    const id = secretTitleId(ALL_KINDS[0]);
    expect((await journal.view(A))!.titles).toContain(id);
    expect(await journal.setTitle(A, { titleId: id })).toEqual({ ok: true, titleId: id });
  });
});
