import "server-only";

type TimingMeta = Record<string, string | number | boolean | null | undefined>;

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
    console.error("[perf]", JSON.stringify({
      label,
      durationMs: Math.round(performance.now() - started),
      status: "error",
      ...meta,
    }));
    throw error;
  }
}
