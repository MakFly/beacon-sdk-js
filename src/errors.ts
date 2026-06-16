import {
  BEACON_ATTR,
  nowUnixNano,
  type Attributes,
  type ErrorEvent,
  type ErrorPayload,
  type EntryPointType,
  type GroupingStrategy,
  type Resource,
} from "@makfly/beacon-protocol";
import { generateUuid } from "./ids";
import { parseStack } from "./stacktrace";

export interface CaptureContext {
  /** Was the exception caught/handled, or did it bubble uncaught? */
  handled?: boolean;
  attributes?: Attributes;
  breadcrumbs?: ErrorEvent[];
  entryPoint?: {
    type: EntryPointType;
    value?: string;
    handlerIdentifier?: string;
    handlerName?: string | null;
    handlerType?: string;
  };
  overriddenGrouping?: GroupingStrategy;
  appRoot?: string;
}

/** Normalize any thrown value into an Error so we always have a class + message. */
function toError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  const e = new Error(typeof thrown === "string" ? thrown : JSON.stringify(thrown));
  e.name = "NonError";
  return e;
}

/** Build a Beacon ErrorPayload from a thrown value. Pure — does not send. */
export function buildErrorPayload(
  thrown: unknown,
  resource: Resource,
  ctx: CaptureContext = {},
): ErrorPayload {
  const err = toError(thrown);
  const attributes: Attributes = { ...ctx.attributes };

  if (ctx.entryPoint) {
    attributes[BEACON_ATTR.entryPointType] = ctx.entryPoint.type;
    if (ctx.entryPoint.value != null) attributes[BEACON_ATTR.entryPointValue] = ctx.entryPoint.value;
    if (ctx.entryPoint.handlerIdentifier != null)
      attributes[BEACON_ATTR.handlerIdentifier] = ctx.entryPoint.handlerIdentifier;
    if (ctx.entryPoint.handlerName !== undefined)
      attributes[BEACON_ATTR.handlerName] = ctx.entryPoint.handlerName;
    if (ctx.entryPoint.handlerType != null)
      attributes[BEACON_ATTR.handlerType] = ctx.entryPoint.handlerType;
  }

  const stacktrace = parseStack(err.stack, ctx.appRoot);

  return {
    resource,
    trackingUuid: generateUuid(),
    seenAtUnixNano: nowUnixNano(),
    exceptionClass: err.name || "Error",
    message: err.message || null,
    code: (err as { code?: string | number }).code?.toString().slice(0, 64) ?? null,
    handled: ctx.handled ?? true,
    applicationPath: ctx.appRoot ?? null,
    openFrameIndex: stacktrace.findIndex((f) => f.isApplicationFrame) || 0,
    overriddenGrouping: ctx.overriddenGrouping ?? null,
    attributes,
    events: ctx.breadcrumbs ?? [],
    stacktrace,
  };
}
