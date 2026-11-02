/**
 * Secret quest progress on the D1 migrations (node:sqlite stand-in): credited in the settlement's own
 * batch, only for a revealed set, once per fight even when settlements replay or race, capped at the
 * quest's count.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { EXAMPLE_SECRET_QUEST_TEMPLATES as T, PRODUCTION_RULES as R, exampleContentMaps, exampleMapRegistry, exampleSecretRewardRegistry, type SecretFightFacts, type SecretQuest } from "@pmrpg/shared";
import { CharacterStore } from "../src/character-store";
import { Economy, type Settlement } from "../src/economy";
import { SecretQuestStore } from "../src/secret-quest-store";
import { SqliteD1, freshDb, type Db } from "./sqlite-d1";

const A = "acct:a";
const content = exampleContentMaps();
const sqContent = { ...content, maps: exampleMapRegistry(), frontierFloors: R.confirmed.frontierFloors.value, rewards: exampleSecretRewardRegistry() };
const now = () => "2026-10-06T00:00:00Z";
let db: Db;
let eco: Economy;
let secrets: SecretQuestStore;
let characterId: string;

/** A controlled set (stored as generator v2, so no rewards are needed) to aim fights at. */
const QUESTS: SecretQuest[] = [
  { id: "sq:personal:crabs", kind: "personal", templateId: "sqt:personal_old_rival", goal: "defeat", params: { count: 5, speciesId: "species:armor_crab", require: ["no_items"] } },
  { id: "sq:personal:alone", kind: "personal", templateId: "sqt:personal_lone_wolf", goal: "win", params: { count: 2, condition: "solo" } },
  { id: "sq:personal:spire", kind: "personal", templateId: "sqt:personal_spire_climber", goal: "tower", params: { count: 1, floor: 10 } },
];

const facts = (over: Partial<SecretFightFacts> = {}): SecretFightFacts => ({
  won: true,
  round: 3,
  companions: [],
  characterHpPct: 80,
  itemsUsed: 0,
  knockedOut: false,
  defeated: [
    { speciesId: "species:armor_crab", element: "EARTH" },
    { speciesId: "species:armor_crab", element: "WATER" },
    { speciesId: "species:ember_fox", element: "FIRE" },
  ],
  captured: [],
  ...over,
});

let n = 0;
async function fight(secret: SecretFightFacts, outcome: Settlement["outcome"] = "victory"): Promise<Settlement> {
  const battle = `battle:sq${++n}`;
  const rid = `res:${battle}`;
  await eco.reserve({ reservationId: rid, accountId: A, battleId: battle, bag: {}, companionIds: [], characterId });
  await eco.activate(rid);
  return { reservationId: rid, battleId: battle, accountId: A, outcome, unused: {}, allies: [{ unitId: "player", instanceId: null, hp: 100, mp: 10, ko: false }], entitlementIds: [], secret };
}

const progress = () =>
  Object.fromEntries((db.prepare("SELECT quest_id, progress, completed_at FROM secret_quest_progress ORDER BY quest_id").all() as { quest_id: string; progress: number; completed_at: string | null }[]).map((r) => [r.quest_id, [r.progress, r.completed_at !== null]]));

beforeEach(async () => {
  db = freshDb();
  const d1 = new SqliteD1(db);
  eco = new Economy(d1, R, now);
  secrets = new SecretQuestStore(d1, R, T, sqContent, "test-key", now);
  const store = new CharacterStore(d1, R, content, now, secrets);
  const r = await store.create(A, { operationId: "op_create_a", name: "นัท", classId: "class:guardian", raceId: "race:stonekin", element: "EARTH" });
  if (r.status !== "created") throw new Error("create failed");
  characterId = r.character.id;
  db.prepare("UPDATE character_secret_quests SET generator_version = 2, quests_json = ? WHERE character_id = ?").run(JSON.stringify(QUESTS), characterId);
});

describe("secret quest progress", () => {
  it("a locked set counts nothing", async () => {
    expect((await eco.settle(await fight(facts()))).status).toBe("settled");
    expect(progress()).toEqual({});
  });

  it("a revealed set counts a won fight; the view shows it", async () => {
    await secrets.devReveal(A);
    expect((await eco.settle(await fight(facts()))).status).toBe("settled");
    expect(progress()).toEqual({ "sq:personal:crabs": [2, false], "sq:personal:alone": [1, false] });
    expect(await secrets.view(A)).toMatchObject({ locked: false, progress: { "sq:personal:crabs": { progress: 2, completed: false }, "sq:personal:alone": { progress: 1, completed: false } } });
  });

  it("a replayed settlement adds nothing", async () => {
    await secrets.devReveal(A);
    const s = await fight(facts());
    expect((await eco.settle(s)).status).toBe("settled");
    expect((await eco.settle(s)).status).toBe("already_settled");
    expect(progress()["sq:personal:crabs"]).toEqual([2, false]);
  });

  it("two racing settlements of one fight credit it once", async () => {
    await secrets.devReveal(A);
    const s = await fight(facts());
    const results = await Promise.all([eco.settle(s), eco.settle(s), eco.settle(s)]);
    expect(results.every((r) => r.status === "settled" || r.status === "already_settled")).toBe(true);
    expect(progress()).toEqual({ "sq:personal:crabs": [2, false], "sq:personal:alone": [1, false] });
    expect(db.prepare("SELECT COUNT(*) AS n FROM secret_quest_credits").get()).toEqual({ n: 1 });
  });

  it("a broken condition gives that quest nothing; a lost fight gives nothing at all", async () => {
    await secrets.devReveal(A);
    await eco.settle(await fight(facts({ itemsUsed: 1 })));
    expect(progress()).toEqual({ "sq:personal:alone": [1, false] });
    await eco.settle(await fight(facts({ won: false }), "defeat"));
    expect(progress()).toEqual({ "sq:personal:alone": [1, false] });
  });

  it("progress stops at the count and completes once; the tower finishes on the floor named", async () => {
    await secrets.devReveal(A);
    for (let i = 0; i < 4; i++) await eco.settle(await fight(facts()));
    expect(progress()).toEqual({ "sq:personal:crabs": [5, true], "sq:personal:alone": [2, true] });
    await eco.settle(await fight(facts({ defeated: [], towerFloor: 9 })));
    expect(progress()["sq:personal:spire"]).toBeUndefined();
    await eco.settle(await fight(facts({ defeated: [], towerFloor: 10 })));
    expect(progress()["sq:personal:spire"]).toEqual([1, true]);
  });
});
