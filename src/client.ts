import type {
  BeaconEndpoint,
  ErrorPayload,
  LogPayload,
  Resource,
  TracePayload,
} from "@makfly/beacon-protocol";
import { DEFAULT_CENSOR_KEYS, redactSensitive } from "./redaction";

export interface BeaconClientOptions {
  /** Ingester base URL, e.g. https://beacon.iautos.fr */
  endpoint: string;
  /** Project token sent as X-Beacon-Token. */
  token: string;
  /** Resource attributes attached to every payload. service.name is required. */
  resource: Resource;
  /** Flush the queue when it reaches this many items. Default 20. */
  batchSize?: number;
  /** Auto-flush interval in ms. Default 5000. 0 disables the timer. */
  flushIntervalMs?: number;
  /** Abort one HTTP attempt after this duration. Default 2000ms. */
  requestTimeoutMs?: number;
  /** Maximum attempts for network errors, 408, 429 and 5xx. Default 3. */
  maxAttempts?: number;
  /** Initial exponential backoff delay. Default 200ms. */
  retryBaseDelayMs?: number;
  /** Cap for Retry-After/backoff delays. Default 5000ms. */
  maxRetryDelayMs?: number;
  /** Maximum payloads retained after outages. Default 200. */
  maxBacklogItems?: number;
  /** Deterministic head-sampling rate for traces. Default 1. */
  tracesSampleRate?: number;
  /** Keys recursively replaced with [CENSORED] before transport. */
  censorKeys?: string[];
  /** Network/transport failures are swallowed; set a hook to observe them. */
  onTransportError?: (err: unknown, endpoint: BeaconEndpoint) => void;
  /** Override transport (tests). Defaults to native fetch. */
  fetch?: typeof fetch;
  /** SDK identity for the X-Beacon-Sdk header. */
  sdk?: { name: string; version: string };
  /** Override delay scheduling (tests). */
  sleep?: (delayMs: number) => Promise<void>;
}

interface QueueItem {
  endpoint: BeaconEndpoint;
  body: unknown;
}

/**
 * Lean transport: batches payloads and POSTs them as newline-delimited JSON to the
 * Beacon ingester using native fetch. No external dependency. Failures never throw into
 * the host application — telemetry must never break the app.
 */
export class BeaconClient {
  private readonly opts: Required<Omit<BeaconClientOptions, "onTransportError" | "fetch" | "sdk" | "sleep">> &
    Pick<BeaconClientOptions, "onTransportError" | "fetch" | "sdk" | "sleep">;
  private queue: QueueItem[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: BeaconClientOptions) {
    this.opts = {
      batchSize: 20,
      flushIntervalMs: 5000,
      requestTimeoutMs: 2000,
      maxAttempts: 3,
      retryBaseDelayMs: 200,
      maxRetryDelayMs: 5000,
      maxBacklogItems: 200,
      tracesSampleRate: 1,
      ...options,
      censorKeys: [...DEFAULT_CENSOR_KEYS, ...(options.censorKeys ?? [])],
    };
    if (this.opts.flushIntervalMs > 0 && typeof setInterval === "function") {
      this.timer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
      // Do not keep the Node event loop alive for telemetry.
      (this.timer as { unref?: () => void })?.unref?.();
    }
  }

  captureError(payload: ErrorPayload): void {
    this.enqueue("errors", payload);
  }

  captureTrace(payload: TracePayload): void {
    this.enqueue("traces", payload);
  }

  captureLogs(payload: LogPayload): void {
    this.enqueue("logs", payload);
  }

  private enqueue(endpoint: BeaconEndpoint, body: unknown): void {
    if (this.queue.length >= this.opts.maxBacklogItems) return;
    this.queue.push({ endpoint, body: redactSensitive(body, this.opts.censorKeys) });
    if (this.queue.length >= this.opts.batchSize) void this.flush();
  }

  /** Send everything queued now. Groups items per endpoint into one request each. */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];

    const byEndpoint = new Map<BeaconEndpoint, unknown[]>();
    for (const item of batch) {
      const list = byEndpoint.get(item.endpoint) ?? [];
      list.push(item.body);
      byEndpoint.set(item.endpoint, list);
    }

    await Promise.all(
      [...byEndpoint.entries()].map(([endpoint, bodies]) => this.send(endpoint, bodies)),
    );
  }

  private async send(endpoint: BeaconEndpoint, bodies: unknown[]): Promise<void> {
    const doFetch = this.opts.fetch ?? fetch;
    // Newline-delimited JSON: one payload per line, so a batch is one request.
    const ndjson = bodies.map((b) => JSON.stringify(b)).join("\n");
    const attempts = Math.max(1, this.opts.maxAttempts);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1, this.opts.requestTimeoutMs));
      try {
        const res = await doFetch(`${this.opts.endpoint}/v1/${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-ndjson",
            "X-Beacon-Token": this.opts.token,
            "X-Beacon-Sdk": `${this.opts.sdk?.name ?? "js"}/${this.opts.sdk?.version ?? "0.2.0"}`,
          },
          body: ndjson,
          keepalive: true,
          signal: controller.signal,
        });
        if (res.ok) return;
        if (!this.retryable(res.status)) {
          this.opts.onTransportError?.(new Error(`Beacon rejected ${endpoint} with HTTP ${res.status}`), endpoint);
          return;
        }
        if (attempt < attempts) {
          await this.delay(attempt, res.headers.get("Retry-After"));
        }
      } catch (err) {
        this.opts.onTransportError?.(err, endpoint);
        if (attempt < attempts) await this.delay(attempt, null);
      } finally {
        clearTimeout(timeout);
      }
    }

    this.requeue(endpoint, bodies);
  }

  private requeue(endpoint: BeaconEndpoint, bodies: unknown[]): void {
    const available = Math.max(0, this.opts.maxBacklogItems - this.queue.length);
    for (const body of bodies.slice(0, available)) this.queue.push({ endpoint, body });
  }

  private retryable(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  private async delay(attempt: number, retryAfter: string | null): Promise<void> {
    const explicit = this.retryAfterMs(retryAfter);
    const exponential = this.opts.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
    const base = Math.min(this.opts.maxRetryDelayMs, explicit ?? exponential);
    const jittered = Math.min(this.opts.maxRetryDelayMs, Math.round(base * (0.5 + Math.random())));
    await (this.opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(jittered);
  }

  private retryAfterMs(value: string | null): number | null {
    if (value === null || value.trim() === "") return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
  }

  shouldSampleTrace(traceId?: string): boolean {
    const rate = Math.max(0, Math.min(1, this.opts.tracesSampleRate));
    if (rate === 0) return false;
    if (rate === 1) return true;
    if (traceId && /^[0-9a-f]{8}/i.test(traceId)) {
      return Number.parseInt(traceId.slice(0, 8), 16) / 0x1_0000_0000 < rate;
    }
    return Math.random() < rate;
  }

  /** Flush and stop the timer. Call on graceful shutdown. */
  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Test/inspection helper. */
  get pending(): number {
    return this.queue.length;
  }

  get resource(): Resource {
    return this.opts.resource;
  }
}
