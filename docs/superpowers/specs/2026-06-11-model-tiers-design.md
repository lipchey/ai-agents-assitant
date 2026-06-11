# Model Tier Layer — Design Spec (2026-06-11)

Owner-approved design for session **R6a** (runs BEFORE R6). Amends §3.2 of
[2026-06-10-boilerplate-refactor-design.md](2026-06-10-boilerplate-refactor-design.md)
(the profile contract). Normative for Task R6a in
[the R-plan](../plans/2026-06-10-boilerplate-refactor.md); Task R6 authors its
example profiles in the tier format defined here.

## 1. Context and goal

Since R2/R3 the code is provider-agnostic: graph nodes call
`callLlm(ModelRole.X, …)` and `profiles/*.json5` bind each of the 8 roles to a
concrete provider/model. The remaining friction is **experimentation
granularity**: swapping the model cascade means editing 8 full bindings per
profile.

This spec adds a **tier indirection** — purpose-based model codenames — so a
profile defines 4 tier bindings and the cascade strategy moves as one unit:

- **role** = what the node does (`router`, `coder`, `critic`, …) — fixed by
  the graph, lives in code.
- **tier** = what class of model executes it (`frontier`, `adviser`,
  `skilled`, `worker`) — bound to concrete models per profile.

Owner decisions (2026-06-11, brainstorm):

- **D-T1** Tiers are an indirection ON TOP of function roles, not a
  replacement. Per-role overrides remain possible.
- **D-T2** Tier names: `frontier` (most capable/expensive), `adviser`
  (strong but cheaper), `skilled` (mid), `worker` (cheapest). The existing
  `ModelRole.FRONTIER` (cheap first-pass reasoner) is renamed to
  `ModelRole.REASONER` to free the word "frontier" for the top tier.
- **D-T3** Scheduling: new session **R6a before R6** (R6 example profiles are
  authored tier-format once; R7–R9 unchanged).
- **D-T4** No backward compatibility with the flat profile format. The only
  existing profile (`default.json5`) is migrated in-session,
  behavior-byte-equivalently. Pre-v0.1.0, no compat shim.

## 2. Profile contract v2 (pinned)

```json5
{
  name: "example",
  transport: { default: "openclaw" },
  // REQUIRED: all four tiers, each a full ModelBinding (existing schema:
  // provider, model, optional transport, optional params).
  tiers: {
    frontier: { provider: "anthropic", model: "anthropic/claude-opus-4-8", params: { thinking: "adaptive", reasoningEffort: "high" } },
    adviser:  { provider: "anthropic", model: "anthropic/claude-opus-4-8", params: { thinking: "adaptive", reasoningEffort: "high" } },
    skilled:  { provider: "anthropic", model: "anthropic/claude-sonnet-4-6", params: { temperature: 0.2 } },
    worker:   { provider: "deepseek",  model: "deepseek/deepseek-v4-flash", params: { temperature: 0, thinking: "disabled" } },
  },
  // OPTIONAL: per-role overrides. Two mutually exclusive shapes:
  //   a) full ModelBinding (has provider+model)      → bypasses tiers entirely
  //   b) { tier, params? }                           → reassign tier and/or merge params
  roles: {
    reasoner: { provider: "deepseek", model: "deepseek/deepseek-v4-pro", params: { temperature: 0.2, thinking: "enabled", reasoningEffort: "high" } },
    critic:   { provider: "openai",   model: "openai/gpt-5.5", params: { temperature: 0.1 } },
    // or: coder: { tier: "adviser", params: { temperature: 0 } },
  },
  // budget / tuning / workerTools / prompts — unchanged from §3.2 v1.
}
```

Schema notes:

- `tiers` is a zod object with all four keys required; values reuse the
  existing `ModelBinding` schema unchanged.
- Role-override union: `ModelBinding | { tier: z.enum(TIER_NAMES), params? }`,
  both `.strict()` so the shapes cannot be mixed (an object with both
  `provider` and `tier` is rejected).
- Tier-reassignment overrides carry `params` only — no `transport` (YAGNI;
  a role needing a different transport uses a full-binding override).
- `roles` keys must be members of the (renamed) `ModelRole` union.

## 3. Default role→tier map (code)

Lives in `src/models/` next to `resolveBinding` (e.g. `DEFAULT_ROLE_TIER`):

| Role                       | Default tier |
| -------------------------- | ------------ |
| `router`                   | `worker`     |
| `firewall`                 | `worker`     |
| `worker`                   | `worker`     |
| `coder`                    | `skilled`    |
| `reasoner` (was `frontier`)| `adviser`    |
| `architect`                | `adviser`    |
| `critic`                   | `adviser`    |
| `sme`                      | `frontier`   |

`sme` (tiebreaker/escalation oracle) is the only default consumer of the
`frontier` tier — matching the cascade philosophy: the top model runs only
behind escalation gates.

## 4. Resolution algorithm (`resolveBinding`)

```
resolveBinding(role, profile):
  override = profile.roles?.[role]
  if override is a full ModelBinding        → return it verbatim
  tier  = override?.tier ?? DEFAULT_ROLE_TIER[role]
  base  = profile.tiers[tier]
  return { ...base, params: { ...base.params, ...override?.params } }
```

