import {
  nowUnixNano,
  SEVERITY,
  severityName,
  type Attributes,
  type LogRecord,
  type Resource,
  type Span,
} from "@makfly/beacon-protocol";
import { BeaconClient, type BeaconClientOptions } from "./client";
import { buildErrorPayload, type CaptureContext } from "./errors";
import { Tracer } from "./tracer";

export interface BeaconInit extends Omit<BeaconClientOptions, "sdk"> {}

const SDK = { name: "beacon-sdk-js", version: "0.1.0" };

/** High-level entry point. Owns a transport client + a tracer. */
export class Beacon {
  readonly client: BeaconClient;
  readonly tracer = new Tracer();

  constructor(init: BeaconInit) {
    this.client = new BeaconClient({ ...init, sdk: SDK });
  }

  get resource(): Resource {
    return this.client.resource;
  }

  /** Capture a thrown value as a grouped error. */
  captureException(thrown: unknown, ctx?: CaptureContext): void {
    this.client.captureError(buildErrorPayload(thrown, this.resource, ctx));
  }

  /** Emit finished spans (one trace) to the ingester. */
  captureSpans(spans: Span[]): void {
    if (spans.length === 0) return;
    this.client.captureTrace({
      resource: this.resource,
      scopes: [{ name: SDK.name, version: SDK.version, spans }],
    });
  }

  /** Emit a single structured log record. */
  log(
    level: keyof typeof SEVERITY,
    body: string,
    attributes: Attributes = {},
    correlation?: { traceId?: string; spanId?: string },
  ): void {
    const record: LogRecord = {
      timeUnixNano: nowUnixNano(),
      severityNumber: SEVERITY[level],
      severityText: severityName(SEVERITY[level]),
      body,
      traceId: correlation?.traceId ?? null,
      spanId: correlation?.spanId ?? null,
      attributes,
    };
    this.client.captureLogs({ resource: this.resource, records: [record] });
  }

  flush(): Promise<void> {
    return this.client.flush();
  }

  shutdown(): Promise<void> {
    return this.client.shutdown();
  }
}

let current: Beacon | null = null;

/** Initialize the process-wide Beacon instance (call once, e.g. in instrumentation.ts). */
export function initBeacon(init: BeaconInit): Beacon {
  current = new Beacon(init);
  return current;
}

/** Access the initialized instance, or null if init was never called. */
export function getBeacon(): Beacon | null {
  return current;
}
