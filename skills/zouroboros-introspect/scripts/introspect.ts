#!/usr/bin/env bun
/**
 * Zouroboros Introspect — Self-diagnostic health scorecard
 *
 * Measures health across all Zouroboros subsystems:
 *   1. Memory Recall (eval-continuation fixture pass rate)
 *   2. Graph Connectivity (orphan fact ratio)
 *   3. Routing Accuracy (episode success vs executor misroute)
 *   4. Eval Calibration (Stage 3 override rate)
 *   5. Procedure Freshness (stale procedure ratio)
 *   6. Episode Velocity (success trend over 14 days)
 *   7. Skill Effectiveness (per-skill success rate from skill_executions)
 *
 * Usage: bun introspect.ts [--json] [--store] [--verbose]
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";

const WORKSPACE = "/home/workspace";
const MEMORY_SCRIPTS = join(WORKSPACE, "Skills/zo-memory-system/scripts");
const MEMORY_DB = join(WORKSPACE, ".zo/memory/shared-facts.db");
const EVAL_REPORTS_GLOB = join(WORKSPACE, "**/evaluations/eval-*.txt");

// --- CLI Args ---
const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has("--json");
const STORE = args.has("--store");
const VERBOSE = args.has("--verbose");

if (args.has("--help") || args.has("-h")) {
  console.log(`
Zouroboros Introspect — Self-diagnostic health scorecard

Usage: bun introspect.ts [--json] [--store] [--verbose]

Flags:
  --json      Output scorecard as JSON
  --store     Save scorecard as memory episode
  --verbose   Show detailed per-check output
  --help      Show this help
`);
  process.exit(0);
}

// --- Types ---
interface MetricResult {
  name: string;
  value: number;        // raw metric (e.g., 0.82 = 82%)
  target: number;       // healthy threshold
  critical: number;     // critical threshold
  weight: number;
  score: number;        // normalized 0.0-1.0
  status: "HEALTHY" | "WARNING" | "CRITICAL";
  trend: "↑" | "↓" | "→" | "—";
  detail: string;
  recommendation: string;
}

interface Scorecard {
  timestamp: string;
  composite: number;
  metrics: MetricResult[];
  weakest: string;
  topOpportunities: { metric: string; action: string; impact: number }[];
}

// --- Helpers ---
function run(cmd: string, cwd?: string): { stdout: string; ok: boolean; code: number } {
  try {
    const stdout = execSync(cmd, {
      cwd: cwd || WORKSPACE,
      timeout: 60_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), ok: true, code: 0 };
  } catch (e: any) {
    return {
      stdout: (e.stdout || "").toString().trim(),
      ok: false,
      code: e.status ?? 1,
    };
  }
}

function normalize(value: number, target: number, critical: number, inverted = false): number {
  // inverted=true means lower is better (e.g., override rate)
  if (inverted) {
    if (value <= target) return 1.0;
    if (value >= critical) return 0.0;
    return 1.0 - (value - target) / (critical - target);
  }
  if (value >= target) return 1.0;
  if (value <= critical) return 0.0;
  return (value - critical) / (target - critical);
}

function status(score: number): "HEALTHY" | "WARNING" | "CRITICAL" {
  if (score >= 0.85) return "HEALTHY";
  if (score >= 0.3) return "WARNING";
  return "CRITICAL";
}

function log(msg: string) {
  if (VERBOSE) console.error(`  [introspect] ${msg}`);
}

// --- Metric Collectors ---

