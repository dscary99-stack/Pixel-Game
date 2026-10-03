import type { Environment } from "./battle-room";

/**
 * Auth provider is OPEN (O11). Until it is chosen, only dev accepts a header identity;
 * every other environment answers 401 rather than trusting a client-supplied accountId.
 */
export function resolveAccount(request: Request, env: { ENVIRONMENT: Environment; DEV_AUTH?: string }): string | null {
  if (env.ENVIRONMENT === "dev" && env.DEV_AUTH === "true") {
    const id = request.headers.get("x-dev-account");
    return id !== null && /^acct:[a-z0-9_-]{1,40}$/.test(id) ? id : null;
  }
  return null;
}
