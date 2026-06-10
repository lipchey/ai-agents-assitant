// runner/src/verify-runner.ts
import path3 from "node:path";

// runner/src/cli.ts
var SCOPE_FLAGS = {
  "--staged": "staged",
  "--fast": "fast",
  "--full": "full",
  "--audit": "audit",
  "--doctor": "doctor",
  "--fix-staged": "fix-staged"
};
function parseArgs(argv) {
  let manifestPath;
  let scope;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === void 0) continue;
    if (arg === "--manifest") {
      const value = argv[i + 1];
      if (value === void 0) {
        return { ok: false, message: "missing value for --manifest <path>" };
      }
      if (manifestPath !== void 0) {
        return { ok: false, message: "--manifest may be given only once" };
      }
      manifestPath = value;
      i += 1;
      continue;
    }
    const scopeFromFlag = SCOPE_FLAGS[arg];
    if (scopeFromFlag !== void 0) {
      if (scope !== void 0) {
        return {
          ok: false,
          message: `multiple scope flags given (${scope}, ${scopeFromFlag}); choose exactly one`
        };
      }
      scope = scopeFromFlag;
      continue;
    }
    return { ok: false, message: `unknown argument: ${arg}` };
  }
  if (manifestPath === void 0) {
    return { ok: false, message: "missing required --manifest <path>" };
  }
  if (scope === void 0) {
    return {
      ok: false,
      message: `missing required scope flag (one of: ${Object.keys(SCOPE_FLAGS).join(", ")})`
    };
  }
  return { ok: true, manifestPath, scope };
}

// runner/src/manifest.ts
import { readFileSync } from "node:fs";

