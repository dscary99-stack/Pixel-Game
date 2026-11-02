/**
 * Town training ground (practice.ts in shared, P17). A practice fight goes through the normal path so
 * the team and gear are locked while it runs: reserve in D1 (an empty bag), then the Battle DO creates
 * the fight with `practice: true`. The kernel then grants nothing, and the Battle DO settles it with no
 * allies (HP/MP not kept) and no secret-quest facts, so the settlement only unlocks.
 *
 * The battle id comes from (account, operation id): a retried start resumes the same fight, and a new
 * operation id while one is open is refused by the one-open-battle reservation guard.
 */
import { PracticeStartRequestSchema, companionSetups, playerSetup, practiceBosses, type BattleSetup, type BossDefinition, type MapDefinition, type PracticeView, type SpeciesDefinition } from "@pmrpg/shared";
import type { CharacterStore } from "./character-store";
import type { Economy } from "./economy";
import type { FrontierBattlePort } from "./frontier-store";
import { hashJson, type SqlDb } from "./reward-ledger";

export type PracticeRejection = "INVALID_REQUEST" | "NO_CHARACTER" | "NOT_FOUND" | "NOT_IN_TOWN" | "IN_BATTLE" | "ENCOUNTER_REFUSED";
type Rejected = { status: "rejected"; reason: PracticeRejection; message: string };
const reject = (reason: PracticeRejection, message: string): Rejected => ({ status: "rejected", reason, message });

export type PracticeStartResult = { status: "started"; battleId: string; resumed: boolean } | Rejected;

export interface PracticeContent {
  maps: ReadonlyMap<string, MapDefinition>;
  bosses: ReadonlyMap<string, BossDefinition>;
  species: ReadonlyMap<string, SpeciesDefinition>;
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

export class PracticeStore {
  constructor(
    private readonly db: SqlDb,
    private readonly content: PracticeContent,
    private readonly economy: Economy,
    private readonly characters: CharacterStore,
    private readonly battles: FrontierBattlePort,
    private readonly towns: readonly string[],
  ) {}

  view(): PracticeView {
    return { bosses: practiceBosses(this.content.maps, this.content.bosses, this.content.species) };
  }

  /** Start (or, with the same operation id, resume) a practice fight against a field boss; in town only. */
  async start(accountId: string, raw: unknown): Promise<PracticeStartResult> {
    const parsed = PracticeStartRequestSchema.safeParse(raw);
    if (!parsed.success) return reject("INVALID_REQUEST", parsed.error.issues.map((i) => i.message).join("; "));
    const { operationId, bossId } = parsed.data;
    if (!this.view().bosses.some((b) => b.bossId === bossId)) return reject("NOT_FOUND", "the training ground has no such boss");
    const loadout = await this.characters.loadout(accountId);
    if (loadout === null) return reject("NO_CHARACTER", "create a character first");
    const { character, instances, worn, equipmentIds } = loadout;
    const battleId = `battle:pr_${(await hashJson({ accountId, operationId })).slice(0, 32)}`;
    const reservationId = `res:${battleId}`;
    const prior = await this.economy.reservedBag(reservationId);
    if (prior !== null) {
      if (prior.status === "released") return reject("ENCOUNTER_REFUSED", "that practice was called off; start a new one");
      if (prior.status === "settled") return { status: "started", battleId, resumed: true };
    } else {
      if (!(await this.inTown(accountId))) return reject("NOT_IN_TOWN", "the training ground is in town");
      const team = character.team.map((t) => t.instanceId);
      const reserved = await this.economy.reserve({ reservationId, accountId, battleId, bag: {}, companionIds: team, characterId: character.id, equipmentIds });
      if (reserved.status === "rejected") {
        if (reserved.reason === "BATTLE_IN_PROGRESS") return reject("IN_BATTLE", "finish your other fight first");
        return reject("ENCOUNTER_REFUSED", reserved.reason);
      }
    }
    // Everyone at full HP/MP (null = full): nothing from the field carries in, nothing carries out.
    const full = new Map([...instances].map(([id, inst]) => [id, { ...inst, hp: null, mp: null }]));
    const setup: BattleSetup = {
      battleId,
      originMode: "manual",
      seed: crypto.randomUUID(),
      player: playerSetup(accountId, { ...character, hp: null, mp: null }, worn),
      companions: companionSetups(character.team, full),
      enemies: [],
      boss: { bossId },
      bag: {},
      practice: true,
    };
    // The Battle DO keeps the first setup it was given, so a resumed create is a no-op.
    const created = await this.battles.create(accountId, setup, reservationId);
    if (!created.ok) return reject("ENCOUNTER_REFUSED", created.code);
    return { status: "started", battleId, resumed: prior !== null };
  }

  private async inTown(accountId: string): Promise<boolean> {
    const r = await this.db
      .prepare(`SELECT 1 AS ok FROM player_positions WHERE account_id = ? AND map_id IN (${marks(this.towns.length)})`)
      .bind(accountId, ...this.towns)
      .first<{ ok: number }>();
    return r !== null;
  }
}