async function measureMemoryRecall(): Promise<MetricResult> {
  log("Running eval-continuation...");
  const evalScript = join(MEMORY_SCRIPTS, "eval-continuation.ts");

  if (!existsSync(evalScript)) {
    return fallback("Memory Recall", 0.22, "eval-continuation.ts not found");
  }

  const result = run(`bun "${evalScript}" 2>&1`);
  // Parse "Rate: XX.X%" from output
  const rateMatch = result.stdout.match(/Rate:\s*([\d.]+)%/);
  const passRate = rateMatch ? parseFloat(rateMatch[1]) / 100 : -1;

  if (passRate < 0) {
    // Try parsing "Passed: M" and "Cases: N"
    const casesMatch = result.stdout.match(/Cases:\s*(\d+)/);
    const passedMatch = result.stdout.match(/Passed:\s*(\d+)/);
    if (casesMatch && passedMatch) {
      const cases = parseInt(casesMatch[1]);
      const passed = parseInt(passedMatch[1]);
      const rate = cases > 0 ? passed / cases : 0;
      return buildMetric("Memory Recall", rate, 0.85, 0.70, 0.22,
        `${passed}/${cases} fixtures passed (${(rate * 100).toFixed(1)}%)`,
        rate < 0.85
          ? "Add continuation fixtures for missed cases; tune graph-boost weights"
          : "Recall is healthy — consider tightening target to 90%");
    }
    return fallback("Memory Recall", 0.25, `Could not parse eval output: ${result.stdout.slice(0, 200)}`);
  }

  return buildMetric("Memory Recall", passRate, 0.85, 0.70, 0.22,
    `${(passRate * 100).toFixed(1)}% fixture pass rate`,
    passRate < 0.85
      ? "Add continuation fixtures for missed cases; tune graph-boost weights"
      : "Recall is healthy — consider tightening target to 90%");
}

async function measureGraphConnectivity(): Promise<MetricResult> {
  log("Running knowledge-gaps analysis...");
  const graphScript = join(MEMORY_SCRIPTS, "graph.ts");

  if (!existsSync(graphScript)) {
    return fallback("Graph Connectivity", 0.14, "graph.ts not found");
  }

  const result = run(`bun "${graphScript}" knowledge-gaps 2>&1`);

  // Parse "Total facts: N" and "Linked facts: M (X.X%)"
  const totalMatch = result.stdout.match(/Total facts:\s*(\d+)/);
  const linkedMatch = result.stdout.match(/Linked facts:\s*(\d+)\s*\(([\d.]+)%\)/);
  const orphanMatch = result.stdout.match(/Orphan facts:\s*(\d+)\s*\(([\d.]+)%\)/);
  const componentMatch = result.stdout.match(/Connected components:\s*(\d+)/);

  if (!totalMatch) {
    // Try alternative: if DB exists, query directly
    if (existsSync(MEMORY_DB)) {
      const dbResult = run(`sqlite3 "${MEMORY_DB}" "SELECT COUNT(*) FROM facts; SELECT COUNT(DISTINCT source_id) + COUNT(DISTINCT target_id) FROM fact_links;"`);
      const lines = dbResult.stdout.split("\n").filter(Boolean);
      if (lines.length >= 2) {
        const total = parseInt(lines[0]);
        const linked = parseInt(lines[1]);
        const ratio = total > 0 ? Math.min(linked / total, 1.0) : 0;
        return buildMetric("Graph Connectivity", ratio, 0.80, 0.60, 0.14,
          `${linked}/${total} facts have graph links (${(ratio * 100).toFixed(1)}%)`,
          ratio < 0.80
            ? "Run wikilink auto-capture on orphan entities; batch-link co-occurring entities"
            : "Graph connectivity is healthy");
      }
    }
    return fallback("Graph Connectivity", 0.14, `Could not parse graph output: ${result.stdout.slice(0, 200)}`);
  }

  const total = parseInt(totalMatch[1]);
  const linkedPct = linkedMatch ? parseFloat(linkedMatch[2]) / 100 : 0;
  const orphanCount = orphanMatch ? parseInt(orphanMatch[1]) : 0;
  const components = componentMatch ? parseInt(componentMatch[1]) : 0;

  const detail = `${(linkedPct * 100).toFixed(1)}% linked (${total} facts, ${orphanCount} orphans, ${components} components)`;

  return buildMetric("Graph Connectivity", linkedPct, 0.80, 0.60, 0.14,
    detail,
    linkedPct < 0.80
      ? `Link ${orphanCount} orphan facts; run wikilink auto-capture; merge ${components} components`
      : "Graph connectivity is healthy — consider running weekly gap analysis");
}

