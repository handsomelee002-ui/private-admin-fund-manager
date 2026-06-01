import "server-only";

type TimingMeta = Record<string, string | number | boolean | null | undefined>;

function isRedirectError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof (error as { digest?: unknown }).digest === "string" &&
      (error as { digest: string }).digest.startsWith("NEXT_REDIRECT"),
  );
}

export async function timeAsync<T>(label: string, work: () => Promise<T>, meta: TimingMeta = {}) {
  const started = performance.now();
  try {
    const result = await work();
    console.info("[perf]", JSON.stringify({
      label,
      durationMs: Math.round(performance.now() - started),
      status: "ok",
      ...meta,
    }));
    return result;
  } catch (error) {
    const payload = {
      label,
      durationMs: Math.round(performance.now() - started),
      status: isRedirectError(error) ? "redirect" : "error",
      ...meta,
    };
    if (isRedirectError(error)) {
      console.info("[perf]", JSON.stringify(payload));
    } else {
      console.error("[perf]", JSON.stringify(payload));
    }
    throw error;
  }
}