// runner/src/validate.ts
var STACKS = ["node-service", "frontend-web", "n8n-ops", "meta-docs"];
var SCHEDULER_CLASSES = [
  "github-actions-push-and-schedule",
  "n8n-webhook-and-schedule",
  "schedule-only",
  "local-only"
];
var FILESET_SOURCES = ["git_staged", "repo_all"];
var PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "none"];
var CHECK_MODES = ["blocking", "report-only"];
var TOP_LEVEL_REQUIRED = [
  "version",
  "repo",
  "stack",
  "scheduler_class",
  "budgets",
  "policy",
  "paths",
  "generated",
  "workspaces",
  "filesets",
  "tiers"
];
var TOP_LEVEL_ALLOWED = [...TOP_LEVEL_REQUIRED, "workflow"];
var BUDGET_KEYS = ["staged_seconds", "fast_seconds", "full_seconds", "audit_seconds"];
var POLICY_KEYS = [
  "mutates_by_default",
  "format_fix_staged_allowed",
  "typed_eslint_in_precommit",
  "block_new_dead_code_only"
];
var PATH_KEYS = ["reports", "baselines"];
var WORKSPACE_KEYS = ["name", "path", "stack", "package_manager"];
var FILESET_REQUIRED = ["name", "source", "include"];
var FILESET_ALLOWED = [...FILESET_REQUIRED, "exclude", "diff_filter"];
var CHECK_REQUIRED = ["name", "argv", "timeout_seconds"];
var CHECK_ALLOWED = [...CHECK_REQUIRED, "skip_if_empty", "mode", "baseline", "bypassable"];
var REQUIRED_TIERS = ["staged", "fast", "full"];
var TIER_NAMES = ["staged", "fast", "full", "audit"];
var WORKFLOW_KEYS = ["enabled"];
var FILES_TOKEN = /^\{files:([A-Za-z0-9_-]+)\}$/;
var UNSUPPORTED_GLOB_SYNTAX = /[?\[{]/;
function addError(errors, path4, rule, message, ...value) {
  const error = { path: path4, rule, message };
  if (value.length === 1) {
    error.value = value[0];
  }
  errors.push(error);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUnknownArray(value) {
  return Array.isArray(value);
}
function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function describeValue(value) {
  if (value === null) return "null";
  if (isUnknownArray(value)) return "an array";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "object":
      return "an object";
    default:
      return String(value);
  }
}
function childPath(parentPath, key) {
  return parentPath === "" ? key : `${parentPath}.${key}`;
}
function requireRecord(value, path4, errors) {
  if (isRecord(value)) return value;
  addError(errors, path4, "type", `must be an object, got ${describeValue(value)}`, value);
  return void 0;
}
function requireKeys(record, parentPath, keys, errors) {
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) {
      addError(errors, childPath(parentPath, key), "required", `missing required key "${key}"`);
    }
  }
}
function rejectUnknownKeys(record, parentPath, allowed, errors) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      addError(
        errors,
        childPath(parentPath, key),
        "additional-property",
        `unknown key "${key}" (allowed keys: ${allowed.join(", ")})`,
        record[key]
      );
    }
  }
}
function validateNonEmptyString(value, path4, errors) {
  if (typeof value !== "string") {
    addError(errors, path4, "type", `must be a string, got ${describeValue(value)}`, value);
  } else if (value.length === 0) {
    addError(errors, path4, "min-length", "must be a non-empty string", value);
  }
}
function validateString(value, path4, errors) {
  if (typeof value !== "string") {
    addError(errors, path4, "type", `must be a string, got ${describeValue(value)}`, value);
  }
}
function validateBoolean(value, path4, errors) {
  if (typeof value !== "boolean") {
    addError(errors, path4, "type", `must be a boolean, got ${describeValue(value)}`, value);
  }
}
function validatePositiveInteger(value, path4, errors) {
  if (!isPositiveInteger(value)) {
    addError(errors, path4, "type", `must be a positive integer, got ${describeValue(value)}`, value);
  }
}
function validateEnum(value, path4, allowed, errors) {
  if (typeof value === "string" && allowed.includes(value)) return;
  addError(
    errors,
    path4,
    "enum",
    `must be one of: ${allowed.join(", ")}; got ${describeValue(value)}`,
    value
  );
}
function validateStringArray(value, path4, minItems, errors) {
  if (!isUnknownArray(value)) {
    addError(errors, path4, "type", `must be an array of strings, got ${describeValue(value)}`, value);
    return;
  }
  if (value.length < minItems) {
    addError(errors, path4, "min-items", `must contain at least ${minItems} item`, value);
  }
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      addError(errors, `${path4}[${index}]`, "type", `must be a string, got ${describeValue(item)}`, item);
    }
  });
}
function validateStructure(root, errors) {
  requireKeys(root, "", TOP_LEVEL_REQUIRED, errors);
  rejectUnknownKeys(root, "", TOP_LEVEL_ALLOWED, errors);
  if (Object.hasOwn(root, "version")) validateVersion(root["version"], errors);
  if (Object.hasOwn(root, "repo")) validateNonEmptyString(root["repo"], "repo", errors);
  if (Object.hasOwn(root, "stack")) validateEnum(root["stack"], "stack", STACKS, errors);
  if (Object.hasOwn(root, "scheduler_class")) {
    validateEnum(root["scheduler_class"], "scheduler_class", SCHEDULER_CLASSES, errors);
  }
  if (Object.hasOwn(root, "budgets")) validateBudgets(root["budgets"], errors);
  if (Object.hasOwn(root, "policy")) validatePolicy(root["policy"], errors);
  if (Object.hasOwn(root, "paths")) validatePaths(root["paths"], errors);
  if (Object.hasOwn(root, "generated")) validateGenerated(root["generated"], errors);
  if (Object.hasOwn(root, "workspaces")) validateWorkspaces(root["workspaces"], errors);
  if (Object.hasOwn(root, "filesets")) validateFilesets(root["filesets"], errors);
  if (Object.hasOwn(root, "tiers")) validateTiers(root["tiers"], errors);
  if (Object.hasOwn(root, "workflow")) validateWorkflow(root["workflow"], errors);
}
function validateVersion(value, errors) {
  if (value !== 1) {
    addError(
      errors,
      "version",
      "enum",
      `must be 1 (the supported manifest major version), got ${describeValue(value)}`,
      value
    );
  }
}
function validateBudgets(value, errors) {
  const budgets = requireRecord(value, "budgets", errors);
  if (budgets === void 0) return;
  requireKeys(budgets, "budgets", BUDGET_KEYS, errors);
  rejectUnknownKeys(budgets, "budgets", BUDGET_KEYS, errors);
  for (const key of BUDGET_KEYS) {
    if (Object.hasOwn(budgets, key)) validatePositiveInteger(budgets[key], `budgets.${key}`, errors);
  }
}
function validatePolicy(value, errors) {
  const policy = requireRecord(value, "policy", errors);
  if (policy === void 0) return;
  requireKeys(policy, "policy", POLICY_KEYS, errors);
  rejectUnknownKeys(policy, "policy", POLICY_KEYS, errors);
  for (const key of POLICY_KEYS) {
    if (Object.hasOwn(policy, key)) validateBoolean(policy[key], `policy.${key}`, errors);
  }
}
function validatePaths(value, errors) {
  const paths = requireRecord(value, "paths", errors);
  if (paths === void 0) return;
  requireKeys(paths, "paths", PATH_KEYS, errors);
  rejectUnknownKeys(paths, "paths", PATH_KEYS, errors);
  for (const key of PATH_KEYS) {
    if (Object.hasOwn(paths, key)) validateNonEmptyString(paths[key], `paths.${key}`, errors);
  }
}
function validateGenerated(value, errors) {
  const generated = requireRecord(value, "generated", errors);
  if (generated === void 0) return;
  requireKeys(generated, "generated", ["hooks_dir"], errors);
  rejectUnknownKeys(generated, "generated", ["hooks_dir", "ci_quality"], errors);
  if (Object.hasOwn(generated, "hooks_dir")) {
    validateNonEmptyString(generated["hooks_dir"], "generated.hooks_dir", errors);
  }
  if (Object.hasOwn(generated, "ci_quality")) {
    validateString(generated["ci_quality"], "generated.ci_quality", errors);
  }
}
function validateWorkspaces(value, errors) {
  if (!isUnknownArray(value)) {
    addError(errors, "workspaces", "type", `must be an array of workspaces, got ${describeValue(value)}`, value);
    return;
  }
  if (value.length === 0) {
    addError(errors, "workspaces", "min-items", "must declare at least 1 workspace", value);
  }
  value.forEach((entry, index) => {
    validateWorkspace(entry, `workspaces[${index}]`, errors);
  });
}
function validateWorkspace(value, path4, errors) {
  const workspace = requireRecord(value, path4, errors);
  if (workspace === void 0) return;
  requireKeys(workspace, path4, WORKSPACE_KEYS, errors);
  rejectUnknownKeys(workspace, path4, WORKSPACE_KEYS, errors);
  if (Object.hasOwn(workspace, "name")) validateNonEmptyString(workspace["name"], `${path4}.name`, errors);
  if (Object.hasOwn(workspace, "path")) validateNonEmptyString(workspace["path"], `${path4}.path`, errors);
  if (Object.hasOwn(workspace, "stack")) validateEnum(workspace["stack"], `${path4}.stack`, STACKS, errors);
  if (Object.hasOwn(workspace, "package_manager")) {
    validateEnum(workspace["package_manager"], `${path4}.package_manager`, PACKAGE_MANAGERS, errors);
  }
}
function validateFilesets(value, errors) {
  if (!isUnknownArray(value)) {
    addError(errors, "filesets", "type", `must be an array of filesets, got ${describeValue(value)}`, value);
    return;
  }
  value.forEach((entry, index) => {
    validateFileset(entry, `filesets[${index}]`, errors);
  });
}
function validateFileset(value, path4, errors) {
  const fileset = requireRecord(value, path4, errors);
  if (fileset === void 0) return;
  requireKeys(fileset, path4, FILESET_REQUIRED, errors);
  rejectUnknownKeys(fileset, path4, FILESET_ALLOWED, errors);
  if (Object.hasOwn(fileset, "name")) validateNonEmptyString(fileset["name"], `${path4}.name`, errors);
  if (Object.hasOwn(fileset, "source")) validateEnum(fileset["source"], `${path4}.source`, FILESET_SOURCES, errors);
  if (Object.hasOwn(fileset, "include")) validateStringArray(fileset["include"], `${path4}.include`, 1, errors);
  if (Object.hasOwn(fileset, "exclude")) validateStringArray(fileset["exclude"], `${path4}.exclude`, 0, errors);
  if (Object.hasOwn(fileset, "diff_filter")) validateString(fileset["diff_filter"], `${path4}.diff_filter`, errors);
}
function validateTiers(value, errors) {
  const tiers = requireRecord(value, "tiers", errors);
  if (tiers === void 0) return;
  requireKeys(tiers, "tiers", REQUIRED_TIERS, errors);
  rejectUnknownKeys(tiers, "tiers", TIER_NAMES, errors);
  for (const tier of TIER_NAMES) {
    if (Object.hasOwn(tiers, tier)) validateCheckArray(tiers[tier], `tiers.${tier}`, errors);
  }
}
function validateCheckArray(value, path4, errors) {
  if (!isUnknownArray(value)) {
    addError(errors, path4, "type", `must be an array of checks, got ${describeValue(value)}`, value);
    return;
  }
  value.forEach((entry, index) => {
    validateCheck(entry, `${path4}[${index}]`, errors);
  });
}
function validateCheck(value, path4, errors) {
  const check = requireRecord(value, path4, errors);
  if (check === void 0) return;
  requireKeys(check, path4, CHECK_REQUIRED, errors);
  rejectUnknownKeys(check, path4, CHECK_ALLOWED, errors);
  if (Object.hasOwn(check, "name")) validateNonEmptyString(check["name"], `${path4}.name`, errors);
  if (Object.hasOwn(check, "argv")) validateStringArray(check["argv"], `${path4}.argv`, 1, errors);
  if (Object.hasOwn(check, "timeout_seconds")) {
    validatePositiveInteger(check["timeout_seconds"], `${path4}.timeout_seconds`, errors);
  }
  if (Object.hasOwn(check, "skip_if_empty")) validateString(check["skip_if_empty"], `${path4}.skip_if_empty`, errors);
  if (Object.hasOwn(check, "mode")) validateEnum(check["mode"], `${path4}.mode`, CHECK_MODES, errors);
  if (Object.hasOwn(check, "baseline")) validateString(check["baseline"], `${path4}.baseline`, errors);
  if (Object.hasOwn(check, "bypassable")) validateBoolean(check["bypassable"], `${path4}.bypassable`, errors);
}
function validateWorkflow(value, errors) {
  const workflow = requireRecord(value, "workflow", errors);
  if (workflow === void 0) return;
  requireKeys(workflow, "workflow", WORKFLOW_KEYS, errors);
  rejectUnknownKeys(workflow, "workflow", WORKFLOW_KEYS, errors);
  if (!Object.hasOwn(workflow, "enabled")) return;
  const enabled = workflow["enabled"];
  if (enabled !== false && enabled !== true) {
    addError(errors, "workflow.enabled", "enum", `must be false, got ${describeValue(enabled)}`, enabled);
  }
}
function validateSemantics(root, errors) {
  const filesetNames = collectDeclaredFilesetNames(root);
  validateTierBudgets(root, errors);
  validateTierCheckSemantics(root, filesetNames, errors);
  validateFilesetSemantics(root, errors);
  validateWorkspaceUniqueness(root, errors);
  validateWorkflowGate(root, errors);
}
function collectDeclaredFilesetNames(root) {
  const filesets = root["filesets"];
  if (!isUnknownArray(filesets)) return void 0;
  const names = /* @__PURE__ */ new Set();
  for (const fileset of filesets) {
    if (!isRecord(fileset)) continue;
    const name = fileset["name"];
    if (typeof name === "string") names.add(name);
  }
  return names;
}
function validateTierBudgets(root, errors) {
  const budgets = root["budgets"];
  const tiers = root["tiers"];
  if (!isRecord(budgets) || !isRecord(tiers)) return;
  for (const tier of TIER_NAMES) {
    const budget = budgets[`${tier}_seconds`];
    const checks = tiers[tier];
    if (!isPositiveInteger(budget) || !isUnknownArray(checks)) continue;
    const timeouts = checks.map((check) => isRecord(check) ? check["timeout_seconds"] : void 0);
    if (!timeouts.every(isPositiveInteger)) continue;
    const total = timeouts.reduce((sum, timeout) => sum + timeout, 0);
    if (total > budget) {
      addError(
        errors,
        `tiers.${tier}`,
        "tier-budget",
        `sum of timeout_seconds across all checks is ${total}, exceeding budgets.${tier}_seconds (${budget})`,
        total
      );
    }
  }
}
function validateTierCheckSemantics(root, filesetNames, errors) {
  const tiers = root["tiers"];
  if (!isRecord(tiers)) return;
  for (const tier of TIER_NAMES) {
    const checks = tiers[tier];
    if (!isUnknownArray(checks)) continue;
    reportDuplicateNames(checks, `tiers.${tier}`, "check-name-unique", "check", ` in tier "${tier}"`, errors);
    checks.forEach((check, index) => {
      if (!isRecord(check)) return;
      validateCheckSemantics(check, `tiers.${tier}[${index}]`, filesetNames, errors);
    });
  }
}
function validateCheckSemantics(check, checkPath, filesetNames, errors) {
  validateArgvFileTokens(check["argv"], `${checkPath}.argv`, filesetNames, errors);
  const skipIfEmpty = check["skip_if_empty"];
  if (typeof skipIfEmpty === "string" && filesetNames !== void 0 && !filesetNames.has(skipIfEmpty)) {
    addError(
      errors,
      `${checkPath}.skip_if_empty`,
      "skip-if-empty-reference",
      `skip_if_empty references undeclared fileset "${skipIfEmpty}"`,
      skipIfEmpty
    );
  }
}
function validateArgvFileTokens(argv, argvPath, filesetNames, errors) {
  if (!isUnknownArray(argv)) return;
  const tokens = [];
  argv.forEach((element, index) => {
    if (typeof element !== "string") return;
    const filesetName = FILES_TOKEN.exec(element)?.[1];
    if (filesetName !== void 0) tokens.push({ index, filesetName });
  });
  if (tokens.length > 1) {
    addError(
      errors,
      argvPath,
      "files-token-count",
      `argv may contain at most one {files:<fileset>} token, found ${tokens.length}`,
      argv
    );
  }
  if (tokens[0]?.index === 0) {
    addError(
      errors,
      `${argvPath}[0]`,
      "files-token-position",
      "argv[0] must be the executable; a {files:<fileset>} token cannot come first",
      argv[0]
    );
  }
  if (filesetNames === void 0) return;
  for (const token of tokens) {
    if (!filesetNames.has(token.filesetName)) {
      addError(
        errors,
        `${argvPath}[${token.index}]`,
        "files-token-reference",
        `{files:${token.filesetName}} references undeclared fileset "${token.filesetName}"`,
        argv[token.index]
      );
    }
  }
}
function validateFilesetSemantics(root, errors) {
  const filesets = root["filesets"];
  if (!isUnknownArray(filesets)) return;
  reportDuplicateNames(filesets, "filesets", "fileset-name-unique", "fileset", "", errors);
  filesets.forEach((fileset, index) => {
    if (!isRecord(fileset)) return;
    const filesetPath = `filesets[${index}]`;
    validateGlobDialect(fileset["include"], `${filesetPath}.include`, errors);
    validateGlobDialect(fileset["exclude"], `${filesetPath}.exclude`, errors);
    validateDiffFilterScope(fileset, filesetPath, errors);
  });
}
function validateGlobDialect(patterns, path4, errors) {
  if (!isUnknownArray(patterns)) return;
  patterns.forEach((pattern, index) => {
    if (typeof pattern !== "string") return;
    if (UNSUPPORTED_GLOB_SYNTAX.test(pattern)) {
      addError(
        errors,
        `${path4}[${index}]`,
        "glob-dialect",
        'pattern uses unsupported glob syntax ("?", "[", or "{"); the restricted dialect allows "**", "*", and literal segments',
        pattern
      );
    }
  });
}
function validateDiffFilterScope(fileset, filesetPath, errors) {
  if (Object.hasOwn(fileset, "diff_filter") && fileset["source"] === "repo_all") {
    addError(
      errors,
      `${filesetPath}.diff_filter`,
      "diff-filter-scope",
      'diff_filter applies only to filesets with source "git_staged"',
      fileset["diff_filter"]
    );
  }
}
function validateWorkspaceUniqueness(root, errors) {
  const workspaces = root["workspaces"];
  if (!isUnknownArray(workspaces)) return;
  reportDuplicateNames(workspaces, "workspaces", "workspace-name-unique", "workspace", "", errors);
}
function reportDuplicateNames(entries, basePath, rule, label, context, errors) {
  const seen = /* @__PURE__ */ new Set();
  entries.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const name = entry["name"];
    if (typeof name !== "string") return;
    if (seen.has(name)) {
      addError(
        errors,
        `${basePath}[${index}].name`,
        rule,
        `duplicate ${label} name ${JSON.stringify(name)}${context}`,
        name
      );
    }
    seen.add(name);
  });
}
function validateWorkflowGate(root, errors) {
  const workflow = root["workflow"];
  if (!isRecord(workflow)) return;
  if (workflow["enabled"] === true) {
    addError(
      errors,
      "workflow.enabled",
      "workflow-enabled",
      "workflow.enabled is true, but full workflow validation is not implemented yet; omit workflow or set enabled to false",
      true
    );
  }
}
function validate(value) {
  const errors = [];
  if (!isRecord(value)) {
    addError(errors, "", "type", `manifest must be a plain JSON object, got ${describeValue(value)}`, value);
    return { ok: false, errors };
  }
  validateStructure(value, errors);
  validateSemantics(value, errors);
  return { ok: errors.length === 0, errors };
}

