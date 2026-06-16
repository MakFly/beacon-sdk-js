export { Beacon, initBeacon, getBeacon, type BeaconInit } from "./beacon";
export { BeaconClient, type BeaconClientOptions } from "./client";
export { Tracer, type SpanHandle } from "./tracer";
export { buildErrorPayload, type CaptureContext } from "./errors";
export { parseStack } from "./stacktrace";
export { generateTraceId, generateSpanId, generateUuid } from "./ids";

// Re-export the protocol surface so consumers need one import.
export * from "@makfly/beacon-protocol";
