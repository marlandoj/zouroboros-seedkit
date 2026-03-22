#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, resolve } from "path";
import { randomUUID } from "crypto";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    topic: { type: "string", short: "t" },
    request: { type: "string", short: "r" },
    from: { type: "string", short: "f" },
    output: { type: "string", short: "o", default: "." },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: false,
});

const subcommand = positionals[0] || "interview";

// --- Seed Registry ---

const REGISTRY_PATH = resolve("/home/workspace/seeds/registry.json");
const SEEDS_DIR = resolve("/home/workspace/seeds");

interface SeedRegistryEntry {
  id: string;
  file: string;
  created: string;
  status: "draft" | "active" | "completed" | "superseded";
  goal_summary: string;
  tags: string[];
  evaluations: Array<{ eval_id: string; date: string; stage2_score: number; stage3_verdict: string | null }>;
  last_evaluated: string | null;
}

interface SeedRegistry {
  version: number;
  seeds: SeedRegistryEntry[];
}

function loadRegistry(): SeedRegistry {
  if (existsSync(REGISTRY_PATH)) {
    try {
      return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
    } catch {
      return { version: 1, seeds: [] };
    }
  }
  return { version: 1, seeds: [] };
}

function saveRegistry(registry: SeedRegistry): void {
  const dir = join(REGISTRY_PATH, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
}

function parseSeedIdAndGoal(filePath: string): { id: string; goal: string; status: string; created: string } | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const idMatch = content.match(/^id:\s*"?([^\s"]+)"?\s*$/m);
    const statusMatch = content.match(/^status:\s*"?([^\s"]+)"?\s*$/m);
    const createdMatch = content.match(/^created:\s*"?([^\s"]+)"?\s*$/m);

    // Goal: handle block scalar (>) and inline
    let goal = "";
    const goalBlockMatch = content.match(/^goal:\s*>\s*\n((?:\s{2,}.+\n?)+)/m);
    if (goalBlockMatch) {
      goal = goalBlockMatch[1].replace(/^\s+/gm, "").replace(/\n/g, " ").trim();
    } else {
      const goalMatch = content.match(/^goal:\s*"?(.+?)"?\s*$/m);
      if (goalMatch) goal = goalMatch[1];
    }

    if (!idMatch) return null;
    return {
      id: idMatch[1],
      goal: goal.slice(0, 120),
      status: statusMatch?.[1] || "draft",
      created: createdMatch?.[1] || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function registerSeed(seedPath: string): SeedRegistryEntry | null {
  const parsed = parseSeedIdAndGoal(seedPath);
  if (!parsed) {
    console.error(`Could not parse seed ID from: ${seedPath}`);
    return null;
  }

  const registry = loadRegistry();

  // Check if already registered
  const existing = registry.seeds.find(s => s.id === parsed.id);
  if (existing) {
    // Update goal/status if changed
    existing.goal_summary = parsed.goal;
    existing.status = parsed.status as any;
    saveRegistry(registry);
    return existing;
  }

  const relPath = seedPath.startsWith(SEEDS_DIR)
    ? seedPath.slice(SEEDS_DIR.length + 1)
    : seedPath;

  const entry: SeedRegistryEntry = {
    id: parsed.id,
    file: relPath.startsWith("/") ? relPath : relPath,
    created: parsed.created,
    status: parsed.status as any,
    goal_summary: parsed.goal,
    tags: extractTags(parsed.id, parsed.goal),
    evaluations: [],
    last_evaluated: null,
  };

  registry.seeds.push(entry);
  saveRegistry(registry);
  return entry;
}

function extractTags(id: string, goal: string): string[] {
  const tags: string[] = [];
  const combined = `${id} ${goal}`.toLowerCase();
  const tagKeywords: Record<string, string[]> = {
    memory: ["memory", "wikilink", "fact", "episode", "procedure"],
    eval: ["eval", "evaluation", "stage", "consensus"],
    swarm: ["swarm", "orchestrat", "routing", "executor"],
    integration: ["integration", "wire", "closed-loop"],
    enforcement: ["enforcement", "enforce", "auto-correct", "validation"],
    intelligence: ["intelligence", "stagnation", "streaming", "capture"],
  };
  for (const [tag, keywords] of Object.entries(tagKeywords)) {
    if (keywords.some(kw => combined.includes(kw))) tags.push(tag);
  }
  return tags;
}

function backfillRegistry(): number {
  if (!existsSync(SEEDS_DIR)) return 0;
  const files = readdirSync(SEEDS_DIR).filter(f => f.match(/^seed-.*\.ya?ml$/));
  let count = 0;
  for (const file of files) {
    const fullPath = join(SEEDS_DIR, file);
    const result = registerSeed(fullPath);
    if (result) count++;
  }
  return count;
}

function printHelp() {
  console.log(`
spec-first-interview — Socratic interview & seed specification generator

USAGE:
  bun interview.ts [subcommand] [options]

SUBCOMMANDS:
  interview   Start or display interview prompts (default)
  seed        Generate a seed YAML from interview notes
  score       Score ambiguity of a request
  list        List all registered seeds from the registry

OPTIONS:
  --topic, -t     Topic for interview (e.g., "Build a webhook retry system")
  --request, -r   Request text to score ambiguity
  --from, -f      Path to interview notes markdown file (for seed generation)
  --output, -o    Output directory for generated files (default: current dir)
  --help, -h      Show this help

EXAMPLES:
  bun interview.ts --topic "Build a webhook retry system"
  bun interview.ts seed --from ./interview-notes.md
  bun interview.ts score --request "Make the site faster"
  bun interview.ts list
`);
}

function scoreAmbiguity(request: string): {
  goal: number;
  constraints: number;
  success: number;
  ambiguity: number;
  assessment: string;
} {
  let goal = 0;
  let constraints = 0;
  let success = 0;

  const words = request.toLowerCase().split(/\s+/);
  const len = words.length;

  // Goal clarity signals
  const goalSignals = ["build", "create", "implement", "add", "fix", "migrate", "refactor", "deploy", "integrate"];
  const hasVerb = goalSignals.some((s) => words.includes(s));
  const hasObject = len > 2;
  const hasSpecificity = len > 6;
  goal = (hasVerb ? 0.3 : 0) + (hasObject ? 0.3 : 0.1) + (hasSpecificity ? 0.4 : 0.1);

  // Constraint signals
  const constraintWords = ["must", "should", "only", "without", "using", "in", "with", "no", "cannot", "limit"];
  const constraintCount = constraintWords.filter((w) => words.includes(w)).length;
  constraints = Math.min(1.0, constraintCount * 0.25);

  // Success criteria signals
  const successWords = ["when", "so that", "passes", "returns", "displays", "sends", "saves", "validates"];
  const successCount = successWords.filter((w) => request.toLowerCase().includes(w)).length;
  success = Math.min(1.0, successCount * 0.3);

  // Vagueness penalties
  const vagueWords = ["better", "faster", "improve", "optimize", "fix", "update", "change", "nice", "good"];
  const vagueCount = vagueWords.filter((w) => words.includes(w)).length;
  const vaguePenalty = vagueCount * 0.15;

  goal = Math.max(0, Math.min(1, goal - vaguePenalty * 0.5));
  constraints = Math.max(0, Math.min(1, constraints));
  success = Math.max(0, Math.min(1, success));

  const ambiguity = +(1 - (goal * 0.4 + constraints * 0.3 + success * 0.3)).toFixed(2);

  let assessment: string;
  if (ambiguity <= 0.2) {
    assessment = "READY — Ambiguity is low enough to proceed to seed generation.";
  } else if (ambiguity <= 0.5) {
    assessment = "NEEDS CLARIFICATION — Run a Socratic interview to fill gaps.";
  } else {
    assessment = "HIGH AMBIGUITY — Significant interview required before any implementation.";
  }

  return { goal: +goal.toFixed(2), constraints: +constraints.toFixed(2), success: +success.toFixed(2), ambiguity, assessment };
}

function generateSeedTemplate(topic: string, notesPath?: string): string {
  const id = `seed-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  let notes = "";
  if (notesPath && existsSync(notesPath)) {
    notes = readFileSync(notesPath, "utf-8");
  }

  return `# Seed Specification
# Generated: ${now}
# ID: ${id}
# Source: ${notesPath || "interview session"}

id: "${id}"
created: "${now}"
status: draft

goal: "${topic || "TODO: Define the primary objective"}"

constraints:
  - "TODO: Add hard constraints from interview"

acceptance_criteria:
  - "TODO: Add measurable success criteria"

ontology:
  name: "TODO"
  description: "TODO: Describe the domain model"
  fields:
    - name: id
      type: string
      description: "Unique identifier"

evaluation_principles:
  - name: correctness
    description: "Does it do what was asked?"
    weight: 0.4
  - name: completeness
    description: "Are all acceptance criteria met?"
    weight: 0.3
  - name: quality
    description: "Is the implementation sound?"
    weight: 0.3

exit_conditions:
  - name: all_ac_met
    description: "All acceptance criteria satisfied"
    criteria: "AC compliance = 100%"

# Interview Notes
# ${notes ? "See source file for full notes" : "No notes file provided — fill in from interview session"}
`;
}

function printInterviewPrompt(topic: string) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              SPEC-FIRST SOCRATIC INTERVIEW                  ║
╚══════════════════════════════════════════════════════════════╝

Topic: ${topic}

To conduct this interview, switch to a persona that reads and follows:
  Skills/spec-first-interview/references/socratic-interviewer.md

The interviewer will:
  1. Ask 5-8 focused questions targeting ambiguity
  2. Score goal clarity (40%), constraint clarity (30%), success criteria (30%)
  3. Pass when ambiguity ≤ 0.2 (80% clarity)
  4. Generate a seed spec via the Seed Architect role

Interview Dimensions:
  • Goal clarity     — What exactly should this do and for whom?
  • Constraint clarity — What boundaries, limits, or requirements exist?
  • Success criteria  — How will we know it's done correctly?

Ontological Probes:
  • "What IS this, really?"
  • "Root cause or symptom?"
  • "What are we assuming?"
  • "What must exist first?"

Start the interview by asking Zo:
  "Run the spec-first-interview skill for: ${topic}"
`);
}

