/**
 * Character and team requests (server mode). The server decides everything; the client shows
 * what it gets back. Identity uses the dev header until O11 picks auth.
 */
import type { CharacterView, CreateCharacterRequest, EquipSlot, EquipmentView, MonsterInstance } from "@pmrpg/shared";

export type StoredCompanion = MonsterInstance & { hp: number | null; mp: number | null };

export interface CharacterBundle {
  character: CharacterView;
  companions: StoredCompanion[];
  equipment: EquipmentView[];
  coins: number;
  /** Item balances (materials, potions, capture items, Sigils). */
  bag: Record<string, number>;
}

/** One id per player action: a retried request with it can never apply twice. */
const opId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class CharacterApi {
  constructor(
    private readonly base: string,
    private readonly devAccount: string,
  ) {}

  /** The caller's character, or null when they have not made one yet. */
  async get(): Promise<CharacterBundle | null> {
    try {
      return await this.call<CharacterBundle>("GET", "/character");
    } catch (e) {
      if (e instanceof ApiError && e.code === "NO_CHARACTER") return null;
      throw e;
    }
  }

  create(req: Omit<CreateCharacterRequest, "operationId">, operationId: string) {
    return this.call<{ character: CharacterView }>("POST", "/character", { ...req, operationId });
  }

  setTeam(expectedVersion: number, companionIds: string[]) {
    return this.call<{ character: CharacterView }>("PUT", "/character/team", { expectedVersion, companionIds });
  }

  /** Put a piece in a slot, or empty it with null. */
  equip(expectedVersion: number, slot: EquipSlot, instanceId: string | null) {
    return this.call<{ character: CharacterView; equipment: EquipmentView[] }>("PUT", "/character/equipment", { expectedVersion, slot, instanceId });
  }

  installSigil(equipmentId: string, sigilItemId: string) {
    return this.call<{ coins: number }>("POST", "/character/equipment/sigil", { operationId: opId("sigil"), equipmentId, sigilItemId });
  }

  removeSigil(equipmentId: string, socket: number, expectedCost: number) {
    return this.call<{ coins: number }>("POST", "/character/equipment/sigil/remove", { operationId: opId("unsigil"), equipmentId, socket, expectedCost });
  }

  sell(lines: { itemId: string; quantity: number }[]) {
    return this.call<{ coins: number; result: { total: number } }>("POST", "/town/sell", { operationId: opId("sell"), lines });
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-dev-account": this.devAccount },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new ApiError(json.error ?? String(res.status), json.message ?? json.error ?? res.statusText);
    return json as T;
  }
}
