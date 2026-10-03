/**
 * How the client talks to the battle. The scene only ever sees public state and events.
 *
 * - HttpTransport: the real path, against the Worker + Battle Durable Object.
 * - LocalPreviewTransport: runs the shared kernel in the browser with DEV fixture rules so the
 *   scene can be developed without a server. It is NOT authoritative and must never grant rewards.
 */
import {
  DEV_FIXTURE_RULES,
  applyCommand,
  chooseAutoCommand,
  createBattle,
  currentActor,
  exampleContentMaps,
  publicView,
  type BattleCommand,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type CommandResponse,
  type PublicBattleState,
} from "@pmrpg/shared";

export interface Snapshot {
  state: PublicBattleState;
  actor: string | null;
}

export interface BattleTransport {
  readonly label: string;
  start(): Promise<{ snapshot: Snapshot; events: BattleEvent[] }>;
  send(command: BattleCommand): Promise<{ response: CommandResponse; snapshot: Snapshot }>;
  autoStep(): Promise<{ response: CommandResponse; snapshot: Snapshot }>;
}

export class LocalPreviewTransport implements BattleTransport {
  readonly label = "LOCAL PREVIEW · ไม่ใช่ผลจริงจาก server";
  private readonly content = exampleContentMaps();
  private state!: BattleState;

  constructor(private readonly setup: BattleSetup) {}

  async start() {
    const r = createBattle(DEV_FIXTURE_RULES, this.content, this.setup);
    if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
    this.state = r.state;
    return { snapshot: this.snapshot(), events: r.events };
  }

  async send(command: BattleCommand) {
    return this.apply(command, "player");
  }

  async autoStep() {
    const cmd = chooseAutoCommand(this.state);
    if (cmd === null) return { response: this.reject("BATTLE_OVER", "nothing to do"), snapshot: this.snapshot() };
    return this.apply(cmd, "auto");
  }

  private async apply(command: BattleCommand, source: "player" | "auto") {
    const commandId = crypto.randomUUID();
    const r = applyCommand(DEV_FIXTURE_RULES, this.content, this.state, command, { source, causeId: commandId });
    if (!r.ok) return { response: this.reject(r.code, r.message, commandId), snapshot: this.snapshot() };
    this.state = r.state;
    const response: CommandResponse = {
      status: "accepted",
      commandId,
      stateVersion: r.state.stateVersion,
      eventCursor: r.state.eventSeq,
      events: r.events,
      replayed: false,
    };
    return { response, snapshot: this.snapshot() };
  }

  private reject(code: Extract<CommandResponse, { status: "rejected" }>["reasonCode"], message: string, commandId = ""): CommandResponse {
    return { status: "rejected", commandId, reasonCode: code, message, stateVersion: this.state.stateVersion, eventCursor: this.state.eventSeq };
  }

  private snapshot(): Snapshot {
    return { state: publicView(this.state), actor: currentActor(this.state)?.unitId ?? null };
  }
}

/** Talks to apps/server (wrangler dev). Identity uses the dev header until O11 picks auth. */
export class HttpTransport implements BattleTransport {
  readonly label: string;
  private generation = 0;
  private snap!: Snapshot;

  /**
   * `attach`: the battle already exists (the Map Channel created it when the player engaged a pack),
   * so start() only claims a session and reads it. Otherwise start() asks dev-create for an example.
   */
  constructor(
    private readonly base: string,
    private readonly battleId: string,
    private readonly devAccount: string,
    private readonly attach = false,
  ) {
    this.label = `SERVER · ${base || "wrangler dev via Vite proxy"}`;
  }

  async start() {
    const events = this.attach
      ? (await this.call<{ events: BattleEvent[] }>("GET", "events?since=0")).events
      : (await this.call<{ events: BattleEvent[] }>("POST", "dev-create", {})).events;
    this.generation = (await this.call<{ sessionGeneration: number }>("POST", "session")).sessionGeneration;
    await this.refresh();
    return { snapshot: this.snap, events };
  }

  async send(command: BattleCommand) {
    const response = await this.call<CommandResponse>("POST", "commands", this.envelope({ command }));
    await this.refresh();
    return { response, snapshot: this.snap };
  }

  async autoStep() {
    const response = await this.call<CommandResponse>("POST", "auto", this.envelope({}));
    await this.refresh();
    return { response, snapshot: this.snap };
  }

  private envelope(extra: object) {
    return { commandId: crypto.randomUUID(), sessionGeneration: this.generation, expectedStateVersion: this.snap?.state.stateVersion ?? 0, ...extra };
  }

  private async refresh() {
    this.snap = await this.call<Snapshot>("GET", "");
  }

  private async call<T>(method: string, action: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/battles/${this.battleId}${action ? `/${action}` : ""}`, {
      method,
      headers: { "content-type": "application/json", "x-dev-account": this.devAccount },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
}
