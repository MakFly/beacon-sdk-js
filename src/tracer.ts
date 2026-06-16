import {
  BEACON_ATTR,
  nowUnixNano,
  SpanStatusCode,
  type Attributes,
  type Span,
  type SpanEvent,
} from "@makfly/beacon-protocol";
import { generateSpanId, generateTraceId } from "./ids";

export interface SpanHandle {
  readonly traceId: string;
  readonly spanId: string;
  setAttribute(key: string, value: Attributes[string]): this;
  addEvent(name: string, type: string, attributes?: Attributes): this;
  setStatus(code: SpanStatusCode, message?: string): this;
  /** Mark the span finished. Returns the immutable Span record. */
  end(endTimeMs?: number): Span;
}

/**
 * Minimal span builder. A trace = a tree of spans sharing one traceId. The tracer does
 * not auto-flush; the caller collects ended spans and hands them to the BeaconClient as
 * a TracePayload (the Next.js integration wires that up per request).
 */
export class Tracer {
  startSpan(
    name: string,
    spanType: string,
    opts: { traceId?: string; parentSpanId?: string | null; attributes?: Attributes; startMs?: number } = {},
  ): SpanHandle {
    const traceId = opts.traceId ?? generateTraceId();
    const spanId = generateSpanId();
    const startTimeUnixNano = nowUnixNano(opts.startMs);
    const attributes: Attributes = { [BEACON_ATTR.spanType]: spanType, ...opts.attributes };
    const events: SpanEvent[] = [];
    let status: { code: SpanStatusCode; message?: string | null } = { code: SpanStatusCode.Unset };

    const handle: SpanHandle = {
      traceId,
      spanId,
      setAttribute(key, value) {
        attributes[key] = value;
        return handle;
      },
      addEvent(eventName, type, eventAttributes) {
        events.push({
          name: eventName,
          timeUnixNano: nowUnixNano(),
          attributes: { [BEACON_ATTR.spanEventType]: type, ...eventAttributes },
        });
        return handle;
      },
      setStatus(code, message) {
        status = { code, message };
        return handle;
      },
      end(endTimeMs) {
        return {
          traceId,
          spanId,
          parentSpanId: opts.parentSpanId ?? null,
          name,
          startTimeUnixNano,
          endTimeUnixNano: nowUnixNano(endTimeMs),
          status,
          attributes,
          events,
        };
      },
    };
    return handle;
  }
}
