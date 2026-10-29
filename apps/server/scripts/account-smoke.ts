// End-to-end sign-in check against `wrangler dev` (O10/O11, Nut 2026-10-07): make an in-game ID, wrong
// password refused, sign in, 10 character places, two characters that share nothing, walk the map with
// the session (WebSocket), Google/Facebook refused while not set up, change the password, delete a character
// (Nut 2026-10-18: everything goes except what is in the account vault), sign out ends the session.
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:account`.
import { api, run, type Msg } from "./smoke-lib";

const call = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(`${api}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, body: (await r.json()) as Msg };
};
const must = (ok: boolean, what: string, got: unknown) => {
  if (!ok) throw new Error(`${what}: ${JSON.stringify(got)}`);
};
const out: Record<string, unknown> = {};
const loginId = `smoke_${run}`;
const password = "smoke-password-1";

out.config = (await call("GET", "/auth/config")).body;
const reg = await call("POST", "/auth/register", { loginId, password });
must(reg.status === 200 && reg.body.account.slots.length === 10, "register", reg);
out.registerTaken = (await call("POST", "/auth/register", { loginId: loginId.toUpperCase(), password })).body.error;
out.wrongPassword = (await call("POST", "/auth/login", { loginId, password: "nope-nope" })).body.error;
const login = await call("POST", "/auth/login", { loginId, password });
must(login.status === 200, "login", login);
const token = login.body.token as string;
out.noTokenCharacter = (await call("GET", "/character")).status;
out.noPlaceYet = (await call("GET", "/character", undefined, token)).status;

const make = async (slot: number, name: string) => {
  const sel = await call("POST", "/account/select", { slot }, token);
  must(sel.status === 200 && sel.body.account.selectedSlot === slot, `select ${slot}`, sel);
  must((await call("GET", "/character", undefined, token)).status === 404, `place ${slot} starts empty`, null);
  const c = await call("POST", "/character", { operationId: `op_acc_${run}_${slot}`, name, classId: "class:striker", raceId: "race:human", element: "FIRE" }, token);
  must(c.status === 200, `create in ${slot}`, c);
  return c.body.character.id as string;
};
const first = await make(1, "หนึ่ง");
const coins1 = (await call("GET", "/character", undefined, token)).body.coins;
const second = await make(10, "สิบ");
must(first !== second, "two characters", [first, second]);
out.outOfRange = (await call("POST", "/account/select", { slot: 11 }, token)).body.error;
const view = (await call("GET", "/account", undefined, token)).body;
out.places = view.slots.filter((s: Msg) => s.character !== null).map((s: Msg) => `${s.slot}:${s.character.name}`);
// Buying in slot 10 must not touch slot 1's coins.
await call("POST", "/account/select", { slot: 1 }, token);
must((await call("GET", "/character", undefined, token)).body.character.name === "หนึ่ง", "back to slot 1", null);
must((await call("GET", "/character", undefined, token)).body.coins === coins1, "slot 1 coins unchanged", null);

// The map socket takes the session in the query (browsers cannot set headers on a WebSocket).
const ws = new WebSocket(`${api.replace(/^http/, "ws")}/world/map:dawn_town/1?session=${encodeURIComponent(token)}`);
const welcome = await new Promise<Msg>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("no welcome")), 5000);
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === "welcome") {
      clearTimeout(t);
      resolve(m);
    }
  };
  ws.onerror = () => reject(new Error("socket error"));
});
out.worldName = welcome.self.name;
ws.close();

out.google = (await call("POST", "/auth/google", { idToken: "x".repeat(40) })).body.error;
out.facebook = (await call("POST", "/auth/facebook", { accessToken: "x".repeat(40) })).body.error;
// Change the password (P21): the old one is refused, the other sign-in (from register) ends, this one stays.
const newPassword = "smoke-password-2";
out.changeWrong = (await call("POST", "/auth/password", { currentPassword: "nope-nope", newPassword }, token)).body.error;
out.change = (await call("POST", "/auth/password", { currentPassword: password, newPassword }, token)).status;
out.otherSignInAfterChange = (await call("GET", "/account", undefined, reg.body.token)).status;
out.thisSignInAfterChange = (await call("GET", "/account", undefined, token)).status;
out.oldPassword = (await call("POST", "/auth/login", { loginId, password })).body.error;
out.newPassword = (await call("POST", "/auth/login", { loginId, password: newPassword })).status;
must(out.changeWrong === "BAD_CREDENTIALS" && out.change === 200 && out.otherSignInAfterChange === 401 && out.thisSignInAfterChange === 200 && out.oldPassword === "BAD_CREDENTIALS" && out.newPassword === 200, "password change", out);

// Delete slot 10 (Nut 2026-10-18): what it put in the vault stays; the place starts over from nothing.
await call("POST", "/account/select", { slot: 10 }, token);
const ws10 = new WebSocket(`${api.replace(/^http/, "ws")}/world/map:dawn_town/1?session=${encodeURIComponent(token)}`);
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("no welcome")), 5000);
  ws10.onmessage = (e) => {
    if (JSON.parse(String(e.data)).t === "welcome") {
      clearTimeout(t);
      resolve();
    }
  };
});
const dep = await call("POST", "/vault/deposit", { operationId: `accdep_${run}`, items: [{ itemId: "item:small_potion", quantity: 2 }], equipmentIds: [], coins: 0 }, token);
must(dep.status === 200, "deposit before delete", dep);
ws10.close();
const delBody = { operationId: `accdel_${run}`, slot: 10, confirmName: "สิบ", password: newPassword };
out.deleteWrongName = (await call("POST", "/account/delete", { ...delBody, confirmName: "สิ" }, token)).body.error;
out.deleteWrongPassword = (await call("POST", "/account/delete", { ...delBody, password: "nope-nope" }, token)).body.error;
const del1 = await call("POST", "/account/delete", delBody, token);
const del2 = await call("POST", "/account/delete", delBody, token);
must(del1.status === 200 && del2.status === 200 && del1.body.account.slots[9].character === null, "delete", [del1, del2]);
out.characterAfterDelete = (await call("GET", "/character", undefined, token)).status;
await call("POST", "/account/select", { slot: 10 }, token);
out.placeAfterDelete = (await call("GET", "/character", undefined, token)).status;
await call("POST", "/account/select", { slot: 1 }, token);
out.vaultKept = (await call("GET", "/vault", undefined, token)).body.items.map((i: Msg) => `${i.itemId}×${i.quantity}`);
must(
  out.deleteWrongName === "NAME_MISMATCH" && out.deleteWrongPassword === "BAD_CREDENTIALS" && out.characterAfterDelete === 401 && out.placeAfterDelete === 404 && String(out.vaultKept) === "item:small_potion×2",
  "character delete",
  out,
);
await call("POST", "/auth/logout", {}, token);
out.afterLogout = (await call("GET", "/account", undefined, token)).status;
out.characterAfterLogout = (await call("GET", "/character", undefined, token)).status;

must(out.registerTaken === "LOGIN_ID_TAKEN" && out.wrongPassword === "BAD_CREDENTIALS" && out.noTokenCharacter === 401 && out.noPlaceYet === 401, "refusals", out);
must(out.outOfRange === "INVALID_REQUEST" && out.worldName === "หนึ่ง" && out.afterLogout === 401 && out.characterAfterLogout === 401, "results", out);
console.log(JSON.stringify(out, null, 2));
