#!/usr/bin/env tsx
// scrub-npm.ts — audit installed npm packages against known supply-chain
// compromises and worm-shaped lifecycle scripts. Run via `pnpm scrub`.
//
// Exit codes: 0 clean, 1 review-required, 2 confirmed-IOC-match.
//
// Coverage:
//   A. Exact (name@version) match against a curated IOC list.
//   B. Compromised-scope match (any version under @scope/) → manual review.
//   C. node_modules lifecycle-script scan: preinstall/install/postinstall/
//      prepare hooks containing worm-shaped patterns (curl|sh, bun.sh,
//      base64+eval, git-protocol pinned deps, raw GitHub URL fetches).
//   D. optionalDependencies / dependencies using github: protocol — the
//      Mini Shai-Hulud TanStack vector. Always reviewed.
//   E. File-system grep for known C2 domains across node_modules.
//
// Refresh the IOC tables below whenever a new incident surfaces. Public
// IOC sources: Wiz, Snyk, StepSecurity, Socket.dev, Unit 42 (Palo Alto).
// Last refreshed: 2026-05-12 for "Mini Shai-Hulud" (TanStack + @mistralai
// + @uipath + @squawk, published 2026-05-11).
//
// This script is intentionally dependency-free — uses only node:* built-ins
// and `pnpm list --json` for dep discovery, so it runs even when the
// workspace itself is mid-incident.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ───────────────────────────────────────────────────────────────────────
// IOC tables — refresh on every incident
// ───────────────────────────────────────────────────────────────────────

/** Exact (name, version) matches. Adding a new entry: cite the campaign
 *  and link the public IOC source in the source comment above. */
type CompromisedVersion = {
  name: string;
  versions: string[];
  campaign: string;
};

