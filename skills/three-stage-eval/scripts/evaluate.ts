#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, extname } from "path";
import { randomUUID } from "crypto";
import { execSync } from "child_process";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seed: { type: "string", short: "s" },
    artifact: { type: "string", short: "a" },
    stage: { type: "string" },
    "force-consensus": { type: "boolean", default: false },
    output: { type: "string", short: "o" },
    help: { type: "boolean", short: "h" },
  },
  strict: false,
});

function printHelp() {
  console.log(`
three-stage-eval — Progressive verification pipeline

USAGE:
  bun evaluate.ts --seed <seed.yaml> --artifact <path/>

OPTIONS:
  --seed, -s           Path to seed specification YAML
  --artifact, -a       Path to artifact directory or file to evaluate
  --stage              Run only this stage (1, 2, or 3)
  --force-consensus    Force Stage 3 consensus even if not triggered
  --output, -o         Output directory for evaluation report (default: artifact dir)
  --help, -h           Show this help

EXAMPLES:
  bun evaluate.ts --seed seed.yaml --artifact ./src/
  bun evaluate.ts --seed seed.yaml --artifact ./src/ --stage 1
  bun evaluate.ts --seed seed.yaml --artifact ./src/ --force-consensus
`);
}

interface MechanicalCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface SeedSpec {
  id?: string;
  goal?: string;
  constraints?: string[];
  acceptance_criteria?: string[];
  evaluation_principles?: Array<{ name: string; description: string; weight: number }>;
}

function parseSeed(seedPath: string): SeedSpec {
  const content = readFileSync(seedPath, "utf-8");
  const spec: SeedSpec = {};

  const goalMatch = content.match(/^goal:\s*"?(.+?)"?\s*$/m);
  if (goalMatch) spec.goal = goalMatch[1];

  spec.constraints = [];
  const constraintMatches = content.matchAll(/^\s*-\s*"?(.+?)"?\s*$/gm);
  let inConstraints = false;
  let inAC = false;
  const lines = content.split("\n");

  for (const line of lines) {
    if (line.match(/^constraints:/)) { inConstraints = true; inAC = false; continue; }
    if (line.match(/^acceptance_criteria:/)) { inAC = true; inConstraints = false; continue; }
    if (line.match(/^[a-z_]+:/) && !line.startsWith("  ")) { inConstraints = false; inAC = false; continue; }

    const itemMatch = line.match(/^\s+-\s+"?(.+?)"?\s*$/);
    if (itemMatch) {
      if (inConstraints) spec.constraints!.push(itemMatch[1]);
      if (inAC) {
        if (!spec.acceptance_criteria) spec.acceptance_criteria = [];
        spec.acceptance_criteria.push(itemMatch[1]);
      }
    }
  }

  return spec;
}

function runMechanicalChecks(artifactPath: string): MechanicalCheck[] {
  const checks: MechanicalCheck[] = [];

  const hasPackageJson = existsSync(join(artifactPath, "package.json"));
  const hasTsConfig = existsSync(join(artifactPath, "tsconfig.json"));
  const hasPyFiles = (() => {
    try {
      const result = execSync(`find "${artifactPath}" -name "*.py" -maxdepth 3 | head -1`, { encoding: "utf-8" });
      return result.trim().length > 0;
    } catch { return false; }
  })();

  // TypeScript checks
  if (hasTsConfig) {
    try {
      execSync(`cd "${artifactPath}" && npx tsc --noEmit 2>&1`, { encoding: "utf-8", timeout: 30000 });
      checks.push({ name: "TypeScript compile", passed: true, detail: "No type errors" });
    } catch (e: any) {
      const output = e.stdout || e.message || "Unknown error";
      const errorLines = output.split("\n").filter((l: string) => l.includes("error TS")).slice(0, 5);
      checks.push({ name: "TypeScript compile", passed: false, detail: errorLines.join("; ") || "Compilation failed" });
    }
  }

  // Lint check
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(join(artifactPath, "package.json"), "utf-8"));
      if (pkg.scripts?.lint) {
        execSync(`cd "${artifactPath}" && npm run lint 2>&1`, { encoding: "utf-8", timeout: 30000 });
        checks.push({ name: "Lint", passed: true, detail: "No lint errors" });
      }
    } catch (e: any) {
      const output = (e.stdout || "").split("\n").slice(-5).join("; ");
      checks.push({ name: "Lint", passed: false, detail: output || "Lint failed" });
    }
  }

  // Test check
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(join(artifactPath, "package.json"), "utf-8"));
      if (pkg.scripts?.test) {
        const result = execSync(`cd "${artifactPath}" && npm test 2>&1`, { encoding: "utf-8", timeout: 60000 });
        const passMatch = result.match(/(\d+)\s*(?:tests?\s*)?pass/i);
        checks.push({ name: "Tests", passed: true, detail: passMatch ? `${passMatch[1]} passing` : "All tests passed" });
      }
    } catch (e: any) {
      const output = (e.stdout || "").split("\n").slice(-5).join("; ");
      checks.push({ name: "Tests", passed: false, detail: output || "Tests failed" });
    }
  }

  // Python checks
  if (hasPyFiles) {
    try {
      execSync(`cd "${artifactPath}" && python3 -m py_compile $(find . -name "*.py" -maxdepth 3 | head -10 | tr '\\n' ' ') 2>&1`, { encoding: "utf-8", timeout: 15000 });
      checks.push({ name: "Python syntax", passed: true, detail: "No syntax errors" });
    } catch (e: any) {
      checks.push({ name: "Python syntax", passed: false, detail: (e.stderr || e.message || "").slice(0, 200) });
    }
  }

  // File existence check (always run)
  try {
    const fileCount = execSync(`find "${artifactPath}" -type f | wc -l`, { encoding: "utf-8" }).trim();
    checks.push({ name: "Files exist", passed: parseInt(fileCount) > 0, detail: `${fileCount} files found` });
  } catch {
    checks.push({ name: "Files exist", passed: false, detail: "Could not count files" });
  }

  return checks;
}

