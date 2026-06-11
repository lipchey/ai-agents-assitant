import { defineConfig } from "vitest/config";

/* Offline full-graph e2e tier: separated from the unit config because each run
   really spawns `npm run typecheck` in a fixture copy, so the timeouts are large
   relative to the fast unit budget. Invoked via `npm run test:e2e`. */
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/e2e/**/*.test.ts"],
        testTimeout: 120_000,
        hookTimeout: 120_000,
    },
});
