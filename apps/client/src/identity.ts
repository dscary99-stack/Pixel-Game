/**
 * Who the client plays as. A signed-in player (O11) sends its session token; local dev may still use a
 * dev account id, which the server accepts only in dev with DEV_AUTH.
 */
export type Identity = { kind: "dev"; account: string } | { kind: "session"; token: string; label: string };

export const devIdentity = (account: string): Identity => ({ kind: "dev", account });

export const authHeaders = (id: Identity): Record<string, string> => (id.kind === "dev" ? { "x-dev-account": id.account } : { authorization: `Bearer ${id.token}` });

/** Browsers cannot set headers on a WebSocket, so the upgrade carries the identity in the query. */
export const socketQuery = (id: Identity) => (id.kind === "dev" ? `dev_account=${encodeURIComponent(id.account)}` : `session=${encodeURIComponent(id.token)}`);

export const identityLabel = (id: Identity) => (id.kind === "dev" ? id.account : id.label);
