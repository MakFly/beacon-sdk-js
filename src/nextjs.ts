import { HANDLER_TYPE, type EntryPointType } from "@makfly/beacon-protocol";
import { getBeacon, initBeacon, type BeaconInit, type Beacon } from "./beacon";

/**
 * Next.js 16 integration. Home-grown — no @vercel/otel, no @opentelemetry/*.
 *
 * Usage in `instrumentation.ts`:
 *   import { registerBeacon } from "@makfly/beacon-sdk-js/nextjs";
 *   export function register() {
 *     registerBeacon({ endpoint: process.env.BEACON_URL!, token: process.env.BEACON_TOKEN!,
 *                      resource: { "service.name": "iautos-web", "service.stage": "production" } });
 *   }
 *   export const onRequestError = createOnRequestError();
 */

export function registerBeacon(init: BeaconInit): Beacon {
  return initBeacon(init);
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
