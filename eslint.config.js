import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

/* Local rule mirroring code-guidelines §5: block comments only, never // line comments. */
const projectPlugin = {
    rules: {
        "block-comments-only": {
            meta: {
                type: "problem",
                docs: { description: "Disallow // line comments; use /* block */ comments." },
                schema: [],
                messages: { noLine: "Use /* block */ comments, not // line comments (code-guidelines §5)." },
            },
            create(context) {
                return {
                    Program() {
                        for (const comment of context.sourceCode.getAllComments()) {
                            if (comment.type === "Line") {
                                context.report({ loc: comment.loc, messageId: "noLine" });
                            }
                        }
                    },
                };
            },
        },
    },
};

/*
 * Advisory in-editor mirror of the layer DAG (ADR-001). dependency-cruiser
 * (npm run arch) is the AUTHORITATIVE gate in --fast/CI; these boundaries rules
 * are warn-only so they surface as editor squiggles without ever failing lint
 * or verify. Each top-level src/ dir is one element; allow lists encode "import
 * only from strictly lower layers plus same-layer siblings", with the single
 * intra-L6 exception graph -> swarm allowed, swarm -> graph forbidden.
 */
// TODO: migrate to boundaries/dependencies + v6 object selectors (plugin emits v5-deprecation notices); depcruise stays the authoritative gate.
const boundariesElements = [
    { type: "consts", mode: "full", pattern: "src/consts/**/*" },
    { type: "types", mode: "full", pattern: "src/types/**/*" },
    { type: "shared", mode: "full", pattern: "src/shared/**/*" },
    { type: "models", mode: "full", pattern: "src/models/**/*" },
    { type: "state", mode: "full", pattern: "src/state/**/*" },
    { type: "logging", mode: "full", pattern: "src/logging/**/*" },
    { type: "prompts", mode: "full", pattern: "src/prompts/**/*" },
    { type: "run", mode: "full", pattern: "src/run/**/*" },
    { type: "tools", mode: "full", pattern: "src/tools/**/*" },
    { type: "hitl", mode: "full", pattern: "src/hitl/**/*" },
    { type: "patching", mode: "full", pattern: "src/patching/**/*" },
    { type: "swarm", mode: "full", pattern: "src/swarm/**/*" },
    { type: "graph", mode: "full", pattern: "src/graph/**/*" },
    { type: "cli", mode: "full", pattern: "src/cli/**/*" },
    { type: "app", mode: "full", pattern: "src/app/**/*" },
    { type: "entry", mode: "full", pattern: "src/*.ts" },
];

const L0 = ["consts"];
const L1 = [...L0, "types"];
const L2 = [...L1, "shared", "models"];
const L3 = [...L2, "state", "logging", "prompts", "run"];
const L4 = [...L3, "tools", "hitl"];
const L5 = [...L4, "patching"];
const L6graph = [...L5, "graph", "swarm"];
const L6swarm = [...L5, "swarm"];
const L7 = [...L5, "graph", "swarm", "cli", "app", "entry"];

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            "node_modules/**",
            "eslint.config.js",
            ".dependency-cruiser.cjs",
            "tools/**",
            "schemas/**",
            /* Bench fixtures carry a deliberate type bug; .work holds per-run
               fixture copies the agent mutates. Neither is project code. */
            "bench/fixtures/**",
            "bench/.work/**",
            /* Per-run e2e fixture copies the agent mutates (some left type-broken). */
            "tests/e2e/.work/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        /* Plain-JS node scripts (bench runner/provider/asserts): js.configs.recommended
           has no environment globals, so declare the node ones we use. */
        files: ["**/*.mjs"],
        languageOptions: {
            globals: { console: "readonly", process: "readonly", URL: "readonly" },
        },
    },
    {
        files: ["**/*.ts"],
        plugins: { project: projectPlugin },
        rules: {
            "project/block-comments-only": "error",
            "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
    {
        files: ["src/**/*.ts"],
        plugins: { boundaries },
        settings: {
            "boundaries/include": ["src/**/*.ts"],
            "boundaries/elements": boundariesElements,
            /* TS-aware resolver so boundaries follows extensionless bundler-style imports. */
            "import/resolver": { typescript: { project: "tsconfig.json" } },
        },
        rules: {
            "boundaries/element-types": [
                "warn",
                {
                    default: "disallow",
                    rules: [
                        { from: ["consts"], allow: L0 },
                        { from: ["types"], allow: L1 },
                        { from: ["shared", "models"], allow: L2 },
                        { from: ["state", "logging", "prompts", "run"], allow: L3 },
                        { from: ["tools", "hitl"], allow: L4 },
                        { from: ["patching"], allow: L5 },
                        { from: ["graph"], allow: L6graph },
                        { from: ["swarm"], allow: L6swarm },
                        { from: ["cli", "app", "entry"], allow: L7 },
                    ],
                },
            ],
        },
    },
    eslintConfigPrettier,
);
