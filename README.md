# @makfly/beacon-sdk-js

Lean Beacon transport, manual tracing and server error capture for **Next.js 16 / Node.js**.

```bash
bun add @makfly/beacon-sdk-js
```

`@makfly/beacon-protocol` is pulled in automatically (it's a dependency).

Installation never modifies application files. To inspect an existing Next.js integration:

```bash
bunx beacon-setup
```

To create a new `instrumentation.ts` only when none exists:

```bash
bunx beacon-setup --write
```

## Quickstart (Next.js 16 — `instrumentation.ts`)

```ts
import { registerBeacon, createOnRequestError } from "@makfly/beacon-sdk-js/nextjs";

export function register() {
  registerBeacon({
    endpoint: process.env.BEACON_ENDPOINT!,
    token: process.env.BEACON_TOKEN!,
    resource: { "service.name": "iautos-web", "service.stage": "production" },
  });
}

export const onRequestError = createOnRequestError();
```

## Core API (framework-agnostic)

```ts
import { initBeacon, getBeacon } from "@makfly/beacon-sdk-js";

initBeacon({ endpoint, token, resource });
getBeacon().captureException(err);
```

The transport uses a 2s timeout, bounded retries for network errors, `408`, `429` and
`5xx`, honours `Retry-After`, and keeps at most 200 pending payloads. Override with
`requestTimeoutMs`, `maxAttempts`, `maxBacklogItems` and the retry delay options.
`tracesSampleRate` applies deterministic head sampling. Sensitive keys are recursively
redacted across errors, spans and logs; extend the defaults with `censorKeys`.
W3C `traceparent`, `tracestate` and `baggage` helpers are exported through
`injectTraceContext` and `extractTraceContext` for cross-service propagation.

Also exported: `Beacon`, `BeaconClient`, `Tracer`, `buildErrorPayload`, `parseStack`,
`generateTraceId` / `generateSpanId` / `generateUuid`, plus the full
`@makfly/beacon-protocol` surface (re-exported).

## Versioning & release

SemVer. Depends on `@makfly/beacon-protocol` — see [`CLAUDE.md`](./CLAUDE.md) for the
release order and rules. Tags are immutable.

## License

MIT. Part of the [Beacon](https://github.com/MakFly) telemetry suite.
