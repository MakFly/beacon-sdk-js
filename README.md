# @makfly/beacon-sdk-js

Beacon telemetry SDK for **Next.js 16 / browser / node** — errors, traces, logs.
Home-grown, **zero OTel/Sentry dependency** (no `@opentelemetry/*`, no `@vercel/otel`).

```bash
bun add @makfly/beacon-sdk-js
```

`@makfly/beacon-protocol` is pulled in automatically (it's a dependency).

## Quickstart (Next.js 16 — `instrumentation.ts`)

```ts
import { registerBeacon, createOnRequestError } from "@makfly/beacon-sdk-js/nextjs";

export function register() {
  registerBeacon({
    endpoint: process.env.BEACON_URL!,
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

Also exported: `Beacon`, `BeaconClient`, `Tracer`, `buildErrorPayload`, `parseStack`,
`generateTraceId` / `generateSpanId` / `generateUuid`, plus the full
`@makfly/beacon-protocol` surface (re-exported).

## Versioning & release

SemVer. Depends on `@makfly/beacon-protocol` — see [`CLAUDE.md`](./CLAUDE.md) for the
release order and rules. Tags are immutable.

## License

MIT. Part of the [Beacon](https://github.com/MakFly) telemetry suite.
