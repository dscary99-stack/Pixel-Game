/**
 * Character and team requests (server mode). The server decides everything; the client shows
 * what it gets back. Identity uses the dev header until O11 picks auth.
 */
import type { CharacterView, CreateCharacterRequest, MonsterInstance } from "@pmrpg/shared";

export type StoredCompanion = MonsterInstance & { hp: number | null; mp: number | null };

export interface CharacterBundle {
  character: CharacterView;
  companions: StoredCompanion[];
}

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