async function measureRoutingAccuracy(): Promise<MetricResult> {
  log("Analyzing swarm episode outcomes...");

  if (!existsSync(MEMORY_DB)) {
    return fallback("Routing Accuracy", 0.20, "Memory DB not found");
  }

  // Query episodes tagged with swarm execution outcomes from the last 14 days
  const query = `
    SELECT
      e.outcome,
      COUNT(*) as cnt
    FROM episodes e
    WHERE e.created_at > datetime('now', '-14 days')
      AND (e.summary LIKE '%swarm%' OR e.summary LIKE '%executor%' OR e.summary LIKE '%route%'
           OR EXISTS (SELECT 1 FROM episode_entities ee WHERE ee.episode_id = e.id
                      AND (ee.entity LIKE '%swarm%' OR ee.entity LIKE '%executor%')))
    GROUP BY e.outcome;
  `;

  const result = run(`sqlite3 "${MEMORY_DB}" "${query.replace(/\n/g, " ")}" 2>&1`);

  if (!result.ok || !result.stdout.trim()) {
    // No swarm episodes found — check if episodes table exists at all
    const tableCheck = run(`sqlite3 "${MEMORY_DB}" "SELECT COUNT(*) FROM episodes WHERE created_at > datetime('now', '-14 days');" 2>&1`);
    const totalEpisodes = parseInt(tableCheck.stdout) || 0;

    if (totalEpisodes === 0) {
      return buildMetric("Routing Accuracy", -1, 0.85, 0.70, 0.20,
        "No episodes in last 14 days — insufficient data",
        "Run swarm tasks to generate routing episode data");
    }

    // Episodes exist but none are swarm-tagged — analyze general success rate
    const generalQuery = `SELECT outcome, COUNT(*) FROM episodes WHERE created_at > datetime('now', '-14 days') GROUP BY outcome;`;
    const generalResult = run(`sqlite3 "${MEMORY_DB}" "${generalQuery}" 2>&1`);
    const outcomes = parseOutcomes(generalResult.stdout);
    const total = outcomes.success + outcomes.failure + outcomes.resolved + outcomes.ongoing;
    const accuracy = total > 0 ? (outcomes.success + outcomes.resolved) / total : -1;

    return buildMetric("Routing Accuracy", accuracy, 0.85, 0.70, 0.18,
      `${total} general episodes: ${outcomes.success} success, ${outcomes.failure} failure, ${outcomes.resolved} resolved`,
      accuracy < 0.85
        ? "Investigate failure episodes; retune 6-signal weights"
        : "Routing appears healthy — generate more swarm-tagged episodes for precision");
  }

  const outcomes = parseOutcomes(result.stdout);
  const total = outcomes.success + outcomes.failure + outcomes.resolved + outcomes.ongoing;
  const accuracy = total > 0 ? (outcomes.success + outcomes.resolved) / total : -1;

  return buildMetric("Routing Accuracy", accuracy, 0.85, 0.70, 0.18,
    `${total} swarm episodes: ${outcomes.success} success, ${outcomes.failure} failure`,
    accuracy < 0.85
      ? "Retune 6-signal weights; add capability keywords; adjust complexity thresholds"
      : "Routing accuracy is healthy");
}

function parseOutcomes(stdout: string): { success: number; failure: number; resolved: number; ongoing: number } {
  const result = { success: 0, failure: 0, resolved: 0, ongoing: 0 };
  for (const line of stdout.split("\n")) {
    const [outcome, count] = line.split("|");
    if (outcome && count) {
      const key = outcome.trim() as keyof typeof result;
      if (key in result) result[key] = parseInt(count.trim()) || 0;
    }
  }
  return result;
}

