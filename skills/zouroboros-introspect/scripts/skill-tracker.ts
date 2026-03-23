#!/usr/bin/env bun
/**
 * Skill Execution Tracker
 *
 * Lightweight tracker that records skill invocations with outcomes.
 * Stored in the shared memory DB in a dedicated `skill_executions` table.
 *
 * Usage:
 *   bun skill-tracker.ts record --skill <name> --outcome <success|failure> [--duration <ms>] [--error <msg>] [--target-file <path>]
 *   bun skill-tracker.ts stats [--since <days>] [--skill <name>]
 *   bun skill-tracker.ts failures [--since <days>] [--skill <name>] [--limit <n>]
 *   bun skill-tracker.ts migrate
 */

import { execSync } from "child_process";
import { existsSync } from "fs";

const MEMORY_DB = process.env.ZOUROBOROS_MEMORY_DB || "/home/workspace/.zo/memory/shared-facts.db";

const { values, positionals } = (await import("util")).parseArgs({
  args: Bun.argv.slice(2),
  options: {
    skill: { type: "string", short: "s" },
    outcome: { type: "string", short: "o" },
    duration: { type: "string", short: "d" },
    error: { type: "string", short: "e" },
    "target-file": { type: "string" },
    since: { type: "string", default: "14" },
    limit: { type: "string", default: "20" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: false,
});

const command = positionals[0] || "stats";

if (values.help) {
  console.log(`
Skill Execution Tracker — Records and queries skill invocation outcomes

COMMANDS:
  record    Log a skill execution
  stats     Show success/failure rates per skill
  failures  Show recent failure details
  migrate   Create the skill_executions table

RECORD OPTIONS:
  --skill, -s        Skill name (e.g., "zo-memory-system", "three-stage-eval")
  --outcome, -o      "success" or "failure"
  --duration, -d     Execution duration in ms
  --error, -e        Error message (for failures)
  --target-file      File that was being operated on

QUERY OPTIONS:
  --since            Days to look back (default: 14)
  --skill, -s        Filter by skill name
  --limit            Max results for failures (default: 20)
`);
  process.exit(0);
}

function sql(query: string): string {
  try {
    return execSync(`sqlite3 "${MEMORY_DB}" "${query.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (e: any) {
    return (e.stdout || "").toString().trim();
  }
}

function migrate() {
  const schema = `
    CREATE TABLE IF NOT EXISTS skill_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure')),
      duration_ms INTEGER,
      error_message TEXT,
      target_file TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_skill_exec_skill ON skill_executions(skill);
    CREATE INDEX IF NOT EXISTS idx_skill_exec_created ON skill_executions(created_at);
  `.replace(/\n/g, " ");

  sql(schema);
  console.log("✅ skill_executions table ready");
}

function record() {
  const skill = values.skill as string;
  const outcome = values.outcome as string;

  if (!skill || !outcome) {
    console.error("ERROR: --skill and --outcome required");
    process.exit(1);
  }

  if (!["success", "failure"].includes(outcome)) {
    console.error("ERROR: --outcome must be 'success' or 'failure'");
    process.exit(1);
  }

  // Auto-migrate if table doesn't exist
  const tableCheck = sql("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_executions';");
  if (!tableCheck.includes("skill_executions")) migrate();

  const duration = values.duration ? parseInt(values.duration as string) : "NULL";
  const error = values.error ? `'${(values.error as string).replace(/'/g, "''").slice(0, 500)}'` : "NULL";
  const targetFile = values["target-file"] ? `'${(values["target-file"] as string).replace(/'/g, "''")}'` : "NULL";

  sql(`INSERT INTO skill_executions (skill, outcome, duration_ms, error_message, target_file) VALUES ('${skill}', '${outcome}', ${duration}, ${error}, ${targetFile});`);
  console.log(`Recorded: ${skill} → ${outcome}`);
}

function stats() {
  const since = parseInt(values.since as string) || 14;
  const skillFilter = values.skill ? `AND skill = '${values.skill}'` : "";

  // Auto-migrate if needed
  const tableCheck = sql("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_executions';");
  if (!tableCheck.includes("skill_executions")) {
    console.log("No skill_executions table — run 'migrate' first or record an execution.");
    process.exit(0);
  }

  const query = `
    SELECT
      skill,
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures,
      ROUND(CAST(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100, 1) as success_rate,
      ROUND(AVG(duration_ms), 0) as avg_duration_ms
    FROM skill_executions
    WHERE created_at > datetime('now', '-${since} days')
    ${skillFilter}
    GROUP BY skill
    ORDER BY success_rate ASC, total DESC;
  `.replace(/\n/g, " ");

  const result = sql(query);

  if (!result) {
    console.log("No skill executions recorded yet.");
    return;
  }

  console.log("Skill Execution Stats (last " + since + " days)");
  console.log("=".repeat(70));
  console.log("Skill                          Total  Pass  Fail  Rate    Avg(ms)");
  console.log("-".repeat(70));

  for (const line of result.split("\n")) {
    const [skill, total, successes, failures, rate, avgMs] = line.split("|");
    if (!skill) continue;
    const rateNum = parseFloat(rate);
    const icon = rateNum >= 85 ? "✅" : rateNum >= 70 ? "⚠️ " : "❌";
    console.log(
      `${icon} ${skill.padEnd(28)} ${total.padStart(5)}  ${successes.padStart(4)}  ${failures.padStart(4)}  ${rate.padStart(5)}%  ${(avgMs || "—").padStart(7)}`
    );
  }
}

function failures() {
  const since = parseInt(values.since as string) || 14;
  const limit = parseInt(values.limit as string) || 20;
  const skillFilter = values.skill ? `AND skill = '${values.skill}'` : "";

  const tableCheck = sql("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_executions';");
  if (!tableCheck.includes("skill_executions")) {
    console.log("No skill_executions table.");
    process.exit(0);
  }

  const query = `
    SELECT skill, error_message, target_file, created_at, duration_ms
    FROM skill_executions
    WHERE outcome = 'failure'
      AND created_at > datetime('now', '-${since} days')
      ${skillFilter}
    ORDER BY created_at DESC
    LIMIT ${limit};
  `.replace(/\n/g, " ");

  const result = sql(query);

  if (!result) {
    console.log("No failures recorded.");
    return;
  }

  console.log("Recent Skill Failures (last " + since + " days)");
  console.log("=".repeat(70));

  for (const line of result.split("\n")) {
    const [skill, error, targetFile, createdAt, durationMs] = line.split("|");
    if (!skill) continue;
    console.log(`\n❌ ${skill} @ ${createdAt} (${durationMs || "?"}ms)`);
    if (targetFile) console.log(`   File: ${targetFile}`);
    if (error) console.log(`   Error: ${error.slice(0, 200)}`);
  }
}

// --- Main ---
if (!existsSync(MEMORY_DB)) {
  console.error(`Memory DB not found: ${MEMORY_DB}`);
  process.exit(1);
}

switch (command) {
  case "migrate": migrate(); break;
  case "record": record(); break;
  case "stats": stats(); break;
  case "failures": failures(); break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