// runner/src/manifest.ts
function loadManifest(filePath) {
  const raw = readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [{ path: "", rule: "json-parse", message: `manifest is not valid JSON: ${detail}` }]
    };
  }
  const result = validate(parsed);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }
  return { ok: true, manifest: parsed };
}

// runner/src/manifest-cli.ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
function isMainModule(metaUrl) {
  const argvPath = process.argv[1];
  if (argvPath === void 0) return false;
  const metaPath = fileURLToPath(metaUrl);
  try {
    return realpathSync(argvPath) === realpathSync(metaPath);
  } catch {
    return argvPath === metaPath;
  }
}
var EXIT_USAGE = 2;
var EXIT_MANIFEST = 1;
function formatErrorLine(error) {
  const where = error.path === "" ? "(root)" : error.path;
  return `${where}: ${error.message}`;
}

// runner/src/glob.ts
function matches(path4, pattern) {
  const tokens = tokenize(pattern);
  const n = path4.length;
  const m = tokens.length;
  let next = new Uint8Array(n + 1);
  next[n] = 1;
  for (let j = m - 1; j >= 0; j -= 1) {
    const token = tokens[j];
    const cur = new Uint8Array(n + 1);
    let taken = false;
    for (let i = n; i >= 0; i -= 1) {
      const ch = path4[i];
      let ok = false;
      switch (token.kind) {
        case "lit":
          ok = i < n && ch === token.ch && next[i + 1] === 1;
          break;
        case "star":
          ok = next[i] === 1 || i < n && ch !== "/" && cur[i + 1] === 1;
          break;
        case "globstar":
          ok = next[i] === 1 || i < n && cur[i + 1] === 1;
          break;
        case "globslash": {
          taken = i < n && (ch === "/" && next[i + 1] === 1 || taken);
          ok = next[i] === 1 || taken;
          break;
        }
      }
      cur[i] = ok ? 1 : 0;
    }
    next = cur;
  }
  return next[0] === 1;
}
function tokenize(pattern) {
  const tokens = [];
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          tokens.push({ kind: "globslash" });
          i += 2;
        } else {
          tokens.push({ kind: "globstar" });
          i += 1;
        }
      } else {
        tokens.push({ kind: "star" });
      }
      continue;
    }
    tokens.push({ kind: "lit", ch: pattern[i] });
  }
  return tokens;
}