async function measureEvalCalibration(): Promise<MetricResult> {
  log("Checking eval calibration (Stage 3 override rate)...");

  // Look for eval report files
  const evalDirs = [
    join(WORKSPACE, "evaluations"),
    join(WORKSPACE, "Zouroboros/evaluations"),
  ];

  let totalEvals = 0;
  let stage3Overrides = 0;

  for (const dir of evalDirs) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir).filter(f => f.startsWith("eval-") && f.endsWith(".txt"));
      for (const file of files) {
        totalEvals++;
        const content = readFileSync(join(dir, file), "utf-8");
        // Check if Stage 3 was triggered AND its result differs from Stage 2
        const stage2Match = content.match(/Stage 2:.*?Result:\s*(PASSED|FAILED|PENDING)/s);
        const stage3Match = content.match(/Stage 3:.*?Result:\s*(PASSED|FAILED|APPROVED|REJECTED|NEEDS_WORK)/s);
        if (stage2Match && stage3Match && stage3Match[1] !== "PENDING" && stage3Match[1] !== "SKIPPED") {
          // Stage 3 was run — check if it overrode
          const s2Pass = stage2Match[1] === "PASSED";
          const s3Pass = ["PASSED", "APPROVED"].includes(stage3Match[1]);
          if (s2Pass !== s3Pass) stage3Overrides++;
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  if (totalEvals === 0) {
    // Check memory for eval episodes
    if (existsSync(MEMORY_DB)) {
      const evalEps = run(`sqlite3 "${MEMORY_DB}" "SELECT COUNT(*) FROM episodes WHERE summary LIKE '%eval%' AND created_at > datetime('now', '-30 days');" 2>&1`);
      const count = parseInt(evalEps.stdout) || 0;
      return buildMetric("Eval Calibration", -1, 0.15, 0.30, 0.14,
        `No eval report files found (${count} eval episodes in memory)`,
        "Run three-stage-eval on recent artifacts to generate calibration data", true);
    }
    return fallback("Eval Calibration", 0.14, "No eval data available");
  }

  const overrideRate = totalEvals > 0 ? stage3Overrides / totalEvals : 0;

  return buildMetric("Eval Calibration", overrideRate, 0.15, 0.30, 0.14,
    `${stage3Overrides}/${totalEvals} evals had Stage 3 overrides (${(overrideRate * 100).toFixed(1)}%)`,
    overrideRate > 0.15
      ? "Adjust drift threshold; add semantic fixtures; calibrate AC compliance scoring"
      : "Eval calibration is healthy — Stage 2 judgments are reliable",
    true);
}

async function measureProcedureFreshness(): Promise<MetricResult> {
  log("Checking procedure freshness...");

  if (!existsSync(MEMORY_DB)) {
    return fallback("Procedure Freshness", 0.14, "Memory DB not found");
  }

  // Check if procedures table exists
  const tableCheck = run(`sqlite3 "${MEMORY_DB}" "SELECT name FROM sqlite_master WHERE type='table' AND name='procedures';" 2>&1`);
  if (!tableCheck.stdout.includes("procedures")) {
    return buildMetric("Procedure Freshness", -1, 0.30, 0.60, 0.14,
      "Procedures table not found — migrations may be needed",
      "Run: bun memory.ts migrate", true);
  }

  const query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN updated_at < datetime('now', '-14 days') THEN 1 ELSE 0 END) as stale
    FROM procedures;
  `;

  const result = run(`sqlite3 "${MEMORY_DB}" "${query.replace(/\n/g, " ")}" 2>&1`);
  const [total, stale] = (result.stdout || "0|0").split("|").map(n => parseInt(n) || 0);

  if (total === 0) {
    return buildMetric("Procedure Freshness", -1, 0.30, 0.60, 0.14,
      "No procedures found — system has no learned workflows yet",
      "Create procedures from successful swarm runs: bun memory.ts procedures --auto <pattern>", true);
  }

  const staleRate = stale / total;

  return buildMetric("Procedure Freshness", staleRate, 0.30, 0.60, 0.14,
    `${stale}/${total} procedures stale >14d (${(staleRate * 100).toFixed(1)}%)`,
    staleRate > 0.30
      ? `Evolve ${stale} stale procedures: bun memory.ts procedures --evolve <id>`
      : "Procedure freshness is healthy",
    true);
}

async function measureEpisodeVelocity(): Promise<MetricResult> {
  log("Calculating episode velocity trend...");

  if (!existsSync(MEMORY_DB)) {
    return fallback("Episode Velocity", 0.10, "Memory DB not found");
  }

  // Compare success rate: last 7 days vs prior 7 days
  const query = `
    SELECT
      SUM(CASE WHEN created_at > datetime('now', '-7 days') AND outcome = 'success' THEN 1 ELSE 0 END) as recent_success,
      SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) as recent_total,
      SUM(CASE WHEN created_at <= datetime('now', '-7 days') AND created_at > datetime('now', '-14 days') AND outcome = 'success' THEN 1 ELSE 0 END) as prior_success,
      SUM(CASE WHEN created_at <= datetime('now', '-7 days') AND created_at > datetime('now', '-14 days') THEN 1 ELSE 0 END) as prior_total
    FROM episodes;
  `;

  const result = run(`sqlite3 "${MEMORY_DB}" "${query.replace(/\n/g, " ")}" 2>&1`);
  const parts = (result.stdout || "0|0|0|0").split("|").map(n => parseInt(n) || 0);
  const [recentSuccess, recentTotal, priorSuccess, priorTotal] = parts;

  const recentRate = recentTotal > 0 ? recentSuccess / recentTotal : -1;
  const priorRate = priorTotal > 0 ? priorSuccess / priorTotal : -1;

  if (recentTotal === 0 && priorTotal === 0) {
    return buildMetric("Episode Velocity", -1, 0.50, -0.20, 0.10,
      "No episodes in last 14 days",
      "Generate episodes through swarm runs and memory operations");
  }

  // Trend: positive difference is good
  let trendValue: number;
  let trend: "↑" | "↓" | "→" | "—";

  if (priorRate < 0 || recentRate < 0) {
    trendValue = recentRate >= 0 ? recentRate : 0;
    trend = "—";
  } else {
    const delta = recentRate - priorRate;
    trendValue = 0.5 + delta; // center at 0.5, positive delta = above 0.5
    trend = delta > 0.05 ? "↑" : delta < -0.05 ? "↓" : "→";
  }

  const detail = [
    `Recent 7d: ${recentSuccess}/${recentTotal} success (${recentRate >= 0 ? (recentRate * 100).toFixed(0) : "N/A"}%)`,
    `Prior 7d: ${priorSuccess}/${priorTotal} success (${priorRate >= 0 ? (priorRate * 100).toFixed(0) : "N/A"}%)`,
    `Trend: ${trend}`,
  ].join("; ");

  return buildMetric("Episode Velocity", trendValue, 0.50, -0.20, 0.08,
    detail,
    trendValue < 0.50
      ? "Investigate recent failure episodes; check executor health; review infrastructure changes"
      : "Episode velocity is positive — system is improving",
    false, trend);
}

async function measureSkillEffectiveness(): Promise<MetricResult> {
  log("Checking skill execution success rates...");

  if (!existsSync(MEMORY_DB)) {
    return fallback("Skill Effectiveness", 0.10, "Memory DB not found");
  }

  // Check if skill_executions table exists
  const tableCheck = run(`sqlite3 "${MEMORY_DB}" "SELECT name FROM sqlite_master WHERE type='table' AND name='skill_executions';" 2>&1`);
  if (!tableCheck.stdout.includes("skill_executions")) {
    return buildMetric("Skill Effectiveness", -1, 0.85, 0.70, 0.10,
      "skill_executions table not found — run: bun skill-tracker.ts migrate",
      "Create the skill_executions table and instrument skills to record outcomes");
  }

  const query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successes,
      COUNT(DISTINCT skill) as unique_skills
    FROM skill_executions
    WHERE created_at > datetime('now', '-14 days');
  `;

  const result = run(`sqlite3 "${MEMORY_DB}" "${query.replace(/\n/g, " ")}" 2>&1`);
  const parts = (result.stdout || "0|0|0").split("|").map(n => parseInt(n) || 0);
  const [total, successes, uniqueSkills] = parts;

  if (total === 0) {
    return buildMetric("Skill Effectiveness", -1, 0.85, 0.70, 0.10,
      "No skill executions recorded in last 14 days",
      "Instrument skills to record outcomes via skill-tracker.ts");
  }

  const successRate = successes / total;

  // Also get worst-performing skills
  const worstQuery = `
    SELECT skill,
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as ok
    FROM skill_executions
    WHERE created_at > datetime('now', '-14 days')
    GROUP BY skill
    HAVING total >= 3
    ORDER BY CAST(ok AS FLOAT) / total ASC
    LIMIT 3;
  `;
  const worstResult = run(`sqlite3 "${MEMORY_DB}" "${worstQuery.replace(/\n/g, " ")}" 2>&1`);
  const worstSkills = worstResult.stdout ? worstResult.stdout.split("\n").map(l => {
    const [skill, t, o] = l.split("|");
    return `${skill}(${o}/${t})`;
  }).join(", ") : "";

  const detail = `${successes}/${total} executions succeeded (${(successRate * 100).toFixed(1)}%) across ${uniqueSkills} skills` +
    (worstSkills ? `. Weakest: ${worstSkills}` : "");

  return buildMetric("Skill Effectiveness", successRate, 0.85, 0.70, 0.10,
    detail,
    successRate < 0.85
      ? "Analyze failing skills; fix error patterns; expand skill capabilities"
      : "Skill effectiveness is healthy");
}

