#!/usr/bin/env node
/**
 * Unified test runner for Herrero Pianos.
 *
 * Runs all non-database domain tests in sequence, captures results,
 * and prints a summary table. Exits 1 if any test file fails.
 *
 * Usage:  npm test           (lint + typecheck + all domain tests)
 *         node tests/run-tests.mjs   (domain tests only)
 *
 * Database-dependent integration tests (task-flow.cjs) are NOT run here
 * because they require a running PostgreSQL instance. Use:
 *   npm run test:integration
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const testFiles = [
  { name: "service-money", file: "tests/service-money.ts" },
  { name: "service-mock", file: "tests/service-mock.ts" },
  { name: "service-documents", file: "tests/service-documents.ts" },
  { name: "showroom-grouping", file: "tests/showroom-grouping.ts" },
  { name: "website-content", file: "tests/website-content.ts" },
  { name: "dashboard-helpers", file: "tests/dashboard-helpers.ts" },
  { name: "service-reports", file: "tests/service-reports.ts" },
  { name: "service-flow", file: "tests/service-flow.ts" },
  { name: "service-lines", file: "tests/service-lines.ts" },
  { name: "service-today", file: "tests/service-today.ts" },
  { name: "service-jobs-list", file: "tests/service-jobs-list.ts" },
  { name: "service-finance-split", file: "tests/service-finance-split.ts" },
  { name: "service-expense-edit", file: "tests/service-expense-edit.ts" },
  { name: "service-expense-form", file: "tests/service-expense-form.ts" },
  { name: "service-job-cost", file: "tests/service-job-cost.ts" },
  { name: "service-parts-backfill", file: "tests/service-parts-backfill.ts" },
  { name: "service-finance-audit", file: "tests/service-finance-audit.ts" },
  { name: "service-finance-history", file: "tests/service-finance-history.ts" },
  { name: "service-finance-edit", file: "tests/service-finance-edit.ts" },
  { name: "service-dashboard", file: "tests/service-dashboard.ts" },
  { name: "service-invoiced-split", file: "tests/service-invoiced-split.ts" },
  { name: "service-time-events", file: "tests/service-time-events.ts" },
  { name: "service-sale", file: "tests/service-sale.ts" },
  { name: "service-waitlist", file: "tests/service-waitlist.ts" },
  { name: "service-geo", file: "tests/service-geo.ts" },
  { name: "service-last-service", file: "tests/service-last-service.ts" },
  { name: "service-customer-list", file: "tests/service-customer-list.ts" },
  { name: "service-reminders", file: "tests/service-reminders.ts" },
  { name: "service-waitlist-convert", file: "tests/service-waitlist-convert.ts" },
  { name: "service-inquiry", file: "tests/service-inquiry.ts" },
  { name: "service-followups", file: "tests/service-followups.ts" },
  { name: "pub-text", file: "tests/pub-text.ts" },
];

function runTest(name, file) {
  return new Promise((resolvePromise) => {
    const fullPath = resolve(projectRoot, file);
    const child = spawn("node", ["--import", "tsx", fullPath], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });

    child.on("error", () => {
      resolvePromise({ name, passed: false, passedAssertions: 0, failedAssertions: 0, output: "Failed to spawn process" });
    });

    child.on("close", (code) => {
      const output = stdout + stderr;
      const passed = code === 0;
      const passedAssertions = (output.match(/\u2713/g) || []).length;
      const failedAssertions = (output.match(/\u2717/g) || []).length;
      resolvePromise({ name, passed, passedAssertions, failedAssertions, output });
    });
  });
}

const results = [];
for (const { name, file } of testFiles) {
  process.stdout.write(`  running ${name}...`);
  const result = await runTest(name, file);
  results.push(result);
  process.stdout.write(` ${result.passed ? "PASS" : "FAIL"} (${result.passedAssertions} checks)\n`);
}

let totalAssertions = 0;
let totalFailures = 0;
for (const r of results) {
  totalAssertions += r.passedAssertions + r.failedAssertions;
  totalFailures += r.failedAssertions;
}

// Print detailed output for failed tests
for (const r of results) {
  if (!r.passed) {
    console.log(`\n--- ${r.name} (FAILED) ---`);
    console.log(r.output.trim());
  }
}

// Print summary table
console.log("\n" + "=".repeat(52));
console.log("  Test suite summary");
console.log("=".repeat(52));
for (const r of results) {
  const status = r.passed ? "PASS" : "FAIL";
  const detail = `${r.passedAssertions} passed` + (r.failedAssertions > 0 ? `, ${r.failedAssertions} failed` : "");
  const padding = " ".repeat(Math.max(0, 20 - r.name.length));
  console.log(`  ${status}  ${r.name}${padding}  ${detail}`);
}
console.log("-".repeat(52));
const passedTotal = totalAssertions - totalFailures;
console.log(`  Total: ${passedTotal} passed, ${totalFailures} failed, ${results.length} suites`);
console.log("=".repeat(52));

if (totalFailures > 0 || results.some((r) => !r.passed)) {
  const failedSuites = results.filter((r) => !r.passed).length;
  if (totalFailures > 0) {
    console.log(`\n${totalFailures} assertion(s) failed across ${failedSuites} suite(s).`);
  } else {
    console.log(`\n${failedSuites} suite(s) exited with errors (no assertions detected).`);
  }
  process.exit(1);
}

console.log("\nAll domain checks passed.");
