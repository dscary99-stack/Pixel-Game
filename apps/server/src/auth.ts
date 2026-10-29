import { PRODUCTION_RULES, DEV_FIXTURE_RULES } from "@pmrpg/shared";
import type { Environment } from "./battle-room";
import { AccountStore, type Session } from "./account-store";
import type { SqlDb } from "./reward-ledger";

/**
 * Who is calling (O11, Nut 2026-10-07: Google, Facebook, or an ID made in the game). A signed-in caller
 * sends `Authorization: Bearer <token>`; game routes then run as the character place the session picked
 * (O10: each of the 10 characters is its own play account). Browsers cannot set headers on a WebSocket
 * upgrade, so only an upgrade may carry the token as `?session=`.
 *
 * Local dev with DEV_AUTH=true also takes `x-dev-account` / `?dev_account=` so the smokes and the dev
 * client keep working; no other environment ever trusts a client-supplied account id.
 */
interface AuthEnv {
  ENVIRONMENT: Environment;
  DEV_AUTH?: string;
  DB: unknown;
}

export const accountsFor = (env: AuthEnv) => new AccountStore(env.DB as SqlDb, env.ENVIRONMENT === "dev" ? DEV_FIXTURE_RULES : PRODUCTION_RULES);

export function sessionToken(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (h !== null) return /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(h)?.[1] ?? null;
  if (request.headers.get("Upgrade") === "websocket") return new URL(request.url).searchParams.get("session");
  return null;
}

export async function resolveSession(request: Request, env: AuthEnv): Promise<Session | null> {
  const token = sessionToken(request);
  return token === null ? null : accountsFor(env).resolve(token);
}

export async function resolveAccount(request: Request, env: AuthEnv): Promise<string | null> {
  if (sessionToken(request) !== null) return (await resolveSession(request, env))?.accountId ?? null;
  if (env.ENVIRONMENT === "dev" && env.DEV_AUTH === "true") {
    const id = request.headers.get("x-dev-account") ?? new URL(request.url).searchParams.get("dev_account");
    return id !== null && /^acct:[a-z0-9_-]{1,40}$/.test(id) ? id : null;
  }
  return null;
}