// runner/src/git.ts
import { spawnSync } from "node:child_process";
function gitFileList(args, cwd) {
  const argv = ["git", ...args];
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.error) {
    throw new Error(`failed to run ${argv.join(" ")} (cwd: ${cwd}): ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(
      `${argv.join(" ")} exited with code ${result.status} (cwd: ${cwd})` + (stderr ? `: ${stderr}` : "")
    );
  }
  const stdout = result.stdout ?? "";
  const parts = stdout.split("\0");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}
function trackedFiles(cwd) {
  return gitFileList(["ls-files", "-z"], cwd);
}
function stagedFiles(diffFilter = "ACMR", cwd) {
  return gitFileList(
    ["diff", "--cached", "--name-only", "-z", `--diff-filter=${diffFilter}`],
    cwd
  );
}

// runner/src/filesets.ts
var DEFAULT_DIFF_FILTER = "ACMR";
function expandFileset(fileset, context) {
  const candidates = selectSource(fileset, context);
  return candidates.filter((file) => {
    const included = fileset.include.some((pattern) => matches(file, pattern));
    if (!included) return false;
    const excluded = (fileset.exclude ?? []).some((pattern) => matches(file, pattern));
    return !excluded;
  });
}
function selectSource(fileset, context) {
  if (fileset.source === "git_staged") {
    const staged = context.stagedFiles ?? stagedFiles;
    return staged(fileset.diff_filter ?? DEFAULT_DIFF_FILTER, context.cwd);
  }
  const tracked = context.trackedFiles ?? trackedFiles;
  return tracked(context.cwd);
}

// runner/src/exec.ts
import { spawnSync as spawnSync2 } from "node:child_process";
var FILES_TOKEN2 = /^\{files:([A-Za-z0-9_-]+)\}$/;
var OPTION_LIKE_OPERAND = /^[-@]/;
function expandArgv(argv, filesByName) {
  const expanded = [];
  for (const element of argv) {
    const match = FILES_TOKEN2.exec(element);
    if (match) {
      const [, name] = match;
      if (name !== void 0) {
        for (const file of filesByName.get(name) ?? []) {
          if (OPTION_LIKE_OPERAND.test(file)) {
            throw new Error(
              `fileset "${name}" produced an option-like operand ${JSON.stringify(file)}; refusing to pass it as a command argument (possible argv option or response-file injection)`
            );
          }
          expanded.push(file);
        }
      }
      continue;
    }
    expanded.push(element);
  }
  return expanded;
}
function skipped(name, tier, mode) {
  return { name, tier, status: "skipped", exitCode: null, durationMs: 0, mode };
}
function runCheck(input) {
  const { check, tier, cwd, filesByName } = input;
  const mode = check.mode ?? "blocking";
  if (check.skip_if_empty !== void 0) {
    const gating = filesByName.get(check.skip_if_empty);
    if (gating === void 0 || gating.length === 0) return skipped(check.name, tier, mode);
  }
  const [file, ...args] = expandArgv(check.argv, filesByName);
  if (file === void 0) return skipped(check.name, tier, mode);
  const startedAt = Date.now();
  const result = spawnSync2(file, args, {
    shell: false,
    stdio: "inherit",
    cwd,
    timeout: check.timeout_seconds * 1e3
  });
  const durationMs = Date.now() - startedAt;
  if (result.error !== void 0) {
    const code = result.error.code;
    if (code === "ETIMEDOUT") {
      return { name: check.name, tier, status: "timeout", exitCode: null, durationMs, mode };
    }
    return { name: check.name, tier, status: "fail", exitCode: 1, durationMs, mode };
  }
  if (result.status === 0) {
    return { name: check.name, tier, status: "pass", exitCode: 0, durationMs, mode };
  }
  return { name: check.name, tier, status: "fail", exitCode: result.status ?? 1, durationMs, mode };
}

// runner/src/budget.ts
function assertWithinBudget(startedAtMs, budgetSeconds) {
  const elapsedMs = Date.now() - startedAtMs;
  const budgetMs = budgetSeconds * 1e3;
  if (elapsedMs > budgetMs) {
    const overrunMs = elapsedMs - budgetMs;
    throw new Error(
      `Runtime budget exceeded: elapsed ${elapsedMs}ms over the ${budgetSeconds}s tier budget by ${overrunMs}ms.`
    );
  }
}

// runner/src/report.ts
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
function writeReport(report, root, reportsPath) {
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(root, reportsPath);
  assertWithinRoot(root, target, reportsPath);
  assertWithinRoot(realRoot, realpathOfDeepestExisting(target), reportsPath);
  fs.mkdirSync(target, { recursive: true });
  assertWithinRoot(realRoot, fs.realpathSync(target), reportsPath);
  const filePath = path.join(target, `verify-${report.scope}.json`);
  writeFileReplacingLeaf(target, filePath, JSON.stringify(report, null, 2) + "\n");
  return filePath;
}
function writeFileReplacingLeaf(dir, filePath, data) {
  const tmp = path.join(dir, `.verify-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  fs.writeFileSync(tmp, data, { flag: "wx" });
  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
    }
    throw error;
  }
}
function assertWithinRoot(root, child, reportsPath) {
  const rel = path.relative(root, child);
  const contained = rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
  if (!contained) {
    throw new Error(
      `paths.reports ${JSON.stringify(reportsPath)} resolves outside the repo root: ${JSON.stringify(child)} is not within ${JSON.stringify(root)}`
    );
  }
}
function realpathOfDeepestExisting(target) {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.realpathSync(current);
}

