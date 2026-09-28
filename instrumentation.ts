/**
 * Runs once when the server starts.
 * 1. Refuses to boot a production server whose configuration would expose PHI (missing secrets,
 *    no encryption key, serverless host, demo mode, remote AI without a BAA). See lib/config.ts.
 * 2. Opens the data store, so a wrong HF_DATA_KEY, a corrupt file or a schema from a newer build
 *    fails at startup instead of on a user's first request. Older files are migrated here.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionConfig } = await import("@/lib/config");
    assertProductionConfig();
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { getStore } = await import("@/lib/store");
      getStore().read();
    }
  }
}
