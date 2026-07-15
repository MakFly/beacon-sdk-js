export { Beacon, initBeacon, getBeacon, type BeaconInit } from "./beacon";
export { BeaconClient, type BeaconClientOptions } from "./client";
export { Tracer, type SpanHandle } from "./tracer";
export { buildErrorPayload, type CaptureContext } from "./errors";
export { parseStack } from "./stacktrace";
export { generateTraceId, generateSpanId, generateUuid } from "./ids";
export { redactSensitive, DEFAULT_CENSOR_KEYS } from "./redaction";
export { parseTraceparent, formatTraceparent, injectTraceContext, extractTraceContext, type TraceContext } from "./propagation";

// Re-export the protocol surface so consumers need one import.
export * from "@makfly/beacon-protocol";
