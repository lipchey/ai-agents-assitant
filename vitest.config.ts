import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        /* Unit tier only: the offline e2e (tests/e2e) carries real tsc spawns and
           runs from its own config so it never lands in the fast 45s unit budget. */
        include: ["tests/unit/**/*.test.ts"],
    },
});
