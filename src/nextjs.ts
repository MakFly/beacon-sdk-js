import { HANDLER_TYPE, type EntryPointType, type ServiceStage } from "@makfly/beacon-protocol";
import { getBeacon, initBeacon, type BeaconInit, type Beacon } from "./beacon";

/**
 * Next.js 16 integration. Home-grown — no @vercel/otel, no @opentelemetry/*.
 *
 * Zero-config: `autoRegister()` reads BEACON_ENDPOINT + BEACON_TOKEN from env.
 * The official hosted ingestion endpoint is used when only the token is configured.
 * BEACON_URL remains accepted as a backward-compatible endpoint alias.
 * If absent, Beacon is silently disabled (no network, no overhead).
 *
 * Run `beacon-setup` to inspect an integration or `beacon-setup --write` to create a
 * new instrumentation.ts file. Existing application code is never mutated automatically.
 */

export function registerBeacon(init: BeaconInit): Beacon {
  return initBeacon(init);
}

/**
 * Auto-register from process.env. Returns the Beacon instance or null if disabled.
 * Reads: BEACON_ENDPOINT (or BEACON_URL), BEACON_TOKEN, BEACON_SERVICE_NAME,
 * NODE_ENV, DEPLOYMENT_VERSION, GITHUB_SHA.
 */
const STAGE_MAP: Record<string, ServiceStage> = {
  production: "production",
  staging: "staging",
  development: "dev",
  dev: "dev",
};

export const DEFAULT_BEACON_ENDPOINT = "https://ingest.pulseview.app";

export function autoRegister(): Beacon | null {
  const endpoint = process.env.BEACON_ENDPOINT ?? process.env.BEACON_URL ?? DEFAULT_BEACON_ENDPOINT;
  const token = process.env.BEACON_TOKEN;
  if (!token) return null;

  return initBeacon({
    endpoint,
    token,
    resource: {
      "service.name": process.env.BEACON_SERVICE_NAME ?? "unknown",
      "service.stage": STAGE_MAP[process.env.NODE_ENV ?? "development"] ?? "dev",
      "service.version": process.env.DEPLOYMENT_VERSION ?? process.env.GITHUB_SHA?.slice(0, 7) ?? "dev",
    },
  });
}

/** Next's error context (subset we read). */
interface NextErrorContext {
  routerKind?: "Pages Router" | "App Router";
  routePath?: string;
  routeType?: "render" | "route" | "action" | "middleware";
  renderSource?: string;
  revalidateReason?: string;
}

interface NextRequestInfo {
  path?: string;
  method?: string;
  headers?: Record<string, string> | Headers;
}

function headerValue(headers: NextRequestInfo["headers"], key: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(key) ?? undefined;
  return headers[key] ?? headers[key.toLowerCase()];
}

function handlerType(routeType: NextErrorContext["routeType"]): string {
  switch (routeType) {
    case "route":
      return HANDLER_TYPE.nextRoute;
    case "action":
      return HANDLER_TYPE.nextAction;
    default:
      return HANDLER_TYPE.nextRsc;
  }
}

/**
 * Build the `onRequestError` export Next.js 16 calls for every server-side error
 * (RSC render, route handler, server action, middleware).
 */
export function createOnRequestError(beacon: Beacon | null = getBeacon()) {
  return async function onRequestError(
    error: unknown,
    request: NextRequestInfo,
    context: NextErrorContext,
  ): Promise<void> {
    const instance = beacon ?? getBeacon();
    if (!instance) return;
    const type: EntryPointType = "web";
    const method = request.method ?? "GET";
    const route = context.routePath ?? request.path ?? "unknown";

    instance.captureException(error, {
      handled: false,
      entryPoint: {
        type,
        value: request.path,
        handlerIdentifier: `${method} ${route}`,
        handlerType: handlerType(context.routeType),
      },
      attributes: {
        "http.request.method": method,
        "http.route": context.routePath ?? null,
        "next.router_kind": context.routerKind ?? null,
        "next.route_type": context.routeType ?? null,
        "next.render_source": context.renderSource ?? null,
        "user_agent.original": headerValue(request.headers, "user-agent") ?? null,
      },
    });
    // Server errors are terminal for the request; flush eagerly.
    await instance.flush();
  };
}
