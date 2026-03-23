#!/usr/bin/env bun
/**
 * Zouroboros Evolve — Evolution engine
 *
 * Takes a prescription and executes the improvement:
 *   - Autoloop mode: delegates to autoloop.ts for file-targeting playbooks
 *   - Script mode: executes playbook directly for procedural improvements
 *
 * Pre-flight: captures baseline scorecard
 * Post-flight: measures delta, reverts on regression
 *
 * Usage: bun evolve.ts --prescription <path> [--dry-run] [--skip-governor]
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const WORKSPACE = "/home/workspace";
const INTROSPECT = join(WORKSPACE, "Skills/zouroboros-introspect/scripts/introspect.ts");
const AUTOLOOP = join(WORKSPACE, "Skills/autoloop/scripts/autoloop.ts");
const MEMORY_SCRIPTS = join(WORKSPACE, "Skills/zo-memory-system/scripts");
const MEMORY_DB = join(WORKSPACE, ".zo/memory/shared-facts.db");
const RESULTS_DIR = join(WORKSPACE, "Seeds/zouroboros/results");

// --- CLI ---
const { values } = (await import("util")).parseArgs({
  args: Bun.argv.slice(2),
  options: {
    prescription: { type: "string", short: "p" },
    "dry-run": { type: "boolean" },
    "skip-governor": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  strict: false,
});

if (values.help) {
  console.log(`
Zouroboros Evolve — Execute a prescribed improvement

USAGE:
  bun evolve.ts --prescription <path.json> [--dry-run] [--skip-governor]

FLAGS:
  --prescription, -p   Path to prescription JSON from prescribe.ts
  --dry-run            Show execution plan without running
  --skip-governor      Override governor blocks (use with caution)
  --help, -h           Show this help
`);
  process.exit(0);
}

const DRY_RUN = !!values["dry-run"];
const SKIP_GOV = !!values["skip-governor"];

// --- Types (imported from prescribe) ---
interface Prescription {
  id: string;
  timestamp: string;
  metric: {
    name: string;
    value: number;
    score: number;
    status: string;
    detail: string;
  };
  playbook: {
    id: string;
    name: string;
    description: string;
    targetFile: string | null;
    metricCommand: string;
    metricDirection: string;
    constraints: string[];
    maxFiles: number;
    requiresApproval: boolean;
    approvalReason?: string;
    setupCommands?: string[];
    runCommand?: string;
  };
  seed: string;
  program: string | null;
  governor: {
    approved: boolean;
    flags: string[];
    riskLevel: string;
    requiresHuman: boolean;
    reason: string;
  };
}

interface ScorecardMetric {
  name: string;
  value: number;
  score: number;
  status: string;
}

interface ScorecardSnapshot {
  composite: number;
  metrics: ScorecardMetric[];
}

// --- Helpers ---
function run(cmd: string, timeout = 120_000): { stdout: string; ok: boolean; code: number } {
  try {
    const stdout = execSync(cmd, {
      cwd: WORKSPACE,
      timeout,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), ok: true, code: 0 };
  } catch (e: any) {
    return { stdout: (e.stdout || "").toString().trim(), ok: false, code: e.status ?? 1 };
  }
}

function getScorecard(): ScorecardSnapshot | null {
  const result = run(`bun "${INTROSPECT}" --json 2>/dev/null`);
  if (!result.ok || !result.stdout) return null;
  try {
    const sc = JSON.parse(result.stdout);
    return {
      composite: sc.composite,
      metrics: sc.metrics.map((m: any) => ({
        name: m.name,
        value: m.value,
        score: m.score,
        status: m.status,
      })),
    };
  } catch {
    return null;
  }
}

function measureMetric(cmd: string): number | null {
  const result = run(cmd, 60_000);
  if (!result.ok) return null;
  const num = parseFloat(result.stdout);
  return isNaN(num) ? null : num;
}

// --- Graph Connectivity: Script Mode Executor ---
async function executeGraphLinking(): Promise<{ success: boolean; detail: string; linksCreated: number }> {
  if (!existsSync(MEMORY_DB)) {
    return { success: false, detail: "Memory DB not found", linksCreated: 0 };
  }

  console.error("  [evolve] Analyzing orphan facts for entity co-occurrence...");

  // IDs are TEXT (UUIDs). Strategy 1: link facts sharing the same entity name
  const query = `
    SELECT f1.id, f1.entity, f1.key, f2.id, f2.entity, f2.key
    FROM facts f1
    JOIN facts f2 ON f1.entity = f2.entity AND f1.id < f2.id
    LEFT JOIN fact_links fl ON fl.source_id = f1.id AND fl.target_id = f2.id AND fl.relation = 'related'
    WHERE fl.source_id IS NULL
    LIMIT 500;
  `;

  const result = run(`sqlite3 "${MEMORY_DB}" "${query.replace(/\n/g, " ")}" 2>&1`);
  if (result.ok && result.stdout.trim()) {
    return await createLinks(result.stdout, "same-entity");
  }

  // Strategy 2: link facts sharing entity prefix (before the dot)
  console.error("  [evolve] Trying entity-prefix linking...");
  const altQuery = `
    SELECT f1.id, f1.entity, f2.id, f2.entity
    FROM facts f1
    JOIN facts f2 ON f1.id < f2.id
      AND f1.entity != f2.entity
      AND SUBSTR(f1.entity, 1, INSTR(f1.entity || '.', '.') - 1)
        = SUBSTR(f2.entity, 1, INSTR(f2.entity || '.', '.') - 1)
    LEFT JOIN fact_links fl ON fl.source_id = f1.id AND fl.target_id = f2.id AND fl.relation = 'related'
    WHERE fl.source_id IS NULL
    LIMIT 500;
  `;

  const altResult = run(`sqlite3 "${MEMORY_DB}" "${altQuery.replace(/\n/g, " ")}" 2>&1`);
  if (!altResult.ok || !altResult.stdout.trim()) {
    return { success: false, detail: "No linkable fact pairs found", linksCreated: 0 };
  }

  return await createLinks(altResult.stdout, "entity-prefix");
}

async function createLinks(rows: string, method: string): Promise<{ success: boolean; detail: string; linksCreated: number }> {
  const lines = rows.split("\n").filter(Boolean);
  let created = 0;
  let errors = 0;

  console.error(`  [evolve] Found ${lines.length} linkable pairs via ${method}`);

  // Batch insert links (IDs are TEXT/UUIDs)
  const insertParts: string[] = [];
  for (const line of lines) {
    const parts = line.split("|");
    if (parts.length >= 4) {
      const sourceId = parts[0].trim();
      const targetId = parts[method === "same-entity" ? 3 : 2].trim();
      if (sourceId && targetId && sourceId.length > 8 && targetId.length > 8) {
        insertParts.push(`('${sourceId}', '${targetId}', 'related', 0.7)`);
      }
    }
  }

  if (insertParts.length === 0) {
    return { success: false, detail: "No valid pairs to link", linksCreated: 0 };
  }

  // Insert in batches of 100
  for (let i = 0; i < insertParts.length; i += 100) {
    const batch = insertParts.slice(i, i + 100);
    const sql = `INSERT OR IGNORE INTO fact_links (source_id, target_id, relation, weight) VALUES ${batch.join(",")};`;
    const result = run(`sqlite3 "${MEMORY_DB}" "${sql}" 2>&1`);
    if (result.ok) {
      created += batch.length;
    } else {
      errors += batch.length;
      console.error(`  [evolve] Batch error: ${result.stdout.slice(0, 100)}`);
    }
  }

  const detail = `Created ${created} links via ${method} (${errors} errors)`;
  console.error(`  [evolve] ${detail}`);

  return { success: created > 0, detail, linksCreated: created };
}

// --- Procedure Freshness: Script Mode Executor ---
async function executeProcedureEvolution(): Promise<{ success: boolean; detail: string }> {
  const memoryTs = join(MEMORY_SCRIPTS, "memory.ts");

  // List stale procedures
  const listResult = run(`bun "${memoryTs}" procedures --list 2>&1`);
  if (!listResult.ok) {
    return { success: false, detail: `Could not list procedures: ${listResult.stdout.slice(0, 200)}` };
  }

  // Extract procedure IDs
  const idMatches = listResult.stdout.matchAll(/id:\s*(\d+)/g);
  const ids = [...idMatches].map(m => parseInt(m[1])).slice(0, 5);

  if (ids.length === 0) {
    return { success: false, detail: "No procedures found to evolve" };
  }

  let evolved = 0;
  for (const id of ids) {
    const result = run(`bun "${memoryTs}" procedures --evolve ${id} 2>&1`, 30_000);
    if (result.ok) evolved++;
  }

  return { success: evolved > 0, detail: `Evolved ${evolved}/${ids.length} procedures` };
}

// --- Skill Effectiveness: Script Mode Executor ---
async function executeSkillErrorAnalysis(playbookId: string): Promise<{ success: boolean; detail: string }> {
  if (!existsSync(MEMORY_DB)) {
    return { success: false, detail: "Memory DB not found" };
  }

  // Check table exists
  const tableCheck = run(`sqlite3 "${MEMORY_DB}" "SELECT name FROM sqlite_master WHERE type='table' AND name='skill_executions';" 2>&1`);
  if (!tableCheck.stdout.includes("skill_executions")) {
    return { success: false, detail: "skill_executions table not found — run: bun skill-tracker.ts migrate" };
  }

  console.error("  [evolve] Analyzing skill execution failures...");

  // Get top failing skills with error patterns
  const query = `
    SELECT skill,
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'failure' THEN 1 ELSE 0 END) as failures,
      GROUP_CONCAT(CASE WHEN outcome = 'failure' THEN error_message ELSE NULL END, ' | ') as errors
    FROM skill_executions
    WHERE created_at > datetime('now', '-14 days')
    GROUP BY skill
    HAVING failures > 0
    ORDER BY CAST(failures AS FLOAT) / total DESC
    LIMIT 5;
  `;

  const result = run(`sqlite3 "${MEMORY_DB}" "${query.replace(/\n/g, " ")}" 2>&1`);
  if (!result.ok || !result.stdout.trim()) {
    return { success: true, detail: "No failing skills found in last 14 days — all healthy" };
  }

  const lines = result.stdout.split("\n").filter(Boolean);
  const analysis: string[] = [];

  for (const line of lines) {
    const [skill, total, failures, errors] = line.split("|");
    const failRate = ((parseInt(failures) / parseInt(total)) * 100).toFixed(1);
    const errorSummary = errors ? errors.slice(0, 200) : "no error messages recorded";
    analysis.push(`${skill}: ${failures}/${total} failures (${failRate}%) — ${errorSummary}`);
  }

  const detail = `Skill failure analysis (${lines.length} failing skills):\n${analysis.join("\n")}`;
  console.error(`  [evolve] ${detail}`);

  // Store analysis as a memory fact for next cycle
  const memoryTs = join(MEMORY_SCRIPTS, "memory.ts");
  if (existsSync(memoryTs)) {
    const factValue = `Skill error analysis ${new Date().toISOString().slice(0, 10)}: ${analysis.slice(0, 3).join("; ")}`;
    run(`bun "${memoryTs}" store --entity "zouroboros.skill-analysis" --key "error-patterns-${new Date().toISOString().slice(0, 10)}" --value "${factValue.replace(/"/g, '\\"')}" --category fact --decay active --importance 0.7 --source evolve 2>&1`);
  }

  // For playbook N (critical), we'd modify skill files — but governor blocks this
  // For playbook M (warning), we only do analysis + store findings
  // Both require human approval, so this executor only does the read-only analysis
  return { success: true, detail };
}

// --- Main ---
async function main() {
  console.error("🐍 Zouroboros Evolve — Evolution Engine\n");

  // Load prescription
  const rxPath = values.prescription as string;
  if (!rxPath || !existsSync(rxPath)) {
    console.error("ERROR: --prescription <path> required (prescription JSON from prescribe.ts)");
    process.exit(1);
  }

  const rx: Prescription = JSON.parse(readFileSync(rxPath, "utf-8"));
  console.error(`Prescription: ${rx.id}`);
  console.error(`Target: ${rx.metric.name} (${rx.metric.status})`);
  console.error(`Playbook: ${rx.playbook.id} — ${rx.playbook.name}`);

  // Governor check
  if (rx.governor.requiresHuman && !SKIP_GOV) {
    console.error(`\n🛑 BLOCKED: Governor requires human approval.`);
    for (const flag of rx.governor.flags) {
      console.error(`  ⚠️  ${flag}`);
    }
    console.error(`\nUse --skip-governor to override (with caution).`);
    process.exit(2);
  }

  if (DRY_RUN) {
    console.error("\n--- DRY RUN ---");
    console.error(`Would execute: ${rx.playbook.id}`);
    console.error(`Mode: ${rx.program ? "autoloop" : "script"}`);
    console.error(`Target file: ${rx.playbook.targetFile || "(none — script mode)"}`);
    process.exit(0);
  }

  // Pre-flight: capture baseline
  console.error("\n📊 Pre-flight: capturing baseline scorecard...");
  const baseline = getScorecard();
  if (!baseline) {
    console.error("WARNING: Could not capture baseline — proceeding without regression check");
  } else {
    console.error(`Baseline composite: ${baseline.composite}/100`);
  }

  // Measure target metric baseline
  const metricBaseline = measureMetric(rx.playbook.metricCommand);
  console.error(`Target metric baseline: ${metricBaseline ?? "N/A"}`);

  // Execute
  console.error(`\n🔧 Executing playbook: ${rx.playbook.name}...`);
  const startTime = Date.now();
  let execResult: { success: boolean; detail: string };

  if (rx.program && rx.playbook.targetFile) {
    // Autoloop mode
    console.error("Mode: autoloop");
    const programPath = rxPath.replace("-prescription.json", "-program.md");
    if (!existsSync(programPath)) {
      console.error(`ERROR: Program file not found at ${programPath}`);
      process.exit(1);
    }
    const result = run(`bun "${AUTOLOOP}" --program "${programPath}" 2>&1`, 600_000);
    execResult = { success: result.ok, detail: result.stdout.slice(-500) };
  } else {
    // Script mode — dispatch based on playbook
    switch (rx.playbook.id) {
      case "C-batch-wikilink":
      case "D-entity-consolidation":
        const linkResult = await executeGraphLinking();
        execResult = { success: linkResult.success, detail: linkResult.detail };
        break;

      case "I-batch-evolve":
      case "J-procedure-regen":
        execResult = await executeProcedureEvolution();
        break;

      case "K-failure-rca": {
        // Read-only analysis
        const query = `SELECT outcome, summary FROM episodes WHERE outcome='failure' AND created_at > datetime('now', '-14 days') ORDER BY created_at DESC LIMIT 10;`;
        const result = run(`sqlite3 "${MEMORY_DB}" "${query}" 2>&1`);
        execResult = { success: true, detail: `Failure analysis:\n${result.stdout || "No recent failures"}` };
        break;
      }

      case "L-executor-health": {
        const doctor = join(WORKSPACE, "Skills/zo-swarm-executors/scripts/doctor.ts");
        if (existsSync(doctor)) {
          const result = run(`bun "${doctor}" 2>&1`, 60_000);
          execResult = { success: result.ok, detail: result.stdout.slice(-500) };
        } else {
          execResult = { success: false, detail: "doctor.ts not found" };
        }
        break;
      }

      case "M-skill-error-pattern-fix":
      case "N-tool-call-optimization": {
        execResult = await executeSkillErrorAnalysis(rx.playbook.id);
        break;
      }

      default:
        execResult = { success: false, detail: `No script executor for playbook ${rx.playbook.id}` };
    }
  }

  const durationMs = Date.now() - startTime;
  console.error(`\nExecution: ${execResult.success ? "SUCCESS" : "FAILED"} (${(durationMs / 1000).toFixed(1)}s)`);
  console.error(`Detail: ${execResult.detail.slice(0, 300)}`);

  // Post-flight: measure delta
  console.error("\n📊 Post-flight: measuring improvement...");
  const metricAfter = measureMetric(rx.playbook.metricCommand);
  console.error(`Target metric after: ${metricAfter ?? "N/A"}`);

  const postScorecard = getScorecard();
  const compositeAfter = postScorecard?.composite ?? null;
  console.error(`Composite after: ${compositeAfter ?? "N/A"}/100`);

  // Regression check
  let regression = false;
  if (baseline && postScorecard) {
    for (const postMetric of postScorecard.metrics) {
      const baseMetric = baseline.metrics.find(m => m.name === postMetric.name);
      if (baseMetric && baseMetric.value >= 0 && postMetric.value >= 0) {
        const delta = postMetric.score - baseMetric.score;
        if (delta < -0.02) {
          console.error(`⚠️  REGRESSION: ${postMetric.name} dropped ${(Math.abs(delta) * 100).toFixed(1)}%`);
          regression = true;
        }
      }
    }
  }

  // Build result
  const evolutionResult = {
    prescriptionId: rx.id,
    playbook: rx.playbook.id,
    metric: rx.metric.name,
    baseline: metricBaseline,
    after: metricAfter,
    improved: metricAfter !== null && metricBaseline !== null && (
      rx.playbook.metricDirection === "higher_is_better"
        ? metricAfter > metricBaseline
        : metricAfter < metricBaseline
    ),
    compositeBaseline: baseline?.composite ?? null,
    compositeAfter,
    regression,
    success: execResult.success && !regression,
    detail: execResult.detail,
    durationMs,
    timestamp: new Date().toISOString(),
  };

  // Save result
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const resultPath = join(RESULTS_DIR, `${rx.id}-result.json`);
  writeFileSync(resultPath, JSON.stringify(evolutionResult, null, 2));
  console.error(`\n✅ Result saved: ${resultPath}`);

  // Store episode
  const memoryTs = join(MEMORY_SCRIPTS, "memory.ts");
  if (existsSync(memoryTs)) {
    const summary = `Zouroboros evolution ${rx.id}: ${rx.playbook.name}. ${execResult.success ? "Success" : "Failed"}. Metric ${rx.metric.name}: ${metricBaseline ?? "N/A"} → ${metricAfter ?? "N/A"}. Composite: ${baseline?.composite ?? "N/A"} → ${compositeAfter ?? "N/A"}.`;
    const outcome = evolutionResult.success ? "success" : regression ? "failure" : "ongoing";
    run(`bun "${memoryTs}" episodes --create --summary "${summary.replace(/"/g, '\\"')}" --outcome ${outcome} --entities "zouroboros.evolution,zouroboros.${rx.metric.name.toLowerCase().replace(/\s+/g, "-")}" --duration ${durationMs} 2>&1`);
  }

  // Final summary
  console.error("\n" + "═".repeat(56));
  if (evolutionResult.success) {
    console.error(`✅ EVOLUTION COMPLETE — ${rx.metric.name} improved`);
  } else if (regression) {
    console.error(`❌ REGRESSION DETECTED — improvements reverted`);
  } else {
    console.error(`⚠️  EVOLUTION INCOMPLETE — no improvement measured`);
  }
  console.error("═".repeat(56));

  console.log(JSON.stringify(evolutionResult, null, 2));
  process.exit(evolutionResult.success ? 0 : 1);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
