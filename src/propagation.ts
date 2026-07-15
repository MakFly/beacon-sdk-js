export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
  tracestate?: string;
  baggage?: string;
}

export function parseTraceparent(value: string | null | undefined): TraceContext | null {
  if (!value) return null;
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i.exec(value.trim());
  if (!match || /^0+$/.test(match[1]!) || /^0+$/.test(match[2]!)) return null;
  return {
    traceId: match[1]!.toLowerCase(),
    spanId: match[2]!.toLowerCase(),
    sampled: (Number.parseInt(match[3]!, 16) & 1) === 1,
  };
}

export function formatTraceparent(context: Pick<TraceContext, "traceId" | "spanId" | "sampled">): string {
  if (!/^[0-9a-f]{32}$/i.test(context.traceId) || /^0+$/.test(context.traceId)) throw new TypeError("Invalid W3C trace id");
  if (!/^[0-9a-f]{16}$/i.test(context.spanId) || /^0+$/.test(context.spanId)) throw new TypeError("Invalid W3C span id");
  return `00-${context.traceId.toLowerCase()}-${context.spanId.toLowerCase()}-${context.sampled ? "01" : "00"}`;
}

export function injectTraceContext(
  context: TraceContext,
  headers: Record<string, string> = {},
): Record<string, string> {
  const injected: Record<string, string> = { ...headers, traceparent: formatTraceparent(context) };
  if (context.tracestate) injected.tracestate = context.tracestate;
  if (context.baggage) injected.baggage = context.baggage;
  return injected;
}

export function extractTraceContext(
  headers: Pick<Headers, "get"> | Record<string, string | undefined>,
): TraceContext | null {
  const get = (name: string): string | null => {
    if (typeof (headers as Pick<Headers, "get">).get === "function") {
      return (headers as Pick<Headers, "get">).get(name);
    }
    const record = headers as Record<string, string | undefined>;
    const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name);
    return key ? record[key] ?? null : null;
  };
  const context = parseTraceparent(get("traceparent"));
  if (!context) return null;
  return {
    ...context,
    tracestate: get("tracestate") ?? undefined,
    baggage: get("baggage") ?? undefined,
  };
}
