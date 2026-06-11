/*
 * dependency-cruiser config - mechanical enforcement of the layer DAG.
 * Authoritative source of the layering policy is .agents/architecture-decisions.md
 * (ADR-001). This file is the executable mirror used by `npm run arch` and the
 * `architecture` check in quality.json (`./verify --fast`).
 *
 * Layer order (low -> high); a module may import only from STRICTLY LOWER layers,
 * from its own layer (siblings), and from external packages. The two intra-layer
 * exceptions encoded below are: graph -> swarm allowed, swarm -> graph forbidden.
 *
 *   L0 consts
 *   L1 types
 *   L2 shared, models
 *   L3 state, logging, prompts, run
 *   L4 tools, hitl
 *   L5 patching
 *   L6 swarm, graph
 *   L7 cli, main.ts, index.ts
 *
 * Type-only edges are included (tsPreCompilationDeps: true) so the policy also
 * governs `import type` / `export type`. The two historically flagged type-only
 * edges (types -> state, types -> prompts) were fixed in source - see ADR-001.
 */

/* The closed set of known src/ modules: the 14 layer directories plus the two
 * top-level entry files. The catch-all guard rules below derive their "unlayered"
 * predicate from this ONE constant so a new dir cannot slip past either direction.
 * Adding a new top-level src/ dir requires updating, together: ADR-001's table,
 * the layer regexes in this file, and the eslint mirror in eslint.config.js. */
const LAYER_DIRS = "consts|types|shared|models|state|logging|prompts|run|tools|hitl|patching|swarm|graph|cli";
const ENTRY_FILES = "^src/(main|index)\\.ts$";
/* The known src/ set is exactly the 14 layer dirs plus the two entry files;
 * UNLAYERED_SRC is its complement under src/ (a new dir matches neither). */
const UNLAYERED_SRC = "^src/(?!(" + LAYER_DIRS + ")/)(?!(main|index)\\.ts$)";

/* Forbidden import targets for each "from" layer = the union of all STRICTLY
 * higher layers, expressed as one path regex (directory unions plus the two
 * top-level entry files main.ts / index.ts). */
const aboveL0 =
    "^src/(types|shared|models|state|logging|prompts|run|tools|hitl|patching|swarm|graph|cli)/|" + ENTRY_FILES;
const aboveL1 = "^src/(shared|models|state|logging|prompts|run|tools|hitl|patching|swarm|graph|cli)/|" + ENTRY_FILES;
const aboveL2 = "^src/(state|logging|prompts|run|tools|hitl|patching|swarm|graph|cli)/|" + ENTRY_FILES;
const aboveL3 = "^src/(tools|hitl|patching|swarm|graph|cli)/|" + ENTRY_FILES;
const aboveL4 = "^src/(patching|swarm|graph|cli)/|" + ENTRY_FILES;
const aboveL5 = "^src/(swarm|graph|cli)/|" + ENTRY_FILES;
const aboveL6 = "^src/cli/|" + ENTRY_FILES;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: "no-circular",
            severity: "error",
            comment:
                "No import cycles at the module (file) level. Break the cycle or hoist the shared piece down a layer.",
            from: {},
            to: { circular: true },
        },
        {
            name: "no-orphans",
            severity: "warn",
            comment:
                "Module is reachable from nothing and reaches nothing. Often a stale file or a barrel-only re-export; starts as warn (ADR-001).",
            from: {
                orphan: true,
                pathNot: ["(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$", "\\.d\\.ts$", "(^|/)tsconfig\\.json$"],
            },
            to: {},
        },
        {
            name: "not-to-unresolvable",
            severity: "error",
            comment:
                "An import did not resolve. With moduleResolution:bundler this almost always means the resolver config is wrong, not the code.",
            from: {},
            to: { couldNotResolve: true },
        },
        {
            name: "layer-L0-consts",
            severity: "error",
            comment: "L0 consts is the universal sink: it must not import any other src layer.",
            from: { path: "^src/consts/" },
            to: { path: aboveL0 },
        },
        {
            name: "layer-L1-types",
            severity: "error",
            comment: "L1 types may import only from L0 consts (and itself).",
            from: { path: "^src/types/" },
            to: { path: aboveL1 },
        },
        {
            name: "layer-L2-shared",
            severity: "error",
            comment: "L2 (shared, models) may import only from L0-L1 (and L2 siblings).",
            from: { path: "^src/(shared|models)/" },
            to: { path: aboveL2 },
        },
        {
            name: "layer-L3-base",
            severity: "error",
            comment: "L3 (state, logging, prompts, run) may import only from L0-L2 (and L3 siblings).",
            from: { path: "^src/(state|logging|prompts|run)/" },
            to: { path: aboveL3 },
        },
        {
            name: "layer-L4-capabilities",
            severity: "error",
            comment: "L4 (tools, hitl) may import only from L0-L3 (and L4 siblings).",
            from: { path: "^src/(tools|hitl)/" },
            to: { path: aboveL4 },
        },
        {
            name: "layer-L5-patching",
            severity: "error",
            comment: "L5 patching may import only from L0-L4.",
            from: { path: "^src/patching/" },
            to: { path: aboveL5 },
        },
        {
            name: "layer-L6-orchestration",
            severity: "error",
            comment: "L6 (swarm, graph) may import only from L0-L5 (and L6 siblings, subject to swarm-no-graph below).",
            from: { path: "^src/(swarm|graph)/" },
            to: { path: aboveL6 },
        },
        {
            name: "swarm-no-graph",
            severity: "error",
            comment:
                "Within L6 the only allowed direction is graph -> swarm. The swarm sub-graph must never import the main graph.",
            from: { path: "^src/swarm/" },
            to: { path: "^src/graph/" },
        },
        {
            name: "unlayered-src-outgoing",
            severity: "error",
            comment:
                "A src/ module outside the closed layer set imported another src/ module. The layer rules are a closed enumeration, so an unlayered dir has no policy and must fail loudly. Fix: add the new dir to ADR-001's table, the layer regexes in this file, and the eslint mirror in eslint.config.js.",
            from: { path: UNLAYERED_SRC },
            to: { path: "^src/" },
        },
        {
            name: "unlayered-src-incoming",
            severity: "error",
            comment:
                "A src/ module imported a target outside the closed layer set, so even a leaf dir that is only imported (never imports) is caught. The layer rules are a closed enumeration; an unlayered dir has no policy and must fail loudly. Fix: add the new dir to ADR-001's table, the layer regexes in this file, and the eslint mirror in eslint.config.js.",
            from: { path: "^src/" },
            to: { path: UNLAYERED_SRC },
        },
    ],
    options: {
        doNotFollow: { path: "node_modules" },
        includeOnly: "^src/",
        tsPreCompilationDeps: true,
        tsConfig: { fileName: "tsconfig.json" },
        enhancedResolveOptions: {
            extensions: [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".json", ".node"],
            mainFields: ["module", "main", "types", "typings"],
            conditionNames: ["import", "require", "node", "default", "types"],
            exportsFields: ["exports"],
        },
    },
};
