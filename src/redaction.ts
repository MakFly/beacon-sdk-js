const CENSORED = "[CENSORED]";

export const DEFAULT_CENSOR_KEYS = [
  "password",
  "authorization",
  "cookie",
  "token",
  "secret",
  "api_key",
];

export function redactSensitive<T>(value: T, censorKeys: readonly string[]): T {
  const needles = censorKeys.map((key) => key.toLowerCase());

  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (current === null || typeof current !== "object") return current;

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(current)) {
      const lower = key.toLowerCase();
      output[key] = needles.some((needle) => lower.includes(needle)) ? CENSORED : visit(nested);
    }
    return output;
  };

  return visit(value) as T;
}
