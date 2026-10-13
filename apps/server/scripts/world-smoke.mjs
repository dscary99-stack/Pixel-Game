// End-to-end walking-slice check against `wrangler dev` (real workerd, Map Channel DOs, local D1).
// Run `npm run db:migrate:local` and `npm run dev:server` first, then `npm run smoke:world`.
const api = process.env.API ?? "http://127.0.0.1:8787";
const ws = api.replace(/^http/, "ws");
const run = Date.now().toString(36);
const acct = (n) => `acct:w${run}_${n}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Opens a socket and records every message it receives. */
function connect(account, mapId = "map:dawn_town", channel = 1) {
  const sock = new WebSocket(`${ws}/world/${mapId}/${channel}?dev_account=${encodeURIComponent(account)}`);
  const c = { sock, inbox: [], closed: null, seq: 0 };
  sock.onmessage = (e) => c.inbox.push(JSON.parse(String(e.data)));
  sock.onclose = (e) => (c.closed = e.reason || String(e.code));
  c.step = (dir) => sock.send(JSON.stringify({ t: "step", seq: ++c.seq, dir }));
  c.wait = async (pred, ms = 3000) => {
    for (let t = 0; t < ms; t += 25) {
      const hit = c.inbox.find(pred);
      if (hit) return hit;
      await sleep(25);
    }
    throw new Error(`timeout waiting on ${account}; inbox=${JSON.stringify(c.inbox.slice(-5))}`);
  };
  return c;
}
const out = {};

// Two players in the same map and channel see each other.
const A = connect(acct("a"));
const welcomeA = await A.wait((m) => m.t === "welcome");
const B = connect(acct("b"));
const welcomeB = await B.wait((m) => m.t === "welcome");
out.aSpawn = welcomeA.self;
out.bSeesA = welcomeB.others.map((p) => p.name);
out.aSeesBJoin = (await A.wait((m) => m.t === "joined")).player.name;

// A walks; B sees it.
A.step("N");
out.aAck = await A.wait((m) => m.t === "ack");
out.bSeesMove = await B.wait((m) => m.t === "moved");

// Collision: (12,7) north is road at (12,6)? Walk into the house wall at (9,6) instead via west steps is slow;
// use the map edge: the top wall row is y=0, so from (12,7) walking N repeatedly must hit "#" at y=0.
await sleep(300);
for (let i = 0; i < 8; i++) {
  A.step("N");
  await sleep(270);
}
out.wallCorrection = (await A.wait((m) => m.t === "correct" && m.reason === "BLOCKED")).reason;

// Speed hack: 20 steps at once. Only the burst allowance gets through.
await sleep(700);
const before = A.inbox.length;
for (let i = 0; i < 20; i++) A.step("S");
await sleep(800);
const burst = A.inbox.slice(before);
out.speedHack = { accepted: burst.filter((m) => m.t === "ack").length, tooFast: burst.filter((m) => m.reason === "TOO_FAST").length };

// Garbage and replays are refused without moving anyone.
A.sock.send("not json");
A.sock.send(JSON.stringify({ t: "teleport", x: 23, y: 8 }));
out.invalid = (await A.wait((m) => m.t === "error")).code;

// Flooding: 60 messages at once. The budget answers about 20, the rest are dropped with one warning.
await sleep(2500);
const floodFrom = A.inbox.length;
for (let i = 0; i < 60; i++) A.sock.send(JSON.stringify({ t: "ping" }));
await sleep(800);
const flood = A.inbox.slice(floodFrom);
out.flood = { answered: flood.filter((m) => m.t === "pong").length, warnings: flood.filter((m) => m.code === "RATE_LIMITED").length };
if (out.flood.answered > 25 || out.flood.warnings !== 1) throw new Error(`flood: ${JSON.stringify(out.flood)}`);
await sleep(2500);

// Teleport by connecting to another map: told to go where the character really is.
const T = connect(acct("b"), "map:dawn_field");
out.wrongMap = await T.wait((m) => m.t === "transfer");
out.bStillConnected = B.closed === null;

// Reconnect on the same channel replaces the old socket; B sees no second A.
await sleep(400);
const livePos = { x: A.inbox.filter((m) => m.t === "ack").at(-1).x, y: A.inbox.filter((m) => m.t === "ack").at(-1).y };
const bJoinsBefore = B.inbox.filter((m) => m.t === "joined").length;
const A2 = connect(acct("a"));
const welcomeA2 = await A2.wait((m) => m.t === "welcome");
out.reconnect = {
  oldKicked: (await A.wait((m) => m.t === "kicked")).reason,
  samePosition: welcomeA2.self.x === livePos.x && welcomeA2.self.y === livePos.y,
  sameSid: welcomeA2.self.sid === welcomeA.self.sid,
  bSawExtraJoin: B.inbox.filter((m) => m.t === "joined").length !== bJoinsBefore,
};

// Channel switch: A moves to channel 2; channel 1 evicts the old socket and B sees A leave.
const A3 = connect(acct("a"), "map:dawn_town", 2);
const welcomeA3 = await A3.wait((m) => m.t === "welcome");
out.channelSwitch = {
  channel: welcomeA3.channel,
  oldEvicted: (await A2.wait((m) => m.t === "kicked")).reason,
  bSawLeave: (await B.wait((m) => m.t === "left")).sid === welcomeA.self.sid,
  keptPosition: welcomeA3.self.x === livePos.x && welcomeA3.self.y === livePos.y,
};

// Portal: B walks east along the road to the town gate and lands in the field.
let pos = welcomeB.self;
while (pos.x < 23) {
  B.step("E");
  pos = await B.wait((m) => (m.t === "ack" || m.t === "correct") && m.seq === B.seq);
  await sleep(260);
}
out.portal = await B.wait((m) => m.t === "transfer");
const B2 = connect(acct("b"), out.portal.mapId, out.portal.channel);
const welcomeField = await B2.wait((m) => m.t === "welcome");
out.arrived = { mapId: welcomeField.mapId, x: welcomeField.self.x, y: welcomeField.self.y };
out.where = await (await fetch(`${api}/world/where?dev_account=${encodeURIComponent(acct("b"))}`)).json();

// Leave and come back: the saved position survives.
B2.step("E");
await B2.wait((m) => m.t === "ack");
B2.sock.close();
await sleep(500);
const B3 = connect(acct("b"), "map:dawn_field", 1);
out.afterRelog = (await B3.wait((m) => m.t === "welcome")).self;

// Packs wander (P33): within a few seconds the field sends steps for packs B can see.
const listed = (await B3.wait((m) => m.t === "packs")).packs;
const moves = (await B3.wait((m) => m.t === "packMoves", 20000)).moves;
out.packMoves = moves;
for (const mv of moves) {
  const p = listed.find((q) => q.packId === mv.packId);
  if (p !== undefined && Math.abs(p.x - mv.x) + Math.abs(p.y - mv.y) > 5) throw new Error(`pack jumped: ${JSON.stringify({ p, mv })}`);
}

// A full channel sends a newcomer to the other channel instead of refusing (P11 capacity).
const fillers = [];
let sent = null;
let last = "";
for (let i = 0; i < 60 && sent === null; i++) {
  last = acct(`fill${i}`);
  const f = connect(last, "map:dawn_town", 2);
  const m = await f.wait((x) => x.t === "welcome" || x.t === "transfer" || x.t === "error");
  fillers.push(f);
  if (m.t !== "welcome") sent = m;
}
out.fullChannel = { joinedBeforeFull: fillers.length - 1, then: sent };
if (sent?.t !== "transfer" || sent.channel !== 1 || sent.reason !== "CHANNEL_FULL") throw new Error(`full channel: ${JSON.stringify(sent)}`);
out.fullChannel.counts = (await (await fetch(`${api}/world/channels/map:dawn_town?dev_account=${encodeURIComponent(acct("a"))}`)).json()).channels;
if (out.fullChannel.counts.find((c) => c.channel === 2)?.players !== out.fullChannel.counts[0].capacity) throw new Error(`counts: ${JSON.stringify(out.fullChannel.counts)}`);
const moved = connect(last, sent.mapId, sent.channel);
out.fullChannel.landed = (await moved.wait((m) => m.t === "welcome")).channel;
for (const f of [...fillers, moved]) f.sock.close();

out.unauthenticated = (await fetch(`${api}/world/where`)).status;
for (const c of [A, A2, A3, B, B2, B3, T]) c.sock.close();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
