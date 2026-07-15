import { expect, test, describe, mock } from "bun:test";
import { generateTraceId, generateSpanId, generateUuid } from "./ids";
import { parseStack } from "./stacktrace";
import { buildErrorPayload } from "./errors";
import { BeaconClient } from "./client";
import { Tracer } from "./tracer";
import { Beacon } from "./beacon";
import { inspectInstrumentation, runSetup, setupSnippet } from "./setup";
import { extractTraceContext, formatTraceparent, injectTraceContext, parseTraceparent } from "./propagation";
import { SpanStatusCode } from "@makfly/beacon-protocol";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const resource = { "service.name": "iautos-web", "service.stage": "production" as const };

describe("ids", () => {
  test("trace/span ids are lowercase hex of the right length", () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/);
    expect(generateUuid()).toMatch(/^[0-9a-f-]{36}$/);
  });
  test("ids are unique across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, generateTraceId));
    expect(ids.size).toBe(100);
  });
});

describe("W3C propagation", () => {
  const context = {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    sampled: true,
    tracestate: "vendor=value",
    baggage: "tenant=acme",
  };

  test("formats, injects and extracts traceparent/tracestate/baggage", () => {
    expect(formatTraceparent(context)).toBe("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01");
    const headers = injectTraceContext(context, { accept: "application/json" });
    expect(headers.accept).toBe("application/json");
    expect(extractTraceContext(headers)).toEqual(context);
  });

  test("rejects malformed or all-zero context ids", () => {
    expect(parseTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01")).toBeNull();
    expect(parseTraceparent("not-a-traceparent")).toBeNull();
  });
});

describe("parseStack", () => {
  test("parses V8 frames and flags app frames", () => {
    const stack = [
      "Error: boom",
      "    at charge (/var/www/src/Pay.ts:42:13)",
      "    at Object.<anonymous> (/var/www/node_modules/lib/index.js:9:1)",
      "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ].join("\n");
    const frames = parseStack(stack, "/var/www");
    expect(frames.length).toBe(3);
    expect(frames[0]).toMatchObject({ method: "charge", lineNumber: 42, isApplicationFrame: true });
    expect(frames[1]!.isApplicationFrame).toBe(false);
    expect(frames[2]!.isApplicationFrame).toBe(false);
  });
});

describe("buildErrorPayload", () => {
  test("maps an Error to a grouped error payload with entry point", () => {
    const err = new TypeError("Card declined");
    const payload = buildErrorPayload(err, resource, {
      handled: false,
      entryPoint: { type: "web", value: "https://iautos.fr/checkout", handlerIdentifier: "POST /checkout", handlerType: "next_route" },
      attributes: { "http.request.method": "POST" },
    });
    expect(payload.exceptionClass).toBe("TypeError");
    expect(payload.message).toBe("Card declined");
    expect(payload.handled).toBe(false);
    expect(payload.attributes["beacon.entry_point.type"]).toBe("web");
    expect(payload.attributes["beacon.entry_point.handler.type"]).toBe("next_route");
    expect(payload.trackingUuid).toMatch(/^[0-9a-f-]{36}$/);
  });
  test("normalizes non-Error throws", () => {
    const payload = buildErrorPayload("plain string fail", resource);
    expect(payload.exceptionClass).toBe("NonError");
    expect(payload.message).toBe("plain string fail");
  });
});

describe("BeaconClient transport", () => {
  test("batches per endpoint and POSTs ndjson with auth header", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const client = new BeaconClient({
      endpoint: "https://beacon.test",
      token: "tok_123",
      resource,
      flushIntervalMs: 0,
      fetch: fakeFetch,
    });
    client.captureError(buildErrorPayload(new Error("a"), resource));
    client.captureError(buildErrorPayload(new Error("b"), resource));
    await client.flush();

    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://beacon.test/v1/errors");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-Beacon-Token"]).toBe("tok_123");
    expect(headers["X-Beacon-Sdk"]).toContain("/");
    // two payloads → two ndjson lines
    expect((calls[0]!.init.body as string).split("\n").length).toBe(2);
    expect(client.pending).toBe(0);
  });

  test("re-queues on 5xx so transient outages don't drop telemetry", async () => {
    const fakeFetch = mock(async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const client = new BeaconClient({
      endpoint: "https://beacon.test",
      token: "t",
      resource,
      flushIntervalMs: 0,
      fetch: fakeFetch,
    });
    client.captureLogs({ resource, records: [] });
    await client.flush();
    expect(client.pending).toBe(1);
  });

  test("honours Retry-After and retries 429 responses", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const fakeFetch = mock(async () => {
      attempts++;
      return attempts === 1
        ? new Response(null, { status: 429, headers: { "Retry-After": "0" } })
        : new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const client = new BeaconClient({
      endpoint: "https://beacon.test",
      token: "t",
      resource,
      flushIntervalMs: 0,
      maxAttempts: 2,
      fetch: fakeFetch,
      sleep: async (delay) => { delays.push(delay); },
    });
    client.captureLogs({ resource, records: [{ timeUnixNano: "1", severityNumber: 9, severityText: "INFO", body: "ok", traceId: null, spanId: null, attributes: {} }] });
    await client.flush();
    expect(attempts).toBe(2);
    expect(delays).toHaveLength(1);
    expect(client.pending).toBe(0);
  });

  test("aborts timed-out requests without throwing into the app", async () => {
    const fakeFetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const client = new BeaconClient({
      endpoint: "https://beacon.test",
      token: "t",
      resource,
      flushIntervalMs: 0,
      requestTimeoutMs: 5,
      maxAttempts: 1,
      fetch: fakeFetch,
    });
    client.captureLogs({ resource, records: [{ timeUnixNano: "1", severityNumber: 9, severityText: "INFO", body: "timeout", traceId: null, spanId: null, attributes: {} }] });
    await client.flush();
    expect(client.pending).toBe(1);
  });

  test("bounds the outage backlog and recursively redacts sensitive keys", async () => {
    const bodies: string[] = [];
    const fakeFetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response(null, { status: 503 });
    }) as unknown as typeof fetch;
    const client = new BeaconClient({
      endpoint: "https://beacon.test",
      token: "t",
      resource,
      flushIntervalMs: 0,
      batchSize: 100,
      maxAttempts: 1,
      maxBacklogItems: 2,
      fetch: fakeFetch,
    });
    const record = (body: string) => ({
      resource,
      records: [{
        timeUnixNano: "1", severityNumber: 9, severityText: "INFO", body, traceId: null, spanId: null,
        attributes: { request: { password: "clear", nested: { authorization: "Bearer secret" } } } as never,
      }],
    });
    client.captureLogs(record("one"));
    client.captureLogs(record("two"));
    client.captureLogs(record("dropped"));
    await client.flush();
    expect(client.pending).toBe(2);
    expect(bodies[0]).not.toContain("clear");
    expect(bodies[0]).not.toContain("Bearer secret");
    expect(bodies[0]).toContain("[CENSORED]");
  });
});

describe("Tracer", () => {
  test("builds a span tree sharing one traceId", () => {
    const tracer = new Tracer();
    const root = tracer.startSpan("POST /checkout", "http_request", { startMs: 1000 });
    const child = tracer.startSpan("select 1", "db_query", {
      traceId: root.traceId,
      parentSpanId: root.spanId,
      startMs: 1010,
    });
    child.setAttribute("db.system", "postgresql").setStatus(SpanStatusCode.Ok);
    const childSpan = child.end(1020);
    root.setStatus(SpanStatusCode.Ok);
    const rootSpan = root.end(1150);

    expect(rootSpan.parentSpanId).toBeNull();
    expect(childSpan.parentSpanId).toBe(rootSpan.spanId);
    expect(childSpan.traceId).toBe(rootSpan.traceId);
    expect(childSpan.attributes["beacon.span_type"]).toBe("db_query");
    expect(rootSpan.endTimeUnixNano).toBe("1150000000");
  });
});

describe("Beacon facade", () => {
  test("captureException and log enqueue through the client", async () => {
    const fakeFetch = mock(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
    const beacon = new Beacon({
      endpoint: "https://beacon.test",
      token: "t",
      resource,
      flushIntervalMs: 0,
      fetch: fakeFetch,
    });
    beacon.captureException(new Error("oops"));
    beacon.log("ERROR", "payment failed", { "order.id": 7 });
    expect(beacon.client.pending).toBe(2);
    await beacon.flush();
    expect(beacon.client.pending).toBe(0);
  });

  test("applies deterministic trace sampling", async () => {
    const fakeFetch = mock(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
    const dropped = new Beacon({ endpoint: "https://beacon.test", token: "t", resource, flushIntervalMs: 0, tracesSampleRate: 0, fetch: fakeFetch });
    dropped.captureSpans([new Tracer().startSpan("drop", "custom", { traceId: "00000000aaaaaaaaaaaaaaaaaaaaaaaa" }).end()]);
    expect(dropped.client.pending).toBe(0);

    const sampled = new Beacon({ endpoint: "https://beacon.test", token: "t", resource, flushIntervalMs: 0, tracesSampleRate: 0.5, fetch: fakeFetch });
    sampled.captureSpans([new Tracer().startSpan("keep", "custom", { traceId: "00000000bbbbbbbbbbbbbbbbbbbbbbbb" }).end()]);
    sampled.captureSpans([new Tracer().startSpan("drop", "custom", { traceId: "ffffffffcccccccccccccccccccccccc" }).end()]);
    expect(sampled.client.pending).toBe(1);
  });
});

describe("explicit Next.js setup", () => {
  test("recognizes a complete instrumentation file", () => {
    expect(setupSnippet()).toContain('process.env.BEACON_ENDPOINT ?? "https://ingest.pulseview.app"');
    expect(inspectInstrumentation(setupSnippet())).toEqual({
      hasBeaconImport: true,
      hasRegister: true,
      hasOnRequestError: true,
      ready: true,
    });
  });

  test("never mutates an existing incomplete instrumentation file", () => {
    const root = mkdtempSync(join(tmpdir(), "beacon-setup-"));
    const path = join(root, "instrumentation.ts");
    const original = "export function register() {}\n";
    writeFileSync(path, original);

    try {
      expect(runSetup(root, { write: true }).status).toBe("incomplete");
      expect(readFileSync(path, "utf8")).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("creates a new integration only with explicit write mode", () => {
    const root = mkdtempSync(join(tmpdir(), "beacon-setup-"));

    try {
      expect(runSetup(root).status).toBe("missing");
      expect(runSetup(root, { write: true }).status).toBe("created");
      expect(inspectInstrumentation(readFileSync(join(root, "instrumentation.ts"), "utf8")).ready).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
