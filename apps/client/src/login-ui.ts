/**
 * Sign-in and the character screen (O10/O11, Nut 2026-10-07). The player signs in with an ID made in the
 * game, Google or Facebook, then picks one of 10 character places. The server checks the Google and
 * Facebook tokens itself; the client only passes them on. The sign-in is remembered in localStorage
 * (a per-browser convenience; the server decides whether it is still valid).
 */
import type { AccountView, SessionGrant } from "@pmrpg/shared";
import { el, overlay } from "./character-ui";
import type { Identity } from "./identity";

const TOKEN_KEY = "pmrpg.session";

interface AuthConfig {
  providers: ("google" | "facebook" | "local")[];
  googleClientId: string | null;
  facebookAppId: string | null;
  maxCharacters: number;
}

const ERROR_TH: Record<string, string> = {
  INVALID_REQUEST: "ID ต้องยาว 4–24 ตัว (A–Z a–z 0–9 _ . -) และรหัสผ่านอย่างน้อย 8 ตัว",
  LOGIN_ID_TAKEN: "ID นี้มีคนใช้แล้ว",
  BAD_CREDENTIALS: "ID หรือรหัสผ่านไม่ถูกต้อง",
  LOCKED: "ใส่รหัสผิดหลายครั้ง รอสักครู่แล้วลองใหม่",
  INVALID_TOKEN: "เข้าสู่ระบบกับผู้ให้บริการไม่สำเร็จ",
  NOT_CONFIGURED: "ยังไม่ได้ตั้งค่าการเข้าสู่ระบบแบบนี้",
  PROVIDER_UNAVAILABLE: "ผู้ให้บริการไม่ตอบ ลองใหม่อีกครั้ง",
};

async function post<T>(base: string, path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(ERROR_TH[json.error ?? ""] ?? json.error ?? String(res.status));
  return json as T;
}

const saved = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const save = (token: string | null) => {
  try {
    if (token === null) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: sign in again next time */
  }
};

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.append(s);
  });

/** Sign in (or reuse the remembered sign-in), then pick a character place. Resolves once a place is in play. */
export async function signInAndPick(base: string): Promise<Identity> {
  let token = saved();
  let account: AccountView | null = null;
  if (token !== null) {
    const res = await fetch(`${base}/account`, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) account = (await res.json()) as AccountView;
    else save((token = null));
  }
  if (token === null || account === null) {
    const grant = await signInForm(base);
    token = grant.token;
    account = grant.account;
    save(token);
  }
  const slot = await characterScreen(base, token, account);
  return { kind: "session", token, label: `ตัวละครช่อง ${slot}` };
}