// runner/src/doctor.ts
import fs2 from "node:fs";
import path2 from "node:path";

// runner/src/scheduler.ts
function reportSchedulerClass(manifest) {
  return `repo "${manifest.repo}" scheduler class: ${manifest.scheduler_class}`;
}

// runner/src/doctor.ts
function doctor(manifest, root) {
  const messages = [reportSchedulerClass(manifest)];
  let ok = true;
  const hooksDir = path2.resolve(root, manifest.generated.hooks_dir);
  if (!isDirectory(hooksDir)) {
    messages.push(
      `advisory: generated hooks directory not found at "${manifest.generated.hooks_dir}" (install hooks to create it)`
    );
  }
  for (const workspace of manifest.workspaces) {
    const workspaceDir = path2.resolve(root, workspace.path);
    if (!isDirectory(workspaceDir)) {
      ok = false;
      messages.push(`workspace "${workspace.name}" directory missing: "${workspace.path}"`);
    }
  }
  return { ok, messages };
}
function isDirectory(target) {
  return fs2.existsSync(target) && fs2.statSync(target).isDirectory();
}

// runner/src/verify-runner.ts
var EXIT_CHECK_FAILED = 1;
function main(argv) {
  const invocation = parseArgs(argv);
  if (!invocation.ok) {
    process.stderr.write(`${invocation.message}
`);
    return EXIT_USAGE;
  }
  const { manifestPath, scope } = invocation;
  const root = path3.dirname(path3.resolve(manifestPath));
  let load;
  try {
    load = loadManifest(manifestPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`could not read manifest at "${manifestPath}": ${detail}
`);
    return EXIT_MANIFEST;
  }
  if (!load.ok) {
    for (const err of load.errors) process.stderr.write(`${formatErrorLine(err)}
`);
    return EXIT_MANIFEST;
  }
  const manifest = load.manifest;
  if (scope === "doctor") {
    const report = doctor(manifest, root);
    for (const message of report.messages) process.stdout.write(`${message}
`);
    return report.ok ? 0 : 1;
  }
  if (scope === "fix-staged") {
    process.stderr.write("fix-staged is reserved and not implemented in Phase 1a\n");
    return EXIT_USAGE;
  }
  try {
    return runTier(manifest, root, scope);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error running ${scope} tier: ${detail}
`);
    return 1;
  }
}
function runTier(manifest, root, scope) {
  const startedAt = Date.now();
  const budgetSeconds = manifest.budgets[`${scope}_seconds`];
  const filesByName = /* @__PURE__ */ new Map();
  for (const fileset of manifest.filesets) {
    filesByName.set(fileset.name, expandFileset(fileset, { cwd: root }));
  }
  const results = [];
  for (const check of tierChecks(manifest, scope)) {
    const result = runCheck({ check, tier: scope, cwd: root, filesByName });
    results.push(result);
    process.stdout.write(summarize(result));
    assertWithinBudget(startedAt, budgetSeconds);
  }
  const reportPath = writeReport(
    { repo: manifest.repo, scope, generatedAt: (/* @__PURE__ */ new Date()).toISOString(), results },
    root,
    manifest.paths.reports
  );
  process.stdout.write(`report: ${reportPath}
`);
  const blockingFailed = results.some(
    (r) => r.mode === "blocking" && (r.status === "fail" || r.status === "timeout")
  );
  return blockingFailed ? EXIT_CHECK_FAILED : 0;
}
function tierChecks(manifest, scope) {
  if (scope === "audit") return manifest.tiers.audit ?? [];
  return manifest.tiers[scope];
}
function summarize(r) {
  const exit = r.exitCode === null ? "-" : String(r.exitCode);
  return `  ${r.status.padEnd(7)} ${r.name} [${r.mode}] ${r.durationMs}ms exit ${exit}
`;
}
if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
export {
  runTier
};
