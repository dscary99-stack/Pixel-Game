// End-to-end smoke test against `wrangler dev` (real workerd + Durable Object storage).
const base = `${process.env.API ?? "http://127.0.0.1:8787"}/battles/battle:smoke-${Date.now()}`;
const H = { "content-type": "application/json", "x-dev-account": "acct:nut" };
const call = async (method, path, body, headers = H) => {
  const r = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};
const out = {};
out.noAuth = (await call("GET", "", undefined, {})).status;
out.created = (await call("POST", "/dev-create", {})).status;
out.createdAgain = (await call("POST", "/dev-create", {})).status;
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
  const r = await call("POST", "/auto", { commandId: crypto.randomUUID(), sessionGeneration: gen, expectedStateVersion: view.state.stateVersion });
  if (r.body.status !== "accepted") { out.autoReject = r.body; break; }
  view = (await call("GET", "")).body; steps++;
}
out.autoSteps = steps; out.final = view.state.status; out.entitlements = view.state.entitlements.map((e) => e.entitlementId);
const events = (await call("GET", "/events?since=0")).body.events;
out.eventCount = events.length; out.uniqueSeq = new Set(events.map((e) => e.seq)).size === events.length;
out.captures = events.filter((e) => e.type === "CaptureResolved").length;
console.log(JSON.stringify(out, null, 1));
