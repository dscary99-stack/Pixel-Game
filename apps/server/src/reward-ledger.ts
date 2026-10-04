/**
 * Reward settlement against D1 (chapter 11 §3 steps 6–7).
 *
 * Receipt + item/equipment/companion grant go in one D1 batch (a transaction). Every write is keyed so a
 * retry is a no-op: receipt PK (entitlement, recipient), ledger PK (operation, line), monster and
 * equipment created_operation_id UNIQUE. Goal: the business effect happens once. The network may still
 * deliver twice; that is fine.
 */
import {
  BOND_MAX,
  COMPANION_GROWTH_VERSION,
  Rng,
  exampleContentMaps,
  expCap,
  rollGear,
  seedRng,
  type AffixPool,
  type EquipmentDefinition,
  type Entitlement,
  type RulesConfig,
} from "@pmrpg/shared";

/** Gear content the ledger needs to roll a dropped piece's rarity and affixes. */
export interface GearContent {
  equipment: ReadonlyMap<string, EquipmentDefinition>;
  affixPools: ReadonlyMap<string, AffixPool>;
}

/** The subset of the D1 API we use, so tests can run it on node:sqlite. */
export interface SqlBound {
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface SqlDb {
  prepare(sql: string): { bind(...values: unknown[]): SqlBound };
  batch(statements: SqlBound[]): Promise<unknown[]>;
}

/** Grant rows are written only if the receipt in this transaction carries our payload hash. */
const OWN_RECEIPT = `EXISTS (SELECT 1 FROM reward_receipts WHERE entitlement_id = ? AND recipient_id = ? AND payload_hash = ?)`;

export type GrantResult =
  | { status: "granted"; entitlementId: string }
  | { status: "already_granted"; entitlementId: string }
  | { status: "rejected"; entitlementId: string; reason: "PAYLOAD_MISMATCH" };

export function payloadHash(e: Entitlement): Promise<string> {
  return hashJson(e);
}

/** SHA-256 of a key-order-independent JSON encoding. */
export async function hashJson(v: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(v));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export class RewardLedger {
  constructor(
    private readonly db: SqlDb,
    private readonly rules: RulesConfig,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly gear: GearContent = exampleContentMaps(),
  ) {}

  async grant(entitlement: Entitlement, recipientId: string): Promise<GrantResult> {
    const id = entitlement.entitlementId;
    const hash = await payloadHash(entitlement);
    const existing = await this.receipt(id, recipientId);
    if (existing !== null) {
      return existing === hash ? { status: "already_granted", entitlementId: id } : { status: "rejected", entitlementId: id, reason: "PAYLOAD_MISMATCH" };
    }

    const at = this.now();
    const stmts: SqlBound[] = [
      this.db
        .prepare(
          `INSERT INTO reward_receipts (entitlement_id, recipient_id, payload_hash, status, committed_at)
           VALUES (?, ?, ?, 'granted', ?) ON CONFLICT DO NOTHING`,
        )
        .bind(id, recipientId, hash, at),
    ];
    if (entitlement.kind === "kill") {
      entitlement.items.forEach((line, i) => {
        // Equipment drops are instances, not stackable items (chapter 05 §1): one row per piece,
        // keyed by entitlement, line and piece number so a retried grant adds nothing. Rarity and
        // affixes are rolled here from an unguessable seed (like a capture's growth seed); a
        // replayed grant keeps the first row (ON CONFLICT DO NOTHING).
        if (line.itemId.startsWith("equip:")) {
          const def = this.gear.equipment.get(line.itemId);
          for (let n = 0; n < line.quantity; n++) {
            const op = `${id}:${i}:${n}`;
            const rolled = def === undefined ? { rarity: "COMMON", affixes: [] } : rollGear(this.rules, def, this.gear.affixPools.get(def.affixPoolId), new Rng(seedRng(crypto.randomUUID())));
            stmts.push(
              this.db
                .prepare(
                  `INSERT INTO equipment_instances (id, definition_id, owner_id, rarity, affixes_json, created_operation_id, created_at)
                   SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${OWN_RECEIPT} ON CONFLICT DO NOTHING`,
                )
                .bind(`eq:${op}`, line.itemId, recipientId, rolled.rarity, JSON.stringify(rolled.affixes), op, at, id, recipientId, hash),
            );
          }
          return;
        }
        stmts.push(
          this.db
            .prepare(
              `INSERT INTO item_ledger (operation_id, line_no, account_id, item_id, delta, reason, created_at)
               SELECT ?, ?, ?, ?, ?, 'kill_reward', ? WHERE ${OWN_RECEIPT} ON CONFLICT DO NOTHING`,
            )
            .bind(id, i, recipientId, line.itemId, line.quantity, at, id, recipientId, hash),
        );
      });
    } else if (entitlement.kind === "capture") {
      // Captured companions start at the confirmed initial level with Bond 0 (C09, C11). The server
      // picks the growth seed here; a replayed grant keeps the first row (ON CONFLICT DO NOTHING).
      const start = this.rules.provisional.primaryStatStart.value;
      const stats = { STR: start, VIT: start, INT: start, DEX: start, AGI: start, SPI: start };
      const growthSeed = crypto.randomUUID();
      stmts.push(
        this.db
          .prepare(
            `INSERT INTO monster_instances
               (id, species_id, owner_id, current_level, element, primary_stats_json, origin_json, created_operation_id,
                growth_seed, growth_history_version)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${OWN_RECEIPT} ON CONFLICT DO NOTHING`,
          )
          .bind(
            `mon:${id}`,
            entitlement.speciesId,
            recipientId,
            this.rules.confirmed.capturedInitialLevel.value,
            entitlement.element,
            JSON.stringify(stats),
            JSON.stringify({ kind: "capture", battleId: id.split(":").slice(0, -2).join(":"), at }),
            id,
            growthSeed,
            COMPANION_GROWTH_VERSION,
            id,
            recipientId,
            hash,
          ),
      );
    }
    // EXP for everyone who started the fight (chapter 04 §4): the character named in the battle's
    // reservation and each companion listed there, KO'd or not, each with its own award (the kernel
    // scaled companions by their level at fight start). Captured companions are not in it.
    // EXP stops at each curve's cap total: nothing is banked toward a level past the cap.
    const exp = entitlement.exp ?? 0;
    const battleId = id.split(":").slice(0, -2).join(":");
    const loadout = `(SELECT loadout_json FROM battle_reservations WHERE battle_id = ? AND account_id = ?)`;
    if (exp > 0) {
      stmts.push(
        this.db
          .prepare(`UPDATE characters SET xp = MIN(xp + ?, ?) WHERE account_id = ? AND id = json_extract(${loadout}, '$.characterId') AND ${OWN_RECEIPT}`)
          .bind(exp, expCap(this.rules, "player"), recipientId, battleId, recipientId, id, recipientId, hash),
      );
    }
    for (const [companionId, amount] of Object.entries(entitlement.companionExp ?? {})) {
      if (amount <= 0) continue;
      stmts.push(
        this.db
          .prepare(
            `UPDATE monster_instances SET xp = MIN(xp + ?, ?)
             WHERE owner_id = ? AND id = ? AND id IN (SELECT value FROM json_each(json_extract(${loadout}, '$.companionIds'))) AND ${OWN_RECEIPT}`,
          )
          .bind(amount, expCap(this.rules, "companion"), recipientId, companionId, battleId, recipientId, id, recipientId, hash),
      );
    }
    // Bond (up or down, kept within 0–1000) and skill mastery (up to its cap) when a fight ends
    // (chapter 04 §5–§6), for companions the battle's reservation lists and the recipient still owns.
    if (entitlement.kind === "fight_result") {
      for (const [companionId, g] of Object.entries(entitlement.companions)) {
        if (g.bond === 0 && g.mastery <= 0) continue;
        stmts.push(
          this.db
            .prepare(
              `UPDATE monster_instances SET bond = MAX(0, MIN(bond + ?, ?)), skill_mastery = MIN(skill_mastery + ?, ?)
               WHERE owner_id = ? AND id = ? AND id IN (SELECT value FROM json_each(json_extract(${loadout}, '$.companionIds'))) AND ${OWN_RECEIPT}`,
            )
            .bind(g.bond, BOND_MAX, g.mastery, this.rules.provisional.skillMasteryCap.value, recipientId, companionId, battleId, recipientId, id, recipientId, hash),
        );
      }
    }
    await this.db.batch(stmts);

    // A concurrent writer with a different payload would have won the receipt row.
    const after = await this.receipt(id, recipientId);
    if (after !== hash) return { status: "rejected", entitlementId: id, reason: "PAYLOAD_MISMATCH" };
    return { status: "granted", entitlementId: id };
  }

  private async receipt(entitlementId: string, recipientId: string): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT payload_hash FROM reward_receipts WHERE entitlement_id = ? AND recipient_id = ?`)
      .bind(entitlementId, recipientId)
      .first<{ payload_hash: string }>();
    return row?.payload_hash ?? null;
  }
}