Precedence: full override > tier reassignment > code default tier. Param
merge: role-override params win key-by-key over tier params. Everything
downstream (per-call options merging from R2, transport dispatch from R3,
`structuredSchema` from R5) is unchanged — `resolveBinding` still returns a
plain `ModelBinding`.

Load-time validation (fail fast, extends the existing loader checks):

- all four tiers present (zod);
- pricing entry required for every tier binding AND every full-binding
  override (existing pricing check, applied to the new positions);
- gateway-prefixed model ids rejected on effective-direct bindings (existing
  R3 check, applied to the new positions);
- unknown role keys and malformed overrides rejected by zod.

## 5. Rename: `ModelRole.FRONTIER` → `ModelRole.REASONER`

Scope (mechanical, enum value string `"frontier"` → `"reasoner"`):

- `src/consts/models.ts` (`ModelRole`),
- call sites: `src/graph/nodes/architects.ts`, `src/graph/nodes/critics.ts`,
  `src/swarm/nodes.ts`,
- `profiles/default.json5` role key,
- tests referencing the role key (characterization + profile suites).

**NOT in scope:** graph node names `frontierArchitect` / `frontierCritic`
stay — they are part of the FROZEN RunSummary contract (§3.4 of the R-spec)
and appear in `NodeVisit` records. A node rename is a separate owner decision
(backlog).

## 6. `default.json5` migration (byte-equivalent behavior)

The migrated default profile must resolve every role to exactly the same
binding as today, keeping the R1 characterization suite green (the only test
edits allowed are the `frontier`→`reasoner` role-key rename):

| Role                     | Resolved via                  | Binding (unchanged)                              |
| ------------------------ | ----------------------------- | ------------------------------------------------ |
| `router`/`firewall`/`worker` | tier `worker`             | deepseek-v4-flash, temp 0, thinking disabled     |
| `coder`                  | tier `skilled`                | sonnet-4-6, temp 0.2                             |
| `architect`              | tier `adviser`                | opus-4-8, thinking adaptive, effort high         |
| `sme`                    | tier `frontier`               | opus-4-8, thinking adaptive, effort high         |
| `reasoner`               | **full override**             | deepseek-v4-pro, temp 0.2, thinking on, effort high |
| `critic`                 | **full override**             | gpt-5.5, temp 0.1                                |

`prompts.cascadeNote` in `default.json5` keeps its current bytes (it is
profile data accurately describing this profile's cascade). The code-side
`DEFAULT_CASCADE_NOTE` fallback (used only when a profile omits the note) is
reworded to tier vocabulary — e.g. "workers route and compress; advisers
architect and review; the frontier model runs ONLY behind escalation gates" —
which does not affect default-profile runs.

## 7. Example profiles (R6 input)

R6 authors its three profiles in tier format. Updated `personal-dev` sketch
(supersedes the flat sketch in §3.2 v1; still illustrative — R6 finalizes):

```json5
{
  name: "personal-dev",
  description: "Quality-first personal dev; Fable 5 behind escalation gates.",
  transport: { default: "direct" },
  tiers: {
    frontier: { provider: "anthropic", model: "claude-fable-5",    params: { thinking: "adaptive", reasoningEffort: "high" } },
    adviser:  { provider: "anthropic", model: "claude-sonnet-4-6", params: { thinking: "adaptive" } },
    skilled:  { provider: "anthropic", model: "claude-sonnet-4-6", params: { thinking: "adaptive" } },
    worker:   { provider: "anthropic", model: "claude-haiku-4-5" },
  },
  roles: {
    critic: { provider: "openai", model: "gpt-5.5" }, // cross-family critique
  },
  budget: { costBudgetUsd: 2.0 },
}
```

`research-playground` = current DeepSeek-heavy cascade on direct transport
(tiers only, reasoner override as in default); `client-baseline` = worker
DeepSeek flash, skilled Sonnet, adviser/frontier Opus, no cross-family critic,
budget 0.50. The experimentation loop this design exists for: copy a profile,
edit 4 tier lines, run.

## 8. Testing

- R1 characterization suite: green, unchanged except the role-key rename.
- Default-profile equivalence pinning: `resolveBinding(role, default)` × all
  8 roles returns exactly the pre-R6a bindings.
- New unit tests (`tests/unit/profile.test.ts` or a sibling): resolution
  precedence (default tier / tier reassign / full override / params merge
  order), loader failures (missing tier key; override mixing `tier` with
  `provider`; missing pricing on a tier binding; gateway-prefixed id on a
  direct tier binding).

## 9. Out of scope / backlog

- Auto-generating `cascadeNote` from tier composition (keep manual, YAGNI).
- Graph node renames (`frontierArchitect`, `frontierCritic`) — frozen
  RunSummary names.
- Swarm profile propagation — pre-existing backlog item, unchanged by this
  design (swarm call sites resolve through the same `resolveBinding`).
- Declarative topology variants (spec D3 deferral) — unchanged.

## 10. Risks

- **Characterization drift**: any resolved-binding change in the default
  profile breaks the suite — the migration table in §6 is the contract;
  verify before commit.
- **Schema strictness**: `.strict()` on override shapes is what prevents
  silent half-overrides (e.g. a typo'd `tier` key falling through to a
  default); do not relax it.
- **Naming collision residue**: the `worker` word is both a role and a tier;
  contexts never mix (roles live in code/`roles` map, tiers in `tiers` map),
  and the role's default tier IS `worker`, so the overlap reads naturally.