const COMPROMISED_VERSIONS: CompromisedVersion[] = [
  // Mini Shai-Hulud — published 2026-05-11 between 19:20–19:26 UTC.
  // Source: stepsecurity.io/blog/mini-shai-hulud-is-back, wiz.io blog,
  // socket.dev blog, snyk.io blog.
  { name: "@tanstack/router-utils", versions: ["1.161.11", "1.161.14"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/router-core", versions: ["1.169.5", "1.169.8"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/arktype-adapter", versions: ["1.166.12", "1.166.15"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/eslint-plugin-router", versions: ["1.161.9", "1.161.12"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/eslint-plugin-start", versions: ["0.0.4", "0.0.7"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/history", versions: ["1.161.9", "1.161.12"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/nitro-v2-vite-plugin", versions: ["1.154.12", "1.154.15"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/react-router", versions: ["1.169.5", "1.169.8"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/react-router-devtools", versions: ["1.166.16", "1.166.19"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/react-router-ssr-query", versions: ["1.166.15", "1.166.18"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/react-start", versions: ["1.167.68", "1.167.71"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/react-start-client", versions: ["1.166.51", "1.166.54"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/react-start-rsc", versions: ["0.0.47", "0.0.50"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/react-start-server", versions: ["1.166.55", "1.166.58"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/router-cli", versions: ["1.166.46", "1.166.49"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/router-devtools", versions: ["1.166.16", "1.166.19"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/router-devtools-core", versions: ["1.167.6", "1.167.9"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/router-generator", versions: ["1.166.45", "1.166.48"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/router-plugin", versions: ["1.167.38", "1.167.41"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/router-ssr-query-core", versions: ["1.168.3", "1.168.6"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/router-vite-plugin", versions: ["1.166.53", "1.166.56"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/solid-router", versions: ["1.169.5", "1.169.8"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/solid-router-devtools", versions: ["1.166.16", "1.166.19"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/solid-router-ssr-query", versions: ["1.166.15", "1.166.18"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/solid-start", versions: ["1.167.65", "1.167.68"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/solid-start-client", versions: ["1.166.50", "1.166.53"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/solid-start-server", versions: ["1.166.54", "1.166.57"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/start-client-core", versions: ["1.168.5", "1.168.8"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/start-fn-stubs", versions: ["1.161.9", "1.161.12"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/start-plugin-core", versions: ["1.169.23", "1.169.26"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/start-server-core", versions: ["1.167.33", "1.167.36"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/start-static-server-functions", versions: ["1.166.44", "1.166.47"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/start-storage-context", versions: ["1.166.38", "1.166.41"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/valibot-adapter", versions: ["1.166.12", "1.166.15"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/virtual-file-routes", versions: ["1.161.10", "1.161.13"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/vue-router", versions: ["1.169.5", "1.169.8"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/vue-router-devtools", versions: ["1.166.16", "1.166.19"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/vue-router-ssr-query", versions: ["1.166.15", "1.166.18"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/vue-start", versions: ["1.167.61", "1.167.64"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/vue-start-client", versions: ["1.166.46", "1.166.49"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/vue-start-server", versions: ["1.166.50", "1.166.53"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@tanstack/zod-adapter", versions: ["1.166.12", "1.166.15"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@mistralai/mistralai", versions: ["2.2.3", "2.2.4"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@mistralai/mistralai-azure", versions: ["1.7.2", "1.7.3"], campaign: "mini-shai-hulud-2026-05" },
  { name: "@mistralai/mistralai-gcp", versions: ["1.7.2", "1.7.3"], campaign: "mini-shai-hulud-2026-05" },
];

/** Scope-wide compromise: if any package under the scope is installed at
 *  any version, flag for human review. Used when a maintainer/token was
 *  compromised and the scope's safe set is still being triaged. */
const COMPROMISED_SCOPES: { scope: string; campaign: string; note: string }[] = [
  { scope: "@tanstack/", campaign: "mini-shai-hulud-2026-05", note: "Token-takeover scope. Pin to versions outside the IOC list and verify against vendor postmortem." },
  { scope: "@mistralai/", campaign: "mini-shai-hulud-2026-05", note: "Token-takeover scope. Verify version against vendor advisory." },
  { scope: "@uipath/", campaign: "mini-shai-hulud-2026-05", note: "~50 packages compromised. Manual triage required." },
  { scope: "@squawk/", campaign: "mini-shai-hulud-2026-05", note: "Aviation-tooling scope hit by the same campaign. Unrelated to the sbdchd/squawk SQL linter." },
];

/** C2 domains observed in worm payloads. Grep node_modules for these. */
const IOC_DOMAINS = [
  "api.masscan.cloud",
  "filev2.getsession.org",
  "git-tanstack.com",
  "seed1.getsession.org",
];

/** Worm-shaped patterns in lifecycle scripts. Generic by design — catches
 *  unknown campaigns that share shape with known ones. */
const SUSPICIOUS_SCRIPT_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bbun\.sh\b/i, reason: "bun.sh referenced in install hook — Shai-Hulud signature" },
  { pattern: /\bcurl\s+[^\n;]*\|\s*(sh|bash|node)\b/i, reason: "curl piped to shell/node — remote-code execution vector" },
  { pattern: /\bwget\s+[^\n;]*\|\s*(sh|bash|node)\b/i, reason: "wget piped to shell/node — remote-code execution vector" },
  { pattern: /\beval\s*\(\s*(Buffer\.from|atob)\s*\(/i, reason: "eval(Buffer.from/atob(…)) — encoded-payload execution" },
  { pattern: /github\.com\/[^/\s'")]+\/[^/\s'")]+\/raw\//i, reason: "raw GitHub URL fetch in lifecycle hook" },
  { pattern: /\brouter_init\.js\b/, reason: "router_init.js file reference — Mini Shai-Hulud artifact" },
  { pattern: /\btanstack_runner\.js\b/, reason: "tanstack_runner.js file reference — Mini Shai-Hulud artifact" },
];

/** Spec patterns that always warrant review when used in any
 *  dependency/optionalDependency entry. */
const SUSPICIOUS_DEP_SPEC_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /^github:/i, reason: "github: protocol dep — bypasses npm provenance; Mini Shai-Hulud vector" },
  { pattern: /^git\+(https?|ssh):\/\//i, reason: "git URL dep — bypasses npm provenance" },
  { pattern: /^https?:\/\//i, reason: "raw tarball URL dep — bypasses npm provenance" },
];

// ───────────────────────────────────────────────────────────────────────
// Implementation
// ───────────────────────────────────────────────────────────────────────

type Severity = "FATAL" | "REVIEW" | "INFO";

type Finding = {
  severity: Severity;
  kind: string;
  message: string;
  details?: Record<string, unknown>;
};

const args = new Set(process.argv.slice(2));
const wantJson = args.has("--json");
const verbose = args.has("--verbose") || args.has("-v");

const cwd = process.cwd();
const findings: Finding[] = [];

function log(line: string): void {
  if (!wantJson) process.stdout.write(`${line}\n`);
}

function logErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

// A. + B. + D. — walk installed deps via `pnpm list --json` and check
// against IOC tables / suspicious spec patterns.
function discoverInstalled(): Map<string, Set<string>> {
  const out = execSync("pnpm list --json --recursive --depth=Infinity", {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(out);
  const seen = new Map<string, Set<string>>();
  const stack: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
      const dep = (node as Record<string, unknown>)[key];
      if (!dep || typeof dep !== "object") continue;
      for (const [name, info] of Object.entries(dep as Record<string, unknown>)) {
        if (!info || typeof info !== "object") continue;
        const version = (info as Record<string, unknown>).version;
        const from = (info as Record<string, unknown>).from;
        if (typeof version === "string") {
          if (!seen.has(name)) seen.set(name, new Set());
          seen.get(name)!.add(version);
        }
        // Workspace-relative `from` strings sometimes carry git/url specs
        if (typeof from === "string") {
          for (const p of SUSPICIOUS_DEP_SPEC_PATTERNS) {
            if (p.pattern.test(from)) {
              findings.push({
                severity: "REVIEW",
                kind: "SUSPICIOUS_DEP_SPEC",
                message: `${name} resolves from suspicious spec`,
                details: { name, spec: from, reason: p.reason },
              });
            }
          }
        }
        stack.push(info);
      }
    }
  }
  return seen;
}

function checkIocVersions(installed: Map<string, Set<string>>): void {
  for (const ioc of COMPROMISED_VERSIONS) {
    const have = installed.get(ioc.name);
    if (!have) continue;
    for (const v of have) {
      if (ioc.versions.includes(v)) {
        findings.push({
          severity: "FATAL",
          kind: "IOC_VERSION_MATCH",
          message: `${ioc.name}@${v} is a known compromised release (${ioc.campaign})`,
          details: { name: ioc.name, version: v, campaign: ioc.campaign },
        });
      }
    }
  }
}

function checkCompromisedScopes(installed: Map<string, Set<string>>): void {
  for (const [name, versions] of installed) {
    for (const s of COMPROMISED_SCOPES) {
      if (name.startsWith(s.scope)) {
        findings.push({
          severity: "REVIEW",
          kind: "COMPROMISED_SCOPE",
          message: `${name} is under a recently-compromised scope (${s.campaign}) — manual triage required`,
          details: { name, versions: [...versions], campaign: s.campaign, note: s.note },
        });
      }
    }
  }
}

// C. — walk the pnpm content-addressed store and scan lifecycle scripts.
function* iterStorePackageJsons(root: string): Generator<{ pkgPath: string; json: Record<string, unknown> }> {
  if (!existsSync(root)) return;
  for (const slot of readdirSync(root)) {
    const inner = join(root, slot, "node_modules");
    if (!existsSync(inner)) continue;
    // pnpm stores can have @scope/name → recurse one level for scopes
    for (const top of readdirSync(inner)) {
      const topPath = join(inner, top);
      if (!statSync(topPath).isDirectory()) continue;
      if (top.startsWith("@")) {
        for (const sub of readdirSync(topPath)) {
          const pkg = join(topPath, sub);
          const pj = join(pkg, "package.json");
          if (existsSync(pj)) {
            try {
              yield { pkgPath: pkg, json: JSON.parse(readFileSync(pj, "utf8")) as Record<string, unknown> };
            } catch {
              // ignore unparseable
            }
          }
        }
      } else {
        const pj = join(topPath, "package.json");
        if (existsSync(pj)) {
          try {
            yield { pkgPath: topPath, json: JSON.parse(readFileSync(pj, "utf8")) as Record<string, unknown> };
          } catch {
            // ignore unparseable
          }
        }
      }
    }
  }
}

function checkLifecycleScripts(): void {
  const root = join(cwd, "node_modules", ".pnpm");
  const lifecycle = ["preinstall", "install", "postinstall", "prepare"] as const;
  for (const { pkgPath, json } of iterStorePackageJsons(root)) {
    const scripts = json.scripts as Record<string, unknown> | undefined;
    if (scripts && typeof scripts === "object") {
      for (const hook of lifecycle) {
        const body = scripts[hook];
        if (typeof body !== "string") continue;
        for (const p of SUSPICIOUS_SCRIPT_PATTERNS) {
          if (p.pattern.test(body)) {
            findings.push({
              severity: "REVIEW",
              kind: "SUSPICIOUS_LIFECYCLE_SCRIPT",
              message: `${json.name as string}@${json.version as string} ${hook}: ${p.reason}`,
              details: { name: json.name, version: json.version, hook, body, reason: p.reason, path: pkgPath },
            });
          }
        }
      }
    }
    for (const depKey of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
      const deps = json[depKey] as Record<string, unknown> | undefined;
      if (!deps || typeof deps !== "object") continue;
      for (const [n, spec] of Object.entries(deps)) {
        if (typeof spec !== "string") continue;
        for (const p of SUSPICIOUS_DEP_SPEC_PATTERNS) {
          if (p.pattern.test(spec)) {
            findings.push({
              severity: "REVIEW",
              kind: "SUSPICIOUS_DEP_SPEC_IN_INSTALLED",
              message: `${json.name as string}@${json.version as string} pulls ${n} via ${spec} (${p.reason})`,
              details: { holder: json.name, holderVersion: json.version, dep: n, spec, reason: p.reason, depKey, path: pkgPath },
            });
          }
        }
      }
    }
  }
}

// E. — grep node_modules for C2 domain strings. Cheap last-line check.
//
// Uses spawnSync with array args (not a shell) so paths don't need quoting
// and Windows backslashes don't get interpreted. rg exit codes:
//   0 = matches found
//   1 = no matches (clean)
//   2 = errors during scan (e.g., unreadable files) — stdout matches are
//       still trustworthy; we surface a non-fatal note in verbose mode.
function checkIocDomains(): void {
  const root = join(cwd, "node_modules");
  if (!existsSync(root)) return;
  const pattern = IOC_DOMAINS.map(function (d) { return d.replace(/\./g, "\\."); }).join("|");
  const result = spawnSync(
    "rg",
    ["--no-messages", "--files-with-matches", "--hidden", "-e", pattern, root],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false },
  );
  if (result.error) {
    const errnoCode = (result.error as NodeJS.ErrnoException).code;
    if (errnoCode === "ENOENT") {
      log("    (rg not on PATH — skipping C2-domain grep; install ripgrep for full coverage)");
      return;
    }
    logErr(`scrub: rg spawn failed: ${result.error.message}`);
    return;
  }
  const status = result.status;
  if (status === 1) return; // clean: no matches
  if (status !== 0 && status !== 2) {
    logErr(`scrub: rg exited with unexpected status ${String(status)}: ${result.stderr.trim()}`);
    return;
  }
  if (status === 2 && verbose) {
    log(`    (rg reported read errors during scan; stdout matches still trustworthy)`);
  }
  const hits = result.stdout.split(/\r?\n/).filter(Boolean);
  for (const file of hits) {
    findings.push({
      severity: "FATAL",
      kind: "IOC_C2_DOMAIN_IN_FILE",
      message: `Known C2 domain string present in node_modules file`,
      details: { file },
    });
  }
}

// ───────────────────────────────────────────────────────────────────────
// Reporting
// ───────────────────────────────────────────────────────────────────────

function render(): { exitCode: 0 | 1 | 2; summary: string } {
  const byKind = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind)!.push(f);
  }
  const fatal = findings.filter(function (f) { return f.severity === "FATAL"; });
  const review = findings.filter(function (f) { return f.severity === "REVIEW"; });
  const exitCode: 0 | 1 | 2 = fatal.length > 0 ? 2 : review.length > 0 ? 1 : 0;

  if (wantJson) {
    process.stdout.write(JSON.stringify({ exitCode, findings, counts: { fatal: fatal.length, review: review.length } }, null, 2));
    return { exitCode, summary: "" };
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("─── pnpm scrub — supply-chain audit ─────────────────────────");
  lines.push(`  FATAL : ${fatal.length}`);
  lines.push(`  REVIEW: ${review.length}`);
  lines.push("─────────────────────────────────────────────────────────────");
  if (findings.length === 0) {
    lines.push("  CLEAN — no IOC matches, no worm-shaped lifecycle scripts.");
  } else {
    for (const [kind, group] of byKind) {
      lines.push("");
      lines.push(`  [${kind}] (${group.length})`);
      for (const f of group) {
        lines.push(`    ${f.severity.padEnd(6)} ${f.message}`);
        if (verbose && f.details) {
          const printable: Record<string, unknown> = { ...f.details };
          // truncate noisy bodies in verbose output
          if (typeof printable.body === "string" && printable.body.length > 240) {
            printable.body = `${(printable.body as string).slice(0, 240)}…`;
          }
          for (const [k, v] of Object.entries(printable)) {
            lines.push(`           ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
          }
        }
      }
    }
    lines.push("");
    if (fatal.length > 0) {
      lines.push("  ACTION (FATAL): remove or pin the matched (name, version) pairs out of");
      lines.push("                  the IOC range in every workspace package.json, then run");
      lines.push("                  `pnpm install --frozen-lockfile=false`. Rotate any creds");
      lines.push("                  that were reachable from a machine that installed the");
      lines.push("                  malicious version: GitHub PATs, npm tokens, cloud keys.");
    }
    if (review.length > 0) {
      lines.push("  ACTION (REVIEW): triage each finding above. Scope hits → verify the exact");
      lines.push("                   version is outside the published IOC range per the");
      lines.push("                   campaign's postmortem. Lifecycle-script hits → read the");
      lines.push("                   body with --verbose and decide if it's legitimate.");
    }
  }
  lines.push("");
  return { exitCode, summary: lines.join("\n") };
}

// ───────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────

function main(): never {
  log("scrub: discovering installed packages via pnpm list…");
  const installed = discoverInstalled();
  log(`scrub: ${installed.size} unique package names installed.`);

  log("scrub: checking IOC version matches…");
  checkIocVersions(installed);

  log("scrub: checking compromised-scope matches…");
  checkCompromisedScopes(installed);

  log("scrub: scanning lifecycle scripts in node_modules/.pnpm…");
  checkLifecycleScripts();

  log("scrub: grepping node_modules for known C2 domains…");
  checkIocDomains();

  const { exitCode, summary } = render();
  if (summary) process.stdout.write(summary);
  process.exit(exitCode);
}

main();
