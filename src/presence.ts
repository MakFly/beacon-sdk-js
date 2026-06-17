/**
 * Beacon Presence — real-time visitor tracking (browser-only).
 *
 * Lightweight heartbeat client (~1.5KB gzipped). Sends a ping every interval
 * to the ingester's POST /v1/presence endpoint. Pauses when the tab is hidden.
 *
 * Usage (script tag):
 *   <script type="module">
 *     import { BeaconPresence } from "@makfly/beacon-sdk-js/presence";
 *     const presence = BeaconPresence.init({
 *       endpoint: "https://beacon.iautos.fr",
 *       token: "pub_iautos_web",
 *     });
 *     // Optional: link to authenticated user
 *     presence.identify({ id: "user-123", email: "user@example.com", name: "John" });
 *   </script>
 */

import { generateUuid } from "./ids";

const STORAGE_KEY = "beacon_visitor_id";
const DEFAULT_INTERVAL = 30_000;

export interface PresenceConfig {
  endpoint: string;
  token: string;
  intervalMs?: number;
}

export interface PresenceUser {
  id: string;
  email?: string;
  name?: string;
}

export interface PresenceHeartbeat {
  visitor_id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  page_url: string;
  page_title: string;
  referrer: string;
  viewport_width: number;
  viewport_height: number;
  screen_width: number;
  screen_height: number;
  language: string;
  timezone: string;
  session_started_at: string;
}

function getOrCreateVisitorId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    const id = generateUuid();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return generateUuid();
  }
}

export class BeaconPresence {
  private readonly endpoint: string;
  private readonly token: string;
  private readonly intervalMs: number;
  private readonly visitorId: string;
  private readonly sessionStartedAt: string;

  private user: PresenceUser | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private visible = true;

  private constructor(config: PresenceConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.token = config.token;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL;
    this.visitorId = getOrCreateVisitorId();
    this.sessionStartedAt = new Date().toISOString();
  }

  static init(config: PresenceConfig): BeaconPresence {
    const instance = new BeaconPresence(config);
    instance.start();
    return instance;
  }

  /** Auto-configure from env vars. Returns null if BEACON_URL / BEACON_TOKEN are absent. */
  static autoInit(): BeaconPresence | null {
    if (typeof window === "undefined") return null;
    const endpoint =
      (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BEACON_URL) ||
      document.currentScript?.getAttribute("data-endpoint") ||
      "";
    const token =
      (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BEACON_TOKEN) ||
      document.currentScript?.getAttribute("data-token") ||
      "";
    if (!endpoint || !token) return null;
    return BeaconPresence.init({ endpoint, token });
  }

  identify(user: PresenceUser): void {
    this.user = user;
    this.ping();
  }

  /** Clear user identity (logout). */
  reset(): void {
    this.user = null;
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private start(): void {
    this.ping();
    this.timer = setInterval(() => {
      if (this.visible) this.ping();
    }, this.intervalMs);

    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private readonly onVisibility = (): void => {
    this.visible = !document.hidden;
    if (this.visible) this.ping();
  };

  private ping(): void {
    const payload: PresenceHeartbeat = {
      visitor_id: this.visitorId,
      user_id: this.user?.id ?? null,
      user_email: this.user?.email ?? null,
      user_name: this.user?.name ?? null,
      page_url: location.href,
      page_title: document.title,
      referrer: document.referrer,
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      screen_width: screen.width,
      screen_height: screen.height,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      session_started_at: this.sessionStartedAt,
    };

    const url = `${this.endpoint}/v1/presence?token=${encodeURIComponent(this.token)}`;
    const body = JSON.stringify(payload);

    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Beacon-Token": this.token },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  }
}