// --- Builders ---

function buildMetric(
  name: string, value: number, target: number, critical: number, weight: number,
  detail: string, recommendation: string,
  inverted = false, forceTrend?: "↑" | "↓" | "→" | "—"
): MetricResult {
  const noData = value < 0;
  const score = noData ? 0.5 : normalize(value, target, critical, inverted);
  return {
    name,
    value: noData ? -1 : value,
    target,
    critical,
    weight,
    score,
    status: noData ? "WARNING" : status(score),
    trend: forceTrend || "—",
    detail,
    recommendation,
  };
}

function fallback(name: string, weight: number, reason: string): MetricResult {
  return {
    name,
    value: -1,
    target: 0,
    critical: 0,
    weight,
    score: 0.5,
    status: "WARNING",
    trend: "—",
    detail: `[SKIP] ${reason}`,
    recommendation: "Fix prerequisite to enable this metric",
  };
}

// --- Main ---

async function main() {
  const startTime = Date.now();

  console.error("🐍 Zouroboros Introspect — Self-Diagnostic Scorecard\n");

  // Run all collectors
  const metrics = await Promise.all([
    measureMemoryRecall(),
    measureGraphConnectivity(),
    measureRoutingAccuracy(),
    measureEvalCalibration(),
    measureProcedureFreshness(),
    measureEpisodeVelocity(),
    measureSkillEffectiveness(),
  ]);

  // Compute composite score
  const composite = Math.round(
    metrics.reduce((sum, m) => sum + m.score * m.weight, 0) * 100
  );

  // Find weakest
  const weakest = metrics.reduce((prev, curr) =>
    curr.score < prev.score ? curr : prev
  );

  // Rank opportunities (lowest score, highest weight = highest impact)
  const opportunities = metrics
    .filter(m => m.status !== "HEALTHY")
    .map(m => ({
      metric: m.name,
      action: m.recommendation,
      impact: Math.round((1 - m.score) * m.weight * 100),
    }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);

  const scorecard: Scorecard = {
    timestamp: new Date().toISOString(),
    composite,
    metrics,
    weakest: weakest.name,
    topOpportunities: opportunities,
  };

  const durationMs = Date.now() - startTime;

  // --- Output ---
  if (JSON_OUT) {
    console.log(JSON.stringify(scorecard, null, 2));
  } else {
    printScorecard(scorecard, durationMs);
  }

  // --- Store to memory ---
  if (STORE) {
    await storeEpisode(scorecard, durationMs);
  }

  // Exit code: 0 if healthy, 1 if any critical
  const hasCritical = metrics.some(m => m.status === "CRITICAL");
  process.exit(hasCritical ? 1 : 0);
}

function printScorecard(sc: Scorecard, durationMs: number) {
  const STATUS_ICON = { HEALTHY: "✅", WARNING: "⚠️ ", CRITICAL: "❌" };
  const bar = "═".repeat(56);

  console.log(`╔${bar}╗`);
  console.log(`║  ZOUROBOROS INTROSPECTION SCORECARD                     ║`);
  console.log(`║  ${sc.timestamp.slice(0, 19).replace("T", " ")}                              ║`);
  console.log(`╠${bar}╣`);

  for (const m of sc.metrics) {
    const icon = STATUS_ICON[m.status];
    const pct = m.value >= 0 ? `${(m.value * 100).toFixed(1)}%` : "N/A  ";
    const scorePct = `${(m.score * 100).toFixed(0)}%`.padStart(4);
    const nameCol = m.name.padEnd(22);
    console.log(`║  ${icon} ${nameCol} ${pct.padStart(6)} ${m.trend} score:${scorePct}  ║`);
  }

  console.log(`╠${bar}╣`);

  const compStr = `${sc.composite}/100`;
  const compStatus = sc.composite >= 75 ? "HEALTHY" : sc.composite >= 50 ? "WARNING" : "CRITICAL";
  const compIcon = STATUS_ICON[compStatus];
  console.log(`║  ${compIcon} COMPOSITE HEALTH: ${compStr.padEnd(35)}  ║`);
  console.log(`║     Weakest: ${sc.weakest.padEnd(41)}  ║`);
  console.log(`╠${bar}╣`);

  if (sc.topOpportunities.length > 0) {
    console.log(`║  TOP IMPROVEMENT OPPORTUNITIES                         ║`);
    for (let i = 0; i < sc.topOpportunities.length; i++) {
      const o = sc.topOpportunities[i];
      const line = `${i + 1}. [impact:${o.impact}] ${o.metric}`;
      console.log(`║  ${line.padEnd(54)}║`);
      // Wrap action text
      const actionLines = wrapText(o.action, 50);
      for (const al of actionLines) {
        console.log(`║     ${al.padEnd(51)}║`);
      }
    }
  } else {
    console.log(`║  🎯 All systems healthy — no improvements needed       ║`);
  }

  console.log(`╠${bar}╣`);
  console.log(`║  Completed in ${(durationMs / 1000).toFixed(1)}s                                    ║`);
  console.log(`╚${bar}╝`);
}

function wrapText(text: string, maxLen: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function storeEpisode(sc: Scorecard, durationMs: number) {
  const memoryScript = join(MEMORY_SCRIPTS, "memory.ts");
  if (!existsSync(memoryScript)) {
    console.error("[store] memory.ts not found — skipping episode storage");
    return;
  }

  const summary = [
    `Zouroboros introspection scorecard: composite ${sc.composite}/100.`,
    `Weakest: ${sc.weakest}.`,
    sc.topOpportunities.length > 0
      ? `Top opportunity: ${sc.topOpportunities[0].metric} (impact ${sc.topOpportunities[0].impact}).`
      : "All systems healthy.",
  ].join(" ");

  const outcome = sc.composite >= 75 ? "success" : sc.composite >= 50 ? "ongoing" : "failure";

  const entities = [
    "zouroboros.introspection",
    ...sc.metrics.filter(m => m.status !== "HEALTHY").map(m => `zouroboros.${m.name.toLowerCase().replace(/\s+/g, "-")}`),
  ];

  const metadata = JSON.stringify({
    composite: sc.composite,
    weakest: sc.weakest,
    metrics: sc.metrics.map(m => ({ name: m.name, value: m.value, score: m.score, status: m.status })),
    opportunities: sc.topOpportunities,
  });

  const cmd = [
    `bun "${memoryScript}" episodes --create`,
    `--summary "${summary.replace(/"/g, '\\"')}"`,
    `--outcome ${outcome}`,
    `--entities "${entities.join(",")}"`,
    `--duration ${durationMs}`,
    `--metadata '${metadata}'`,
  ].join(" ");

  const result = run(cmd);
  if (result.ok) {
    console.error(`[store] Scorecard saved as ${outcome} episode (${entities[0]})`);
  } else {
    console.error(`[store] Failed to save episode: ${result.stdout.slice(0, 200)}`);
  }

  // Also store composite score as a fact for trend tracking
  const factCmd = [
    `bun "${memoryScript}" store`,
    `--entity "zouroboros.health"`,
    `--key "composite-${new Date().toISOString().slice(0, 10)}"`,
    `--value "Composite health score: ${sc.composite}/100. Weakest: ${sc.weakest}. ${sc.topOpportunities.map(o => `${o.metric}(${o.impact})`).join(", ")}"`,
    `--category fact`,
    `--decay active`,
    `--importance 0.8`,
    `--source introspect`,
  ].join(" ");

  run(factCmd);
  console.error("[store] Health fact saved for trend tracking");
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