function formatReport(
  artifactPath: string,
  seedSpec: SeedSpec,
  mechanicalChecks: MechanicalCheck[],
  stageLimit?: number,
  forceConsensus?: boolean
): string {
  const now = new Date().toISOString();
  const evalId = `eval-${randomUUID().slice(0, 8)}`;
  const lines: string[] = [];

  lines.push("Evaluation Report");
  lines.push("=================");
  lines.push(`ID: ${evalId}`);
  lines.push(`Artifact: ${artifactPath}`);
  lines.push(`Seed: ${seedSpec.id || "inline"}`);
  lines.push(`Date: ${now}`);
  lines.push("");

  // Stage 1
  lines.push("Stage 1: Mechanical Verification");
  let stage1Passed = true;
  for (const check of mechanicalChecks) {
    const status = check.passed ? "PASS" : "FAIL";
    lines.push(`  [${status}] ${check.name}: ${check.detail}`);
    if (!check.passed) stage1Passed = false;
  }
  lines.push(`Result: ${stage1Passed ? "PASSED" : "FAILED"}`);
  lines.push("");

  if (!stage1Passed) {
    lines.push("⛔ Stage 1 FAILED — fix mechanical issues before proceeding to semantic evaluation.");
    lines.push("");
    lines.push(`Final Decision: NEEDS WORK`);
    return lines.join("\n");
  }

  if (stageLimit && parseInt(stageLimit as any) === 1) {
    lines.push("(Stage 2 and 3 skipped — --stage 1 specified)");
    return lines.join("\n");
  }

  // Stage 2 — semantic (template for LLM to fill)
  lines.push("Stage 2: Semantic Evaluation");
  if (seedSpec.acceptance_criteria && seedSpec.acceptance_criteria.length > 0) {
    lines.push("AC Compliance:");
    for (const ac of seedSpec.acceptance_criteria) {
      lines.push(`  [ ] ${ac}`);
    }
    lines.push("");
    lines.push("  AC Compliance: __% (run with LLM to evaluate)");
    lines.push("  Goal Alignment: __.__ / 1.00");
    lines.push("  Drift Score: __.__ / 1.00");
    lines.push("  Overall Score: __.__ / 1.00");
    lines.push("  Result: PENDING (requires LLM evaluation)");
  } else {
    lines.push("  No acceptance criteria found in seed. Define criteria to enable semantic evaluation.");
    lines.push("  Result: SKIPPED");
  }
  lines.push("");

  // Stage 3
  if (forceConsensus) {
    lines.push("Stage 3: Consensus (forced)");
    lines.push("  Proposer: PENDING");
    lines.push("  Devil's Advocate: PENDING");
    lines.push("  Synthesizer: PENDING");
    lines.push("  Result: PENDING (requires multi-perspective LLM evaluation)");
  } else {
    lines.push("Stage 3: Not triggered");
    lines.push("  (Triggers: drift > 0.3, score 0.7-0.8, or --force-consensus)");
  }
  lines.push("");

  lines.push("Final Decision: PENDING SEMANTIC EVALUATION");
  lines.push("");
  lines.push("To complete Stage 2, ask Zo to evaluate each acceptance criterion against the artifact.");

  return lines.join("\n");
}

// Main
if (values.help) {
  printHelp();
  process.exit(0);
}

if (!values.artifact) {
  console.error("Error: --artifact is required. Use --help for usage.");
  process.exit(1);
}

const artifactPath = values.artifact as string;
if (!existsSync(artifactPath)) {
  console.error(`Error: Artifact path not found: ${artifactPath}`);
  process.exit(1);
}

let seedSpec: SeedSpec = {};
if (values.seed) {
  if (!existsSync(values.seed as string)) {
    console.error(`Error: Seed file not found: ${values.seed}`);
    process.exit(1);
  }
  seedSpec = parseSeed(values.seed as string);
}

console.log("Running mechanical checks...\n");
const checks = runMechanicalChecks(artifactPath);

const report = formatReport(
  artifactPath,
  seedSpec,
  checks,
  values.stage as any,
  values["force-consensus"] as boolean
);

console.log(report);

// Save report
const outputDir = (values.output as string) || join(artifactPath, "evaluations");
if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
const reportPath = join(outputDir, `eval-${Date.now()}.txt`);
writeFileSync(reportPath, report);
console.log(`\nReport saved to: ${reportPath}`);