function signInForm(base: string): Promise<SessionGrant> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    panel.append(el("h2", {}, "เข้าสู่ระบบ"));
    panel.append(el("label", { for: "pm-login-id" }, "ID"));
    const id = el("input", { id: "pm-login-id", type: "text", maxlength: "24", autocomplete: "username" });
    panel.append(id);
    panel.append(el("label", { for: "pm-login-pw" }, "รหัสผ่าน"));
    const pw = el("input", { id: "pm-login-pw", type: "password", maxlength: "128", autocomplete: "current-password" });
    pw.style.cssText = "width:100%;box-sizing:border-box;padding:10px;font-size:16px;border-radius:6px;border:1px solid #463f6b;background:#14121c;color:#fff";
    panel.append(pw);
    const error = el("div", { class: "pm-error", role: "alert" });
    const actions = el("div", { class: "pm-actions" });
    const register = el("button", { type: "button" }, "สร้าง ID ใหม่");
    const login = el("button", { type: "button", class: "primary" }, "เข้าสู่ระบบ");
    actions.append(register, login);
    const others = el("div", { class: "pm-actions" });
    others.style.justifyContent = "flex-start";
    const orNote = el("div", { class: "pm-note" }, "หรือเข้าด้วยบัญชีอื่น");
    orNote.hidden = true;
    panel.append(actions, orNote, others, error);
    id.focus();

    const done = (g: SessionGrant) => {
      close();
      resolve(g);
    };
    const run = async (fn: () => Promise<SessionGrant>) => {
      error.textContent = "";
      for (const b of [register, login]) b.disabled = true;
      try {
        done(await fn());
      } catch (e) {
        error.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        for (const b of [register, login]) b.disabled = false;
      }
    };
    const creds = () => ({ loginId: id.value.trim(), password: pw.value });
    login.addEventListener("click", () => void run(() => post<SessionGrant>(base, "/auth/login", creds())));
    register.addEventListener("click", () => void run(() => post<SessionGrant>(base, "/auth/register", creds())));
    pw.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void run(() => post<SessionGrant>(base, "/auth/login", creds()));
    });

    // Google and Facebook buttons appear only when the server has them set up.
    void (async () => {
      const cfg = (await (await fetch(`${base}/auth/config`)).json().catch(() => null)) as AuthConfig | null;
      if (cfg === null) return;
      orNote.hidden = !cfg.providers.some((p) => p !== "local");
      if (cfg.providers.includes("google") && cfg.googleClientId !== null) {
        const box = el("div");
        others.append(box);
        await loadScript("https://accounts.google.com/gsi/client").catch(() => undefined);
        const g = (window as unknown as { google?: { accounts: { id: { initialize(o: unknown): void; renderButton(e: HTMLElement, o: unknown): void } } } }).google;
        g?.accounts.id.initialize({ client_id: cfg.googleClientId, callback: (r: { credential: string }) => void run(() => post<SessionGrant>(base, "/auth/google", { idToken: r.credential })) });
        g?.accounts.id.renderButton(box, { theme: "filled_black", text: "signin_with" });
      }
      if (cfg.providers.includes("facebook") && cfg.facebookAppId !== null) {
        const fbButton = el("button", { type: "button" }, "เข้าด้วย Facebook");
        others.append(fbButton);
        fbButton.addEventListener("click", () => {
          void (async () => {
            type FB = { init(o: unknown): void; login(cb: (r: { authResponse?: { accessToken: string } }) => void): void };
            let fb = (window as unknown as { FB?: FB }).FB;
            if (fb === undefined) {
              await loadScript("https://connect.facebook.net/en_US/sdk.js").catch(() => undefined);
              fb = (window as unknown as { FB?: FB }).FB;
              fb?.init({ appId: cfg.facebookAppId, version: "v19.0" });
            }
            fb?.login((r) => {
              if (r.authResponse !== undefined) void run(() => post<SessionGrant>(base, "/auth/facebook", { accessToken: r.authResponse!.accessToken }));
            });
          })();
        });
      }
    })();
  });
}

/** The 10 character places. Picking one puts it in play; an empty one then goes to character creation. */
function characterScreen(base: string, token: string, account: AccountView): Promise<number> {
  return new Promise((resolve) => {
    const { panel, close } = overlay();
    panel.append(el("h2", {}, `เลือกตัวละคร (${account.slots.filter((s) => s.character !== null).length}/${account.maxCharacters})`));
    panel.append(el("div", { class: "pm-note" }, "แต่ละตัวมีของ เหรียญ คู่ใจ และเควสของตัวเอง ไม่ใช้ร่วมกัน"));
    const grid = el("div", { class: "pm-slots" });
    grid.style.marginTop = "10px";
    const error = el("div", { class: "pm-error", role: "alert" });
    for (const s of account.slots) {
      const b = el("button", { type: "button", class: "pm-slot", "data-slot": String(s.slot) });
      b.style.cssText = "color:#fff;cursor:pointer;text-align:left";
      b.append(el("b", {}, `ช่อง ${s.slot}${account.selectedSlot === s.slot ? " · เล่นล่าสุด" : ""}`));
      b.append(document.createTextNode(s.character === null ? "+ สร้างตัวละครใหม่" : `${s.character.name} · Lv${s.character.level}`));
      b.addEventListener("click", () => {
        void (async () => {
          try {
            await post(base, "/account/select", { slot: s.slot }, token);
            close();
            resolve(s.slot);
          } catch (e) {
            error.textContent = e instanceof Error ? e.message : String(e);
          }
        })();
      });
      grid.append(b);
    }
    const actions = el("div", { class: "pm-actions" });
    const out = el("button", { type: "button" }, "ออกจากระบบ");
    out.addEventListener("click", () => {
      void post(base, "/auth/logout", {}, token).catch(() => undefined);
      save(null);
      location.reload();
    });
    actions.append(out);
    panel.append(grid, error, actions);
  });
}
