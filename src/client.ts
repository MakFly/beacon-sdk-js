import type {
  BeaconEndpoint,
  ErrorPayload,
  LogPayload,
  Resource,
  TracePayload,
} from "@makfly/beacon-protocol";

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
  /** Network/transport failures are swallowed; set a hook to observe them. */
  onTransportError?: (err: unknown, endpoint: BeaconEndpoint) => void;
  /** Override transport (tests). Defaults to native fetch. */
  fetch?: typeof fetch;
  /** SDK identity for the X-Beacon-Sdk header. */
  sdk?: { name: string; version: string };
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
  private readonly opts: Required<Omit<BeaconClientOptions, "onTransportError" | "fetch" | "sdk">> &
    Pick<BeaconClientOptions, "onTransportError" | "fetch" | "sdk">;
  private queue: QueueItem[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: BeaconClientOptions) {
    this.opts = {
      batchSize: 20,
      flushIntervalMs: 5000,
      ...options,
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
    this.queue.push({ endpoint, body });
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
    try {
      const res = await doFetch(`${this.opts.endpoint}/v1/${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          "X-Beacon-Token": this.opts.token,
          "X-Beacon-Sdk": `${this.opts.sdk?.name ?? "js"}/${this.opts.sdk?.version ?? "0.1.0"}`,
        },
        body: ndjson,
        keepalive: true,
      });
      if (!res.ok && res.status >= 500) {
        // Re-queue on server error so a transient outage doesn't drop telemetry.
        this.requeue(endpoint, bodies);
      }
    } catch (err) {
      this.opts.onTransportError?.(err, endpoint);
      this.requeue(endpoint, bodies);
    }
  }

  private requeue(endpoint: BeaconEndpoint, bodies: unknown[]): void {
    // Cap the backlog so a long outage can't grow memory unbounded.
    if (this.queue.length > this.opts.batchSize * 10) return;
    for (const body of bodies) this.queue.push({ endpoint, body });
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