// Main
if (values.help) {
  printHelp();
  process.exit(0);
}

switch (subcommand) {
  case "interview": {
    const topic = values.topic || positionals.slice(1).join(" ") || "unspecified topic";
    printInterviewPrompt(topic);
    break;
  }

  case "seed": {
    const topic = values.topic || "Untitled";
    const from = values.from as string | undefined;
    const output = (values.output as string) || ".";

    const seedYaml = generateSeedTemplate(topic, from);
    const filename = `seed-${Date.now()}.yaml`;
    const outPath = join(output, filename);

    if (!existsSync(output)) mkdirSync(output, { recursive: true });
    writeFileSync(outPath, seedYaml);
    console.log(`Seed template written to: ${outPath}`);
    console.log("Edit the TODO fields with actual requirements from your interview.");

    // Auto-register in seed registry
    const registered = registerSeed(resolve(outPath));
    if (registered) {
      console.log(`Registered in seed registry: ${registered.id}`);
    }
    break;
  }

  case "list": {
    // Backfill on first run to pick up existing seed-*.yaml files
    const backfilled = backfillRegistry();
    if (backfilled > 0) {
      console.log(`Backfilled ${backfilled} seed(s) into registry.\n`);
    }

    const registry = loadRegistry();
    if (registry.seeds.length === 0) {
      console.log("No seeds registered. Generate one with: bun interview.ts seed --topic \"...\"");
      break;
    }

    console.log(`\nSeed Registry (${registry.seeds.length} seeds)\n${"─".repeat(60)}`);
    for (const seed of registry.seeds) {
      const evalCount = seed.evaluations.length;
      const lastEval = seed.last_evaluated ? ` | last eval: ${seed.last_evaluated.slice(0, 10)}` : "";
      console.log(`  ${seed.status.padEnd(10)} ${seed.id}`);
      console.log(`             ${seed.goal_summary.slice(0, 80)}`);
      console.log(`             tags: [${seed.tags.join(", ")}] | evals: ${evalCount}${lastEval}`);
      console.log();
    }
    break;
  }

  case "score": {
    const request = values.request || positionals.slice(1).join(" ");
    if (!request) {
      console.error("Error: --request or positional text required for scoring.");
      process.exit(1);
    }

    const result = scoreAmbiguity(request);
    console.log(`
Ambiguity Score
===============
Request: "${request}"

  Goal clarity:       ${result.goal} / 1.00  (weight: 40%)
  Constraint clarity: ${result.constraints} / 1.00  (weight: 30%)
  Success criteria:   ${result.success} / 1.00  (weight: 30%)

  Ambiguity:          ${result.ambiguity} / 1.00  (threshold: ≤ 0.20)

Assessment: ${result.assessment}
`);
    break;
  }

  default:
    console.error(`Unknown subcommand: ${subcommand}`);
    printHelp();
    process.exit(1);
}
