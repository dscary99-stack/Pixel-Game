// End-to-end smoke test against `wrangler dev` (real workerd + Durable Object storage + local D1).
// Apply D1 migrations first: npm run db:migrate:local
const api = process.env.API ?? "http://127.0.0.1:8787";
const battleId = `battle:smoke-${Date.now()}`;
const base = `${api}/battles/${battleId}`;
const account = `acct:smoke-${Date.now()}`;
const H = { "content-type": "application/json", "x-dev-account": account };
const inventory = async () => (await fetch(`${api}/dev/inventory?battle=${battleId}`, { headers: H })).json();
const call = async (method, path, body, headers = H) => {
  const r = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};
const out = {};
out.noAuth = (await call("GET", "", undefined, {})).status;
out.created = (await call("POST", "/dev-create", {})).status;
out.createdAgain = (await call("POST", "/dev-create", {})).status;
out.inventoryDuringFight = await inventory();
{
  const other = await fetch(`${api}/battles/${battleId}-second/dev-create`, { method: "POST", headers: H, body: "{}" });
  out.secondBattleWhileOpen = `${other.status} ${(await other.json()).error}`;
}
const gen = (await call("POST", "/session")).body.sessionGeneration;
let view = (await call("GET", "")).body;
out.rngHidden = !JSON.stringify(view).includes('"rng"');
out.actor = view.actor;
const potion = { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion,
  command: { type: "item", actorId: "player", itemId: "item:small_potion", targetId: "player" } };
const a = await call("POST", "/commands", potion);
const b = await call("POST", "/commands", potion);
out.first = a.body.status; out.retryReplayed = b.body.replayed; out.sameEvents = JSON.stringify(a.body.events) === JSON.stringify(b.body.events);
view = (await call("GET", "")).body;
out.potionsLeft = view.state.bag["item:small_potion"];
out.stale = (await call("POST", "/commands", { ...potion, commandId: crypto.randomUUID(), expectedStateVersion: 0 })).body.reasonCode;
out.oldSession = (await call("POST", "/commands", { ...potion, commandId: crypto.randomUUID(), sessionGeneration: gen - 1, expectedStateVersion: view.state.stateVersion })).body.reasonCode;
out.intruder = (await call("GET", "", undefined, { ...H, "x-dev-account": "acct:other" })).body.error;
let steps = 0;
while (view.state.status === "active" && steps < 300) {
  // The server holds Auto to one action per autoBattleActionMs (700 ms).
  await new Promise((r) => setTimeout(r, 720));
  const r = await call("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion });
  if (r.body.status !== "accepted") { out.autoReject = r.body; break; }
  view = (await call("GET", "")).body; steps++;
}
out.autoSteps = steps; out.final = view.state.status; out.entitlements = view.state.entitlements.map((e) => e.entitlementId);
const events = (await call("GET", "/events?since=0")).body.events;
out.eventCount = events.length; out.uniqueSeq = new Set(events.map((e) => e.seq)).size === events.length;
out.captures = events.filter((e) => e.type === "CaptureResolved").length;
out.unusedInBattle = view.state.bag;
// The DO alarm drains the outbox; wait for settlement to reach D1.
for (let i = 0; i < 50; i++) {
  view = (await call("GET", "")).body;
  if (view.settlement.settled || view.settlement.failed > 0) break;
  await new Promise((r) => setTimeout(r, 200));
}
out.settlement = view.settlement;
out.inventoryAfter = await inventory();
out.reconcile = await (await fetch(`${api}/dev/reconcile`, { method: "POST", headers: H })).json();
console.log(JSON.stringify(out, null, 1));
