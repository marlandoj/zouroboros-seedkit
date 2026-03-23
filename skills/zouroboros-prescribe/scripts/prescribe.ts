#!/usr/bin/env bun
/**
 * Zouroboros Prescribe — Self-prescription engine
 *
 * Takes an introspection scorecard (or runs one live), identifies the weakest
 * subsystem, maps it to a known improvement playbook, and generates:
 *   1. A seed YAML (spec-first format)
 *   2. A program.md (autoloop format) for autonomous optimization
 *   3. A governor report flagging risks
 *
 * Usage: bun prescribe.ts [--scorecard <path>] [--live] [--target <metric>] [--output <dir>] [--dry-run]
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { randomUUID } from "crypto";

const WORKSPACE = "/home/workspace";
const INTROSPECT = join(WORKSPACE, "Skills/zouroboros-introspect/scripts/introspect.ts");
const MEMORY_SCRIPTS = join(WORKSPACE, "Skills/zo-memory-system/scripts");
const MEMORY_DB = join(WORKSPACE, ".zo/memory/shared-facts.db");
const DEFAULT_OUTPUT = join(WORKSPACE, "Seeds/zouroboros");

// --- CLI ---
const { values } = (await import("util")).parseArgs({
  args: Bun.argv.slice(2),
  options: {
    scorecard: { type: "string", short: "s" },
    live: { type: "boolean" },
    target: { type: "string", short: "t" },
    output: { type: "string", short: "o", default: DEFAULT_OUTPUT },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  strict: false,
});

if (values.help) {
  console.log(`
Zouroboros Prescribe — Self-prescription engine

USAGE:
  bun prescribe.ts [--scorecard <path>] [--live] [--target <metric>] [--output <dir>] [--dry-run]

FLAGS:
  --scorecard, -s  Path to scorecard JSON from introspect.ts --json
  --live           Run introspect live (default if no --scorecard)
  --target, -t     Override: prescribe for this metric name
  --output, -o     Output dir for artifacts (default: Seeds/zouroboros/)
  --dry-run        Show prescription without writing files
  --help, -h       Show this help
`);
  process.exit(0);
}

const DRY_RUN = !!values["dry-run"];
const OUTPUT_DIR = values.output as string;

// --- Types ---
interface MetricResult {
  name: string;
  value: number;
  target: number;
  critical: number;
  weight: number;
  score: number;
  status: "HEALTHY" | "WARNING" | "CRITICAL";
  trend: string;
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

interface Playbook {
  id: string;
  name: string;
  description: string;
  targetFile: string | null;
  metricCommand: string;
  metricDirection: "higher_is_better" | "lower_is_better";
  constraints: string[];
  maxFiles: number;
  requiresApproval: boolean;
  approvalReason?: string;
  setupCommands?: string[];
  runCommand?: string;
  readOnlyFiles?: string[];
}

interface Prescription {
  id: string;
  timestamp: string;
  metric: MetricResult;
  playbook: Playbook;
  seed: string;
  program: string | null;
  governor: GovernorReport;
}

interface GovernorReport {
  approved: boolean;
  flags: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiresHuman: boolean;
  reason: string;
}

// --- Helpers ---
function run(cmd: string): { stdout: string; ok: boolean } {
  try {
    const stdout = execSync(cmd, {
      cwd: WORKSPACE,
      timeout: 90_000,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), ok: true };
  } catch (e: any) {
    return { stdout: (e.stdout || "").toString().trim(), ok: false };
  }
}

// --- Playbook Registry ---
function getPlaybook(metric: MetricResult): Playbook {
  const isCritical = metric.status === "CRITICAL";
  const name = metric.name;

  switch (name) {
    case "Memory Recall":
      return isCritical
        ? {
            id: "B-graph-boost-weights",
            name: "Graph-Boost Weight Tuning",
            description: "Adjust RRF fusion weights in graph-boost.ts to improve recall",
            targetFile: "Skills/zo-memory-system/scripts/graph-boost.ts",
            metricCommand: `bun ${MEMORY_SCRIPTS}/eval-continuation.ts 2>&1 | grep -oP 'Rate: \\K[\\d.]+'`,
            metricDirection: "higher_is_better",
            constraints: [
              "Weights must sum to 1.0",
              "No single weight > 0.70 or < 0.05",
              "Only modify weight constants, not algorithm logic",
            ],
            maxFiles: 1,
            requiresApproval: false,
            readOnlyFiles: [
              "Skills/zo-memory-system/scripts/eval-continuation.ts",
              "Skills/zo-memory-system/assets/continuation-eval-fixture-set.json",
            ],
          }
        : {
            id: "A-fixture-expansion",
            name: "Continuation Fixture Expansion",
            description: "Add new eval fixtures targeting recall gaps",
            targetFile: "Skills/zo-memory-system/assets/continuation-eval-fixture-set.json",
            metricCommand: `bun ${MEMORY_SCRIPTS}/eval-continuation.ts 2>&1 | grep -oP 'Rate: \\K[\\d.]+'`,
            metricDirection: "higher_is_better",
            constraints: [
              "Only add fixtures, never remove existing ones",
              "Max 10 new fixtures per cycle",
              "Fixtures must test real continuation scenarios from recent conversations",
            ],
            maxFiles: 1,
            requiresApproval: false,
            readOnlyFiles: ["Skills/zo-memory-system/scripts/eval-continuation.ts"],
          };

    case "Graph Connectivity":
      return isCritical
        ? {
            id: "D-entity-consolidation",
            name: "Entity Consolidation & Hub Linking",
            description: "Merge duplicate entities and create hub nodes to connect orphan clusters",
            targetFile: null,
            metricCommand: `bun ${MEMORY_SCRIPTS}/graph.ts knowledge-gaps 2>&1 | grep -oP 'Linked facts: \\d+ \\(\\K[\\d.]+'`,
            metricDirection: "higher_is_better",
            constraints: [
              "Only create links with weight >= 0.5",
              "Never delete existing links or facts",
              "Max 500 links per cycle",
              "Log all operations to stdout",
            ],
            maxFiles: 1,
            requiresApproval: false,
            setupCommands: [
              `bun ${MEMORY_SCRIPTS}/graph.ts knowledge-gaps > /tmp/z-gaps.txt 2>&1`,
            ],
            runCommand: `bun /tmp/z-graph-linker.ts 2>&1`,
          }
        : {
            id: "C-batch-wikilink",
            name: "Batch Wikilink Extraction",
            description: "Scan orphan facts for entity co-occurrence and auto-generate graph links",
            targetFile: null,
            metricCommand: `bun ${MEMORY_SCRIPTS}/graph.ts knowledge-gaps 2>&1 | grep -oP 'Linked facts: \\d+ \\(\\K[\\d.]+'`,
            metricDirection: "higher_is_better",
            constraints: [
              "Only create links with weight >= 0.5",
              "Never delete existing links",
              "Max 500 links per cycle",
            ],
            maxFiles: 1,
            requiresApproval: false,
          };

    case "Routing Accuracy":
      return isCritical
        ? {
            id: "F-capability-keywords",
            name: "Capability Keyword Expansion",
            description: "Add domain keywords to executor capability profiles",
            targetFile: "Skills/zo-swarm-executors/registry/executor-registry.json",
            metricCommand: `sqlite3 "${MEMORY_DB}" "SELECT CAST(SUM(CASE WHEN outcome IN ('success','resolved') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 FROM episodes WHERE created_at > datetime('now', '-14 days');"`,
            metricDirection: "higher_is_better",
            constraints: [
              "Only add keywords, never remove",
              "Max 10 keywords per executor per cycle",
            ],
            maxFiles: 1,
            requiresApproval: true,
            approvalReason: "Executor registry changes affect all swarm routing",
          }
        : {
            id: "E-signal-weight-adjust",
            name: "Signal Weight Adjustment",
            description: "Tune 6-signal composite weights based on episode outcomes",
            targetFile: "Skills/zo-swarm-orchestrator/config.json",
            metricCommand: `sqlite3 "${MEMORY_DB}" "SELECT CAST(SUM(CASE WHEN outcome IN ('success','resolved') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 FROM episodes WHERE created_at > datetime('now', '-14 days');"`,
            metricDirection: "higher_is_better",
            constraints: [
              "No single signal weight > 0.40 or < 0.05",
              "Total must sum to 1.0",
              "Changes <= ±0.05 per signal per cycle",
            ],
            maxFiles: 1,
            requiresApproval: false,
          };

    case "Eval Calibration":
      return isCritical
        ? {
            id: "H-semantic-fixture",
            name: "Semantic Fixture Addition",
            description: "Add eval fixtures from recent false positives/negatives",
            targetFile: null,
            metricCommand: "echo 0",
            metricDirection: "lower_is_better",
            constraints: ["Only add fixtures, never modify eval logic"],
            maxFiles: 2,
            requiresApproval: true,
            approvalReason: "Eval logic changes affect all future evaluations",
          }
        : {
            id: "G-drift-threshold",
            name: "Drift Threshold Adjustment",
            description: "Adjust the drift threshold that triggers Stage 3 consensus",
            targetFile: "Skills/three-stage-eval/scripts/evaluate.ts",
            metricCommand: "echo 0",
            metricDirection: "lower_is_better",
            constraints: [
              "Drift threshold must stay between 0.1 and 0.5",
              "Changes <= ±0.05 per cycle",
            ],
            maxFiles: 1,
            requiresApproval: false,
          };

    case "Procedure Freshness":
      return isCritical
        ? {
            id: "J-procedure-regen",
            name: "Procedure Regeneration",
            description: "Auto-generate new procedures from recent successful episodes",
            targetFile: null,
            metricCommand: `sqlite3 "${MEMORY_DB}" "SELECT CAST(SUM(CASE WHEN updated_at < datetime('now','-14 days') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 FROM procedures;"`,
            metricDirection: "lower_is_better",
            constraints: [
              "Only generate from episodes with outcome=success",
              "Max 3 new procedures per cycle",
            ],
            maxFiles: 0,
            requiresApproval: false,
          }
        : {
            id: "I-batch-evolve",
            name: "Batch Procedure Evolution",
            description: "Trigger Ollama-powered evolution on stale procedures",
            targetFile: null,
            metricCommand: `sqlite3 "${MEMORY_DB}" "SELECT CAST(SUM(CASE WHEN updated_at < datetime('now','-14 days') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 FROM procedures;"`,
            metricDirection: "lower_is_better",
            constraints: [
              "Evolve max 5 procedures per cycle",
              "Archive (don't delete) procedures with 0 success over 30 days",
            ],
            maxFiles: 0,
            requiresApproval: false,
          };

    case "Episode Velocity":
      return isCritical
        ? {
            id: "L-executor-health",
            name: "Executor Health Check",
            description: "Run doctor.ts on all executors, identify and remediate failures",
            targetFile: null,
            metricCommand: `sqlite3 "${MEMORY_DB}" "SELECT CAST(SUM(CASE WHEN outcome='success' AND created_at > datetime('now','-7 days') THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(SUM(CASE WHEN created_at > datetime('now','-7 days') THEN 1 ELSE 0 END), 0) * 100 FROM episodes;"`,
            metricDirection: "higher_is_better",
            constraints: ["Read-only diagnostics first", "Restart only confirmed-broken executors"],
            maxFiles: 0,
            requiresApproval: true,
            approvalReason: "Executor restarts affect running tasks",
          }
        : {
            id: "K-failure-rca",
            name: "Failure Root-Cause Analysis",
            description: "Analyze recent failure episodes to identify top cause",
            targetFile: null,
            metricCommand: "echo 0",
            metricDirection: "higher_is_better",
            constraints: ["Read-only analysis", "No mutations", "Output feeds next introspection"],
            maxFiles: 0,
            requiresApproval: false,
          };

    case "Skill Effectiveness":
      return isCritical
        ? {
            id: "N-tool-call-optimization",
            name: "Tool Call Optimization",
            description: "Analyze failing tool calls and fix argument patterns, timeout handling, or error recovery",
            targetFile: null,
            metricCommand: `sqlite3 "${MEMORY_DB}" "SELECT CAST(SUM(CASE WHEN outcome='success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 FROM skill_executions WHERE created_at > datetime('now', '-14 days');"`,
            metricDirection: "higher_is_better",
            constraints: [
              "Only modify error handling and argument validation",
              "Never change core skill logic without approval",
              "Max 2 skills fixed per cycle",
            ],
            maxFiles: 2,
            requiresApproval: true,
            approvalReason: "Modifying skill scripts affects live system behavior",
          }
        : {
            id: "M-skill-error-pattern-fix",
            name: "Skill Error Pattern Fix",
            description: "Identify top error patterns in skill executions and generate targeted fixes",
            targetFile: null,
            metricCommand: `sqlite3 "${MEMORY_DB}" "SELECT CAST(SUM(CASE WHEN outcome='success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 FROM skill_executions WHERE created_at > datetime('now', '-14 days');"`,
            metricDirection: "higher_is_better",
            constraints: [
              "Read-only analysis first, then targeted fixes",
              "Only fix error handling and input validation",
              "Max 1 skill file modified per cycle",
            ],
            maxFiles: 1,
            requiresApproval: true,
            approvalReason: "Skill code modifications require human review",
          };

    default:
      return {
        id: "X-unknown",
        name: "Unknown Metric",
        description: `No playbook for metric: ${name}`,
        targetFile: null,
        metricCommand: "echo 0",
        metricDirection: "higher_is_better",
        constraints: [],
        maxFiles: 0,
        requiresApproval: true,
        approvalReason: "No known playbook — requires manual prescription",
      };
  }
}

// --- Governor ---
function runGovernor(metric: MetricResult, playbook: Playbook): GovernorReport {
  const flags: string[] = [];

  // Check: requires human approval
  if (playbook.requiresApproval) {
    flags.push(`APPROVAL_REQUIRED: ${playbook.approvalReason}`);
  }

  // Check: no baseline data
  if (metric.value < 0) {
    flags.push("NO_BASELINE: Metric has no data — prescription may be premature");
  }

  // Check: touches too many files
  if (playbook.maxFiles > 3) {
    flags.push(`HIGH_BLAST_RADIUS: Playbook touches up to ${playbook.maxFiles} files`);
  }

  // Check: schema/migration risk
  if (playbook.targetFile && /migrat|schema|\.sql/i.test(playbook.targetFile)) {
    flags.push("SCHEMA_RISK: Target file appears to be a migration or schema file");
  }

  // Check: executor/routing risk
  if (playbook.targetFile && /executor|registry|bridge/i.test(playbook.targetFile)) {
    flags.push("EXECUTOR_RISK: Changes to executor configuration affect all routing");
  }

  // Determine risk level
  const requiresHuman = playbook.requiresApproval || metric.value < 0 || flags.length > 1;
  const riskLevel: GovernorReport["riskLevel"] =
    flags.length === 0 ? "LOW" :
    requiresHuman ? "HIGH" : "MEDIUM";

  const approved = !requiresHuman && flags.length === 0;

  return {
    approved,
    flags,
    riskLevel,
    requiresHuman,
    reason: approved
      ? "All governor checks passed — safe for autonomous execution"
      : `${flags.length} flag(s) raised — ${requiresHuman ? "REQUIRES HUMAN APPROVAL" : "proceed with caution"}`,
  };
}

// --- Seed Generator ---
function generateSeed(metric: MetricResult, playbook: Playbook): string {
  const id = `seed-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  return `# Seed Specification — Zouroboros Self-Prescription
# Generated: ${now}
# ID: ${id}
# Source: zouroboros-prescribe (automated)
# Playbook: ${playbook.id}

id: "${id}"
created: "${now}"
status: prescribed

goal: "Improve ${metric.name} from ${metric.value >= 0 ? (metric.value * 100).toFixed(1) + "%" : "N/A"} toward target ${(metric.target * 100).toFixed(1)}% using playbook ${playbook.name}"

constraints:
${playbook.constraints.map(c => `  - "${c}"`).join("\n")}
  - "All changes must be on a git branch (autoloop pattern)"
  - "Revert on any regression in the target metric"

acceptance_criteria:
  - "Target metric improves by at least 5% from baseline"
  - "No other metrics regress by more than 2%"
  - "All changes pass mechanical verification (tsc, lint, test)"
${metric.value >= 0 ? `  - "${metric.name} reaches at least ${(Math.min(metric.target, metric.value + (metric.target - metric.value) * 0.5) * 100).toFixed(1)}% (halfway to target)"` : `  - "Baseline data is established for ${metric.name}"`}

ontology:
  name: "zouroboros-self-improvement"
  description: "Autonomous improvement of the ${metric.name} subsystem"
  fields:
    - name: metric_name
      type: string
      description: "${metric.name}"
    - name: baseline
      type: number
      description: "${metric.value >= 0 ? (metric.value * 100).toFixed(1) : "N/A"}"
    - name: target
      type: number
      description: "${(metric.target * 100).toFixed(1)}"
    - name: playbook
      type: string
      description: "${playbook.id}"

evaluation_principles:
  - name: metric_improvement
    description: "Did the target metric improve?"
    weight: 0.5
  - name: no_regression
    description: "Did any other metrics regress?"
    weight: 0.3
  - name: minimal_change
    description: "Was the change minimal and reversible?"
    weight: 0.2

exit_conditions:
  - name: target_reached
    description: "Metric reaches target threshold"
    criteria: "${metric.name} >= ${(metric.target * 100).toFixed(1)}%"
  - name: max_experiments
    description: "Safety limit on optimization attempts"
    criteria: "10 experiments without improvement"
  - name: regression_detected
    description: "Another metric significantly degraded"
    criteria: "Any metric drops > 2% from baseline"
`;
}

// --- Program.md Generator ---
function generateProgram(metric: MetricResult, playbook: Playbook): string | null {
  if (!playbook.targetFile) {
    return null; // No target file = not suitable for autoloop
  }

  const name = `zouroboros-${playbook.id}`;

  return `# Program: ${name}

## Objective
Improve ${metric.name} from ${metric.value >= 0 ? (metric.value * 100).toFixed(1) + "%" : "baseline"} toward ${(metric.target * 100).toFixed(1)}% by optimizing ${basename(playbook.targetFile)}.

## Metric
- **name**: ${metric.name.toLowerCase().replace(/\s+/g, "_")}
- **direction**: ${playbook.metricDirection}
- **extract**: \`${playbook.metricCommand}\`

## Setup
${playbook.setupCommands ? playbook.setupCommands.map(c => "```bash\n" + c + "\n```").join("\n") : "No setup required."}

## Target File
${playbook.targetFile}

## Run Command
${playbook.runCommand
    ? "```bash\n" + playbook.runCommand + "\n```"
    : "```bash\n# Run the metric extraction command to measure current state\n" + playbook.metricCommand + "\n```"}

## Read-Only Files
${playbook.readOnlyFiles ? playbook.readOnlyFiles.map(f => `- ${f}`).join("\n") : "- (none specified)"}

## Constraints
- **Time budget per run**: 2 minutes
- **Max experiments**: 10
- **Max duration**: 2 hours
- **Max cost (USD)**: 5.00

## Simplicity Criterion
All else being equal, simpler is better. Prefer tuning existing parameters over adding new logic.
Removing unnecessary complexity while maintaining or improving the metric is ideal.

## Stagnation
- **Threshold**: 5 experiments with no improvement triggers radical exploration
- **Double threshold**: 8 experiments combines best past approaches
- **Triple threshold**: 10 experiments auto-stops with summary report

## Notes
Playbook constraints:
${playbook.constraints.map(c => `- ${c}`).join("\n")}

Current metric detail: ${metric.detail}
Recommendation: ${metric.recommendation}
`;
}

// --- Main ---
async function main() {
  console.error("🐍 Zouroboros Prescribe — Self-Prescription Engine\n");

  // Step 1: Get scorecard
  let scorecard: Scorecard;

  if (values.scorecard && existsSync(values.scorecard as string)) {
    console.error(`Reading scorecard from ${values.scorecard}`);
    scorecard = JSON.parse(readFileSync(values.scorecard as string, "utf-8"));
  } else {
    console.error("Running live introspection...");
    const result = run(`bun "${INTROSPECT}" --json 2>/dev/null`);
    if (!result.stdout) {
      console.error("ERROR: Introspection returned no output");
      process.exit(1);
    }
    try {
      scorecard = JSON.parse(result.stdout);
    } catch {
      console.error(`ERROR: Could not parse introspection output:\n${result.stdout.slice(0, 300)}`);
      process.exit(1);
    }
  }

  console.error(`Scorecard: composite ${scorecard.composite}/100, weakest: ${scorecard.weakest}\n`);

  // Step 2: Select target metric
  let targetMetric: MetricResult;
  if (values.target) {
    const found = scorecard.metrics.find(
      m => m.name.toLowerCase() === (values.target as string).toLowerCase()
    );
    if (!found) {
      console.error(`ERROR: Metric "${values.target}" not found. Available: ${scorecard.metrics.map(m => m.name).join(", ")}`);
      process.exit(1);
    }
    targetMetric = found;
  } else {
    // Pick weakest non-healthy metric
    const candidates = scorecard.metrics
      .filter(m => m.status !== "HEALTHY")
      .sort((a, b) => a.score - b.score || b.weight - a.weight);

    if (candidates.length === 0) {
      console.error("All metrics are HEALTHY — nothing to prescribe.");
      console.log(JSON.stringify({ status: "healthy", composite: scorecard.composite }));
      process.exit(0);
    }
    targetMetric = candidates[0];
  }

  console.error(`Target: ${targetMetric.name} (${targetMetric.status}, score: ${(targetMetric.score * 100).toFixed(0)}%)`);

  // Step 3: Select playbook
  const playbook = getPlaybook(targetMetric);
  console.error(`Playbook: ${playbook.id} — ${playbook.name}`);

  // Step 4: Run governor
  const governor = runGovernor(targetMetric, playbook);
  console.error(`Governor: ${governor.riskLevel} risk — ${governor.reason}`);
  if (governor.flags.length > 0) {
    for (const flag of governor.flags) {
      console.error(`  ⚠️  ${flag}`);
    }
  }

  // Step 5: Generate artifacts
  const seed = generateSeed(targetMetric, playbook);
  const program = generateProgram(targetMetric, playbook);

  const prescription: Prescription = {
    id: `rx-${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    metric: targetMetric,
    playbook,
    seed,
    program,
    governor,
  };

  // Step 6: Output
  if (DRY_RUN) {
    console.error("\n--- DRY RUN — would generate: ---\n");
    console.error(`Seed YAML (${seed.split("\n").length} lines)`);
    if (program) console.error(`Program.md (${program.split("\n").length} lines)`);
    console.error(`Governor: ${governor.approved ? "AUTO-APPROVED" : "NEEDS HUMAN APPROVAL"}`);
    console.log(JSON.stringify(prescription, null, 2));
  } else {
    // Write artifacts
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

    const seedPath = join(OUTPUT_DIR, `${prescription.id}-seed.yaml`);
    writeFileSync(seedPath, seed);
    console.error(`\n✅ Seed: ${seedPath}`);

    if (program) {
      const progPath = join(OUTPUT_DIR, `${prescription.id}-program.md`);
      writeFileSync(progPath, program);
      console.error(`✅ Program: ${progPath}`);
    }

    const rxPath = join(OUTPUT_DIR, `${prescription.id}-prescription.json`);
    writeFileSync(rxPath, JSON.stringify(prescription, null, 2));
    console.error(`✅ Prescription: ${rxPath}`);

    // Governor summary
    if (governor.requiresHuman) {
      console.error(`\n🛑 GOVERNOR: This prescription requires your approval before execution.`);
      console.error(`   Flags: ${governor.flags.join("; ")}`);
      console.error(`   Review the seed at: ${seedPath}`);
    } else {
      console.error(`\n✅ GOVERNOR: Auto-approved for autonomous execution.`);
    }

    // Store to memory
    await storeEpisode(prescription);

    // Print summary to stdout
    console.log(JSON.stringify({
      id: prescription.id,
      metric: targetMetric.name,
      playbook: playbook.id,
      governor: governor.approved ? "auto-approved" : "needs-approval",
      riskLevel: governor.riskLevel,
      seedPath,
      programPath: program ? join(OUTPUT_DIR, `${prescription.id}-program.md`) : null,
    }));
  }
}

async function storeEpisode(rx: Prescription) {
  const memoryScript = join(MEMORY_SCRIPTS, "memory.ts");
  if (!existsSync(memoryScript)) return;

  const summary = `Zouroboros prescription ${rx.id}: ${rx.playbook.name} for ${rx.metric.name} (${rx.metric.status}, score ${(rx.metric.score * 100).toFixed(0)}%). Governor: ${rx.governor.approved ? "auto-approved" : "needs human approval"}.`;

  const cmd = [
    `bun "${memoryScript}" episodes --create`,
    `--summary "${summary.replace(/"/g, '\\"')}"`,
    `--outcome ongoing`,
    `--entities "zouroboros.prescription,zouroboros.${rx.metric.name.toLowerCase().replace(/\s+/g, "-")}"`,
    `--duration 0`,
  ].join(" ");

  run(cmd);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
