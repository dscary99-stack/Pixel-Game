/**
 * Google and Facebook sign-in checks (O11, Nut 2026-10-07). The client signs in with the provider and
 * sends what it got; the Worker checks it with the provider before trusting the subject.
 *
 * Google: an ID token (JWT, RS256) checked against Google's published keys, issuer, audience (our
 * client id) and expiry. Facebook: a user access token checked with Graph `debug_token` using our app
 * token; it must be valid and issued for our app.
 */

export type ProviderCheck = { ok: true; subject: string } | { ok: false; reason: "NOT_CONFIGURED" | "INVALID_TOKEN" | "PROVIDER_UNAVAILABLE"; message: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

let googleKeys: { keys: Jwk[]; until: number } | null = null;

/** Tests reset the key cache between cases. */
export const resetGoogleKeyCache = () => {
  googleKeys = null;
};

const b64urlBytes = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const b64urlJson = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function googleJwks(fetchFn: Fetch, nowMs: number): Promise<Jwk[] | null> {
  if (googleKeys !== null && googleKeys.until > nowMs) return googleKeys.keys;
  const r = await fetchFn(GOOGLE_CERTS);
  if (!r.ok) return null;
  const body = (await r.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) return null;
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  googleKeys = { keys: body.keys, until: nowMs + Math.min(maxAge, 86_400) * 1000 };
  return body.keys;
}

export async function verifyGoogleIdToken(idToken: string, opts: { clientId: string | undefined; fetch?: Fetch; nowMs?: number }): Promise<ProviderCheck> {
  if (opts.clientId === undefined || opts.clientId === "") return { ok: false, reason: "NOT_CONFIGURED", message: "Google sign-in is not set up (GOOGLE_CLIENT_ID)" };
  const bad = (message: string): ProviderCheck => ({ ok: false, reason: "INVALID_TOKEN", message });
  const nowMs = opts.nowMs ?? Date.now();
  const parts = idToken.split(".");
  if (parts.length !== 3) return bad("not a JWT");
  let header: { alg?: string; kid?: string };
  let claims: { iss?: string; aud?: string; sub?: string; exp?: number; iat?: number };
  try {
    header = b64urlJson(parts[0]!) as typeof header;
    claims = b64urlJson(parts[1]!) as typeof claims;
  } catch {
    return bad("unreadable token");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") return bad("unexpected algorithm");
  let keys: Jwk[] | null;
  try {
    keys = await googleJwks(opts.fetch ?? fetch, nowMs);
  } catch {
    keys = null;
  }
  if (keys === null) return { ok: false, reason: "PROVIDER_UNAVAILABLE", message: "could not load Google's keys" };
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (jwk === undefined) return bad("unknown signing key");
  const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]!), signed);
  if (!valid) return bad("bad signature");
  if (!GOOGLE_ISSUERS.includes(claims.iss ?? "")) return bad("wrong issuer");
  if (claims.aud !== opts.clientId) return bad("token is for another app");
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) return bad("token expired");
  if (typeof claims.sub !== "string" || claims.sub === "" || claims.sub.length > 255) return bad("no subject");
  return { ok: true, subject: claims.sub };
}

export async function verifyFacebookToken(accessToken: string, opts: { appId: string | undefined; appSecret: string | undefined; fetch?: Fetch; nowMs?: number }): Promise<ProviderCheck> {
  if (!opts.appId || !opts.appSecret) return { ok: false, reason: "NOT_CONFIGURED", message: "Facebook sign-in is not set up (FACEBOOK_APP_ID, FACEBOOK_APP_SECRET)" };
  const url = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${opts.appId}|${opts.appSecret}`)}`;
  let body: { data?: { is_valid?: boolean; app_id?: string; user_id?: string; expires_at?: number } };
  try {
    const r = await (opts.fetch ?? fetch)(url);
    if (!r.ok && r.status >= 500) return { ok: false, reason: "PROVIDER_UNAVAILABLE", message: "Facebook did not answer" };
    body = (await r.json()) as typeof body;
  } catch {
    return { ok: false, reason: "PROVIDER_UNAVAILABLE", message: "Facebook did not answer" };
  }
  const d = body.data;
  if (d?.is_valid !== true) return { ok: false, reason: "INVALID_TOKEN", message: "Facebook says the token is not valid" };
  if (d.app_id !== opts.appId) return { ok: false, reason: "INVALID_TOKEN", message: "token is for another app" };
  const nowMs = opts.nowMs ?? Date.now();
  if (typeof d.expires_at === "number" && d.expires_at !== 0 && d.expires_at * 1000 <= nowMs) return { ok: false, reason: "INVALID_TOKEN", message: "token expired" };
  if (typeof d.user_id !== "string" || !/^[0-9]{1,40}$/.test(d.user_id)) return { ok: false, reason: "INVALID_TOKEN", message: "no user" };
  return { ok: true, subject: d.user_id };
}
