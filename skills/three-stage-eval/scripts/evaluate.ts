#!/usr/bin/env bun
import { parseArgs } from "util";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, extname, relative, dirname, resolve, basename } from "path";
import { randomUUID } from "crypto";
import { execSync } from "child_process";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EVAL_MODEL = process.env.ZO_EVAL_MODEL || "qwen2.5:7b";
const AC_TIMEOUT_MS = 60_000;
const GOAL_TIMEOUT_MS = 120_000;
const CONSENSUS_TIMEOUT_MS = 90_000;
const MAX_ARTIFACT_CHARS = 12_000;
const ARTIFACT_EXTENSIONS = new Set([".ts", ".js", ".py", ".md", ".tsx", ".jsx"]);
const MAX_ARTIFACT_DEPTH = 3;

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    seed: { type: "string", short: "s" },
    artifact: { type: "string", short: "a" },
    stage: { type: "string" },
    "force-consensus": { type: "boolean", default: false },
    "seeds-dir": { type: "string", default: "/home/workspace/seeds" },
    "strict-imports": { type: "boolean", default: false },
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
  --seeds-dir          Directory containing sibling seed specs (default: /home/workspace/seeds)
  --strict-imports     Treat import-based dependencies as hard gate (default: warn only)
  --output, -o         Output directory for evaluation report (default: artifact dir)
  --help, -h           Show this help

EXAMPLES:
  bun evaluate.ts --seed seed.yaml --artifact ./src/
  bun evaluate.ts --seed seed.yaml --artifact ./src/ --stage 1
  bun evaluate.ts --seed seed.yaml --artifact ./src/ --force-consensus
`);
}

// --- Types ---

interface MechanicalCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface SeedSpec {
  id?: string;
  goal?: string;
  status?: string;
  constraints?: string[];
  acceptance_criteria?: string[];
  evaluation_principles?: Array<{ name: string; description: string; weight: number }>;
  implementation_files?: string[];  // Flattened list of files from implementation_order[].files
}

// --- Import Analysis Types ---

interface ImportInfo {
  source_file: string;
  module_path: string;
  resolved_path: string | null;
  symbols: string[];
  import_type: "named" | "default" | "namespace" | "side_effect" | "require";
}

// --- Dependency DAG Types ---

interface DependencyEdge {
  from_seed: string;
  to_seed: string;
  reason: "file_collision" | "import_dependency";
  shared_files: string[];
  imported_symbols?: string[];
  resolved: boolean;
}

interface DependencyDAG {
  edges: DependencyEdge[];
  topological_order: string[];
  cycle: string[] | null;
}

interface DependencyCheckResult {
  scanned_seeds: number;
  dag: DependencyDAG;
  unresolved_count: number;
  import_warn_count: number;
  status: "PASS" | "BLOCKED" | "CYCLE_ERROR" | "WARN";
  message: string;
}

type ACVerdict = "PASS" | "PARTIAL" | "FAIL" | "INCONCLUSIVE" | "SKIPPED";

interface ACResult {
  criterion: string;
  verdict: ACVerdict;
  justification: string;
}

interface SemanticEvalResult {
  ac_results: ACResult[];
  ac_compliance: number;
  goal_alignment: number;
  drift: number;
  overall: number;
  status: "COMPLETED" | "SKIPPED";
}

interface ConsensusResult {
  proposer: string;
  devils_advocate: string;
  synthesizer_verdict: "ACCEPT" | "REVISE" | "REJECT" | "INCONCLUSIVE";
  synthesizer_confidence: number;
  revision_items: string[];
  rationale: string;
  status: "COMPLETED" | "SKIPPED" | "NOT_TRIGGERED";
}

// --- Seed Parser ---

function parseSeed(seedPath: string): SeedSpec {
  const content = readFileSync(seedPath, "utf-8");
  const spec: SeedSpec = {};

  // Extract id
  const idMatch = content.match(/^id:\s*"?([^\s"]+)"?\s*$/m);
  if (idMatch) spec.id = idMatch[1];

  // Extract status
  const statusMatch = content.match(/^status:\s*"?([^\s"]+)"?\s*$/m);
  if (statusMatch) spec.status = statusMatch[1];

  // Extract goal (handles multi-line YAML block scalar with >)
  const goalBlockMatch = content.match(/^goal:\s*>\s*\n((?:\s{2,}.+\n?)+)/m);
  if (goalBlockMatch) {
    spec.goal = goalBlockMatch[1].replace(/^\s+/gm, "").replace(/\n/g, " ").trim();
  } else {
    const goalMatch = content.match(/^goal:\s*"?(.+?)"?\s*$/m);
    if (goalMatch) spec.goal = goalMatch[1];
  }

  spec.constraints = [];
  let inConstraints = false;
  let inAC = false;
  let inEvalPrinciples = false;
  const evalPrinciples: Array<{ name: string; description: string; weight: number }> = [];
  let currentPrinciple: Partial<{ name: string; description: string; weight: number }> = {};

  for (const line of content.split("\n")) {
    if (line.match(/^constraints:/)) { inConstraints = true; inAC = false; inEvalPrinciples = false; continue; }
    if (line.match(/^acceptance_criteria:/)) { inAC = true; inConstraints = false; inEvalPrinciples = false; continue; }
    if (line.match(/^evaluation_principles:/)) { inEvalPrinciples = true; inConstraints = false; inAC = false; continue; }
    if (line.match(/^[a-z_]+:/) && !line.startsWith("  ")) { inConstraints = false; inAC = false; inEvalPrinciples = false; continue; }

    const itemMatch = line.match(/^\s+-\s+"?(.+?)"?\s*$/);
    if (itemMatch) {
      if (inConstraints) spec.constraints!.push(itemMatch[1]);
      if (inAC) {
        if (!spec.acceptance_criteria) spec.acceptance_criteria = [];
        spec.acceptance_criteria.push(itemMatch[1]);
      }
    }

    // Parse evaluation principles
    if (inEvalPrinciples) {
      const nameMatch = line.match(/^\s+name:\s*"?(.+?)"?\s*$/);
      const descMatch = line.match(/^\s+description:\s*"?(.+?)"?\s*$/);
      const weightMatch = line.match(/^\s+weight:\s*([0-9.]+)/);
      if (nameMatch) {
        if (currentPrinciple.name) evalPrinciples.push(currentPrinciple as any);
        currentPrinciple = { name: nameMatch[1] };
      }
      if (descMatch) currentPrinciple.description = descMatch[1];
      if (weightMatch) currentPrinciple.weight = parseFloat(weightMatch[1]);
    }
  }
  if (currentPrinciple.name) evalPrinciples.push(currentPrinciple as any);
  if (evalPrinciples.length > 0) spec.evaluation_principles = evalPrinciples;

  // Extract implementation_order[].files (flattened)
  const implFiles: string[] = [];
  const fileLineRegex = /^\s+-\s+"?([^"]+\.\w+)"?\s*$/;
  let inImplOrder = false;
  let inFiles = false;
  for (const line of content.split("\n")) {
    if (line.match(/^implementation_order:/)) { inImplOrder = true; continue; }
    if (inImplOrder && line.match(/^[a-z_]+:/) && !line.startsWith(" ")) { inImplOrder = false; continue; }
    if (inImplOrder) {
      if (line.match(/^\s+files:/)) { inFiles = true; continue; }
      if (line.match(/^\s+tasks:/) || line.match(/^\s+-\s+phase:/)) { inFiles = false; continue; }
      if (inFiles) {
        const fMatch = line.match(fileLineRegex);
        if (fMatch) implFiles.push(fMatch[1]);
      }
    }
  }
  if (implFiles.length > 0) spec.implementation_files = [...new Set(implFiles)];

  return spec;
}

// --- Artifact Reader ---

function readArtifactFiles(artifactPath: string): string {
  const chunks: string[] = [];
  let totalChars = 0;

  function walk(dir: string, depth: number) {
    if (depth > MAX_ARTIFACT_DEPTH || totalChars >= MAX_ARTIFACT_CHARS) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch { return; }

    for (const entry of entries) {
      if (totalChars >= MAX_ARTIFACT_CHARS) break;
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (ARTIFACT_EXTENSIONS.has(extname(entry).toLowerCase())) {
          const relPath = relative(artifactPath, fullPath);
          const content = readFileSync(fullPath, "utf-8");
          const remaining = MAX_ARTIFACT_CHARS - totalChars;
          const slice = content.slice(0, remaining);
          chunks.push(`--- ${relPath} ---\n${slice}\n`);
          totalChars += slice.length + relPath.length + 10;
        }
      } catch { /* skip unreadable files */ }
    }
  }

  walk(artifactPath, 0);
  return chunks.join("\n");
}

// --- Ollama Helpers ---

async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return false;
    const data: any = await resp.json();
    return data.models?.some((m: any) =>
      m.name === EVAL_MODEL || m.name.startsWith(EVAL_MODEL + ":")
    );
  } catch {
    return false;
  }
}

async function ollamaGenerate(prompt: string, timeoutMs: number): Promise<string> {
  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EVAL_MODEL,
      prompt,
      stream: false,
      keep_alive: "24h",
      options: {
        temperature: 0.2,
        num_predict: 2000,
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status} ${await resp.text()}`);
  }
  const data: any = await resp.json();
  return (data.response || "").trim();
}

function extractJSON(raw: string): any {
  // Try parsing as-is first
  try { return JSON.parse(raw); } catch {}
  // Extract JSON object or array from markdown code blocks or mixed text
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch {}
  }
  return null;
}

// --- Dependency DAG: Cross-Seed Dependency Check ---

function normalizeFilePath(filePath: string): string {
  // Extract basename for comparison
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

function scanSiblingSeeds(seedsDir: string, excludeId?: string): SeedSpec[] {
  if (!existsSync(seedsDir)) return [];
  const siblings: SeedSpec[] = [];
  try {
    const files = readdirSync(seedsDir).filter(f => f.match(/\.ya?ml$/));
    for (const file of files) {
      try {
        const spec = parseSeed(join(seedsDir, file));
        if (!spec.id) continue;
        if (spec.id === excludeId) continue;
        if (spec.status && spec.status !== "active" && spec.status !== "draft") continue;
        if (!spec.implementation_files || spec.implementation_files.length === 0) continue;
        siblings.push(spec);
      } catch { /* skip malformed seeds */ }
    }
  } catch { /* directory unreadable */ }
  return siblings;
}

// --- Import Analysis: Seed 2 — Semantic Import Detection ---

const IMPORT_EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];

function resolveImportPath(importPath: string, fromFile: string): string | null {
  // Skip bare specifiers (no ./ or ../ or / prefix)
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return null;

  const baseDir = dirname(fromFile);
  const resolved = resolve(baseDir, importPath);

  // If path already has an extension and exists, return it
  if (extname(resolved) && existsSync(resolved)) return resolved;

  // Try with extensions
  for (const ext of IMPORT_EXTENSIONS) {
    const withExt = resolved + ext;
    if (existsSync(withExt)) return withExt;
  }

  // Try index files (import from directory)
  for (const ext of IMPORT_EXTENSIONS) {
    const indexFile = join(resolved, `index${ext}`);
    if (existsSync(indexFile)) return indexFile;
  }

  // If has extension but doesn't exist, return normalized path anyway (for matching)
  if (extname(resolved)) return resolved;

  // Default: return with .ts extension for matching purposes
  return resolved + ".ts";
}

function extractImports(filePath: string): ImportInfo[] {
  if (!existsSync(filePath)) return [];

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const imports: ImportInfo[] = [];

  // Named imports: import { foo, bar } from "./module"
  const namedRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = namedRe.exec(content)) !== null) {
    const symbols = match[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    imports.push({
      source_file: filePath,
      module_path: match[2],
      resolved_path: resolveImportPath(match[2], filePath),
      symbols,
      import_type: "named",
    });
  }

  // Default imports: import foo from "./module"
  const defaultRe = /import\s+([a-zA-Z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
  while ((match = defaultRe.exec(content)) !== null) {
    // Skip if already captured as named (import { ... } from)
    const line = content.substring(Math.max(0, match.index - 1), match.index + match[0].length);
    if (line.includes("{")) continue;
    imports.push({
      source_file: filePath,
      module_path: match[2],
      resolved_path: resolveImportPath(match[2], filePath),
      symbols: [match[1]],
      import_type: "default",
    });
  }

  // Namespace imports: import * as ns from "./module"
  const nsRe = /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
  while ((match = nsRe.exec(content)) !== null) {
    imports.push({
      source_file: filePath,
      module_path: match[2],
      resolved_path: resolveImportPath(match[2], filePath),
      symbols: [],
      import_type: "namespace",
    });
  }

  // Side-effect imports: import "./module"
  const sideEffectRe = /import\s+['"]([^'"]+)['"]/g;
  while ((match = sideEffectRe.exec(content)) !== null) {
    // Skip if this is part of a from clause (already matched above)
    const before = content.substring(Math.max(0, match.index - 20), match.index);
    if (before.includes("from")) continue;
    imports.push({
      source_file: filePath,
      module_path: match[1],
      resolved_path: resolveImportPath(match[1], filePath),
      symbols: [],
      import_type: "side_effect",
    });
  }

  // Require: const foo = require("./module")
  const requireRe = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRe.exec(content)) !== null) {
    const symbols = match[1]
      ? match[1].split(",").map(s => s.trim().split(/\s*:\s*/)[0].trim()).filter(Boolean)
      : match[2] ? [match[2]] : [];
    imports.push({
      source_file: filePath,
      module_path: match[3],
      resolved_path: resolveImportPath(match[3], filePath),
      symbols,
      import_type: "require",
    });
  }

  // Filter out bare specifiers (resolved_path is null)
  return imports.filter(i => i.resolved_path !== null);
}

function resolveWorkspacePath(filePath: string): string {
  if (filePath.startsWith("/")) return filePath;
  return resolve("/home/workspace", filePath);
}

function buildImportEdges(currentSeed: SeedSpec, siblings: SeedSpec[]): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const currentFiles = currentSeed.implementation_files || [];
  if (currentFiles.length === 0) return edges;

  // Build map: normalized basename → seed ID for all sibling files
  const siblingFileMap = new Map<string, { seedId: string; fullPath: string }>();
  for (const sib of siblings) {
    for (const f of sib.implementation_files || []) {
      siblingFileMap.set(normalizeFilePath(f), { seedId: sib.id || "unknown", fullPath: resolveWorkspacePath(f) });
    }
  }

  if (siblingFileMap.size === 0) return edges;

  // For each file in current seed, extract imports and check if any resolve to sibling files
  const currentConstraints = (currentSeed.constraints || []).join(" ").toLowerCase();
  const edgeMap = new Map<string, { shared: string[]; symbols: string[] }>();

  for (const rawFile of currentFiles) {
    const file = resolveWorkspacePath(rawFile);
    if (!existsSync(file)) continue;
    const imports = extractImports(file);

    for (const imp of imports) {
      if (!imp.resolved_path) continue;
      const resolvedBase = normalizeFilePath(imp.resolved_path);

      const sibMatch = siblingFileMap.get(resolvedBase);
      if (sibMatch) {
        const key = sibMatch.seedId;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { shared: [], symbols: [] });
        }
        const entry = edgeMap.get(key)!;
        const importChain = `${normalizeFilePath(file)} → ${resolvedBase}`;
        if (!entry.shared.includes(importChain)) entry.shared.push(importChain);
        for (const s of imp.symbols) {
          if (!entry.symbols.includes(s)) entry.symbols.push(s);
        }
      }
    }
  }

  // Convert to edges
  for (const [sibId, { shared, symbols }] of edgeMap) {
    const resolved = sibId.length > 0 && currentConstraints.includes(sibId.toLowerCase());
    edges.push({
      from_seed: currentSeed.id || "unknown",
      to_seed: sibId,
      reason: "import_dependency",
      shared_files: shared,
      imported_symbols: symbols.length > 0 ? symbols : undefined,
      resolved,
    });
  }

  return edges;
}

function buildDependencyDAG(currentSeed: SeedSpec, siblings: SeedSpec[]): DependencyDAG {
  const edges: DependencyEdge[] = [];
  const currentFiles = (currentSeed.implementation_files || []).map(normalizeFilePath);
  const currentConstraints = (currentSeed.constraints || []).join(" ").toLowerCase();

  for (const sibling of siblings) {
    const siblingFiles = (sibling.implementation_files || []).map(normalizeFilePath);
    const sharedFiles = currentFiles.filter(f => siblingFiles.includes(f));

    if (sharedFiles.length > 0) {
      // Check if constraint resolves this dependency
      const sibId = sibling.id || "";
      const resolved = sibId.length > 0 && currentConstraints.includes(sibId.toLowerCase());

      edges.push({
        from_seed: currentSeed.id || "unknown",
        to_seed: sibId,
        reason: "file_collision",
        shared_files: sharedFiles,
        resolved,
      });
    }
  }

  // Merge import-based edges (Seed 2: semantic import analysis)
  const importEdges = buildImportEdges(currentSeed, siblings);
  for (const ie of importEdges) {
    // Don't duplicate if a file_collision edge already exists for the same seed pair
    const existingCollision = edges.find(e => e.to_seed === ie.to_seed && e.reason === "file_collision");
    if (!existingCollision) {
      edges.push(ie);
    }
  }

  // Build adjacency list for all seeds involved in edges
  const allSeeds = new Set<string>();
  const adjList = new Map<string, Set<string>>();
  for (const edge of edges) {
    allSeeds.add(edge.from_seed);
    allSeeds.add(edge.to_seed);
    if (!adjList.has(edge.from_seed)) adjList.set(edge.from_seed, new Set());
    adjList.get(edge.from_seed)!.add(edge.to_seed);
  }

  // Check for cycles (DFS)
  const cycle = detectCycle(allSeeds, adjList);
  if (cycle) {
    return { edges, topological_order: [], cycle };
  }

  // Topological sort (Kahn's algorithm)
  const order = topologicalSort(allSeeds, adjList);

  return { edges, topological_order: order, cycle: null };
}

function detectCycle(nodes: Set<string>, adjList: Map<string, Set<string>>): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string>();
  for (const n of nodes) color.set(n, WHITE);

  for (const start of nodes) {
    if (color.get(start) !== WHITE) continue;
    const stack: string[] = [start];
    while (stack.length > 0) {
      const node = stack[stack.length - 1];
      if (color.get(node) === WHITE) {
        color.set(node, GRAY);
        const neighbors = adjList.get(node) || new Set();
        for (const nb of neighbors) {
          if (color.get(nb) === GRAY) {
            // Cycle found — reconstruct path
            const cyclePath = [nb, node];
            let cur = node;
            while (cur !== nb && parent.has(cur)) {
              cur = parent.get(cur)!;
              cyclePath.push(cur);
            }
            return cyclePath.reverse();
          }
          if (color.get(nb) === WHITE) {
            parent.set(nb, node);
            stack.push(nb);
          }
        }
      } else {
        color.set(node, BLACK);
        stack.pop();
      }
    }
  }
  return null;
}

function topologicalSort(nodes: Set<string>, adjList: Map<string, Set<string>>): string[] {
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n, 0);

  for (const [, neighbors] of adjList) {
    for (const nb of neighbors) {
      inDegree.set(nb, (inDegree.get(nb) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [node, deg] of inDegree) {
    if (deg === 0) queue.push(node);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    const neighbors = adjList.get(node) || new Set();
    for (const nb of neighbors) {
      const newDeg = (inDegree.get(nb) || 1) - 1;
      inDegree.set(nb, newDeg);
      if (newDeg === 0) queue.push(nb);
    }
  }

  return result;
}

function runDependencyCheck(seedSpec: SeedSpec, seedsDir: string, strictImports: boolean = false): DependencyCheckResult {
  const emptyDag: DependencyDAG = { edges: [], topological_order: [], cycle: null };

  if (!seedSpec.id) {
    return { scanned_seeds: 0, dag: emptyDag, unresolved_count: 0, import_warn_count: 0, status: "PASS", message: "No seed ID — dependency check skipped" };
  }

  const siblings = scanSiblingSeeds(seedsDir, seedSpec.id);
  if (siblings.length === 0) {
    return { scanned_seeds: 0, dag: emptyDag, unresolved_count: 0, import_warn_count: 0, status: "PASS", message: "No sibling seeds with implementation_order found" };
  }

  const dag = buildDependencyDAG(seedSpec, siblings);

  if (dag.cycle) {
    return {
      scanned_seeds: siblings.length,
      dag,
      unresolved_count: 0,
      import_warn_count: 0,
      status: "CYCLE_ERROR",
      message: `Circular dependency detected: ${dag.cycle.join(" → ")}`,
    };
  }

  const unresolved = dag.edges.filter(e => !e.resolved);
  const unresolvedCollisions = unresolved.filter(e => e.reason === "file_collision");
  const unresolvedImports = unresolved.filter(e => e.reason === "import_dependency");

  // File collisions always block
  if (unresolvedCollisions.length > 0) {
    const details = unresolvedCollisions.map(e =>
      `  ${e.from_seed} ↔ ${e.to_seed} (shared: ${e.shared_files.join(", ")})`
    ).join("\n");
    const resolution = unresolvedCollisions.map(e =>
      `  Add to constraints: "Sequencing: requires ${e.to_seed}"`
    ).join("\n");

    let message = `Unresolved file dependencies:\n${details}\n\nTo resolve:\n${resolution}`;
    if (unresolvedImports.length > 0) {
      const importDetails = unresolvedImports.map(e =>
        `  ${e.from_seed} imports from ${e.to_seed} (${e.shared_files.join(", ")}${e.imported_symbols ? ` [${e.imported_symbols.join(", ")}]` : ""})`
      ).join("\n");
      message += `\n\nImport dependencies (also unresolved):\n${importDetails}`;
    }

    return {
      scanned_seeds: siblings.length,
      dag,
      unresolved_count: unresolvedCollisions.length,
      import_warn_count: unresolvedImports.length,
      status: "BLOCKED",
      message,
    };
  }

  // Import deps: BLOCKED if --strict-imports, else WARN
  if (unresolvedImports.length > 0) {
    const importDetails = unresolvedImports.map(e =>
      `  ${e.from_seed} imports from ${e.to_seed} (${e.shared_files.join(", ")}${e.imported_symbols ? ` [${e.imported_symbols.join(", ")}]` : ""})`
    ).join("\n");
    const resolution = unresolvedImports.map(e =>
      `  Add to constraints: "Sequencing: requires ${e.to_seed}"`
    ).join("\n");

    if (strictImports) {
      return {
        scanned_seeds: siblings.length,
        dag,
        unresolved_count: unresolvedImports.length,
        import_warn_count: 0,
        status: "BLOCKED",
        message: `Unresolved import dependencies (--strict-imports):\n${importDetails}\n\nTo resolve:\n${resolution}`,
      };
    }

    const orderStr = dag.topological_order.length > 0
      ? `Recommended order: ${dag.topological_order.join(" → ")}`
      : "";

    return {
      scanned_seeds: siblings.length,
      dag,
      unresolved_count: 0,
      import_warn_count: unresolvedImports.length,
      status: "WARN",
      message: `Import dependencies detected (non-blocking):\n${importDetails}\n\nTo suppress: add constraint referencing the depended-upon seed ID.\n${orderStr}`,
    };
  }

  const orderStr = dag.topological_order.length > 0
    ? `Recommended order: ${dag.topological_order.join(" → ")}`
    : "";

  return {
    scanned_seeds: siblings.length,
    dag,
    unresolved_count: 0,
    import_warn_count: 0,
    status: "PASS",
    message: `All dependencies resolved (${siblings.length} siblings scanned). ${orderStr}`,
  };
}

// --- Stage 1: Mechanical Checks ---

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

  if (hasPyFiles) {
    try {
      execSync(`cd "${artifactPath}" && python3 -m py_compile $(find . -name "*.py" -maxdepth 3 | head -10 | tr '\\n' ' ') 2>&1`, { encoding: "utf-8", timeout: 15000 });
      checks.push({ name: "Python syntax", passed: true, detail: "No syntax errors" });
    } catch (e: any) {
      checks.push({ name: "Python syntax", passed: false, detail: (e.stderr || e.message || "").slice(0, 200) });
    }
  }

  try {
    const fileCount = execSync(`find "${artifactPath}" -type f | wc -l`, { encoding: "utf-8" }).trim();
    checks.push({ name: "Files exist", passed: parseInt(fileCount) > 0, detail: `${fileCount} files found` });
  } catch {
    checks.push({ name: "Files exist", passed: false, detail: "Could not count files" });
  }

  return checks;
}

// --- Stage 2: Semantic Evaluation ---

async function evaluateAC(
  criterion: string,
  artifactContent: string,
  seedGoal: string,
  retryCount = 0
): Promise<ACResult> {
  const prompt = `You are a software evaluator. Evaluate whether an implementation artifact satisfies a specific acceptance criterion.

GOAL: ${seedGoal}

ACCEPTANCE CRITERION: ${criterion}

ARTIFACT CODE (truncated):
${artifactContent.slice(0, 8000)}

Evaluate the criterion against the artifact. Respond with ONLY a JSON object:
{
  "verdict": "PASS" | "PARTIAL" | "FAIL",
  "justification": "one-sentence explanation of your verdict with specific evidence from the code"
}

Rules:
- PASS: Criterion is fully satisfied with clear evidence in the artifact
- PARTIAL: Criterion is partially implemented or has minor gaps
- FAIL: Criterion is not implemented or fundamentally broken
- Be specific — cite function names, file sections, or patterns you found (or didn't find)`;

  try {
    const raw = await ollamaGenerate(prompt, AC_TIMEOUT_MS);
    const parsed = extractJSON(raw);

    if (parsed && parsed.verdict && parsed.justification) {
      const verdict = String(parsed.verdict).toUpperCase() as ACVerdict;
      if (["PASS", "PARTIAL", "FAIL"].includes(verdict)) {
        return { criterion, verdict, justification: String(parsed.justification) };
      }
    }

    // Parse failure — retry once with constrained prompt
    if (retryCount === 0) {
      return evaluateAC(criterion, artifactContent, seedGoal, 1);
    }
    return { criterion, verdict: "INCONCLUSIVE", justification: `Could not parse LLM response: ${raw.slice(0, 100)}` };
  } catch (err: any) {
    if (retryCount === 0) {
      return evaluateAC(criterion, artifactContent, seedGoal, 1);
    }
    return { criterion, verdict: "INCONCLUSIVE", justification: `Evaluation failed: ${err.message?.slice(0, 100) || "unknown error"}` };
  }
}

async function evaluateGoalAlignment(
  seedGoal: string,
  artifactContent: string,
  acResults: ACResult[],
  retryCount = 0
): Promise<number> {
  const acSummary = acResults.map(r => `[${r.verdict}] ${r.criterion}`).join("\n");

  const prompt = `You are a software evaluator. Score how well an implementation aligns with its stated goal.

GOAL: ${seedGoal}

AC EVALUATION RESULTS:
${acSummary}

ARTIFACT CODE (truncated):
${artifactContent.slice(0, 6000)}

Score the goal alignment from 0.0 to 1.0. Consider:
- Does the implementation serve the stated goal?
- Are there extra features beyond the goal (scope creep)?
- Are there critical goal aspects not addressed?

Respond with ONLY a JSON object:
{
  "score": 0.85,
  "reasoning": "one-sentence explanation"
}`;

  try {
    const raw = await ollamaGenerate(prompt, GOAL_TIMEOUT_MS);
    const parsed = extractJSON(raw);

    if (parsed && typeof parsed.score === "number") {
      return Math.min(1.0, Math.max(0.0, parsed.score));
    }
    if (retryCount === 0) return evaluateGoalAlignment(seedGoal, artifactContent, acResults, 1);
    return 0.5; // INCONCLUSIVE default
  } catch {
    if (retryCount === 0) return evaluateGoalAlignment(seedGoal, artifactContent, acResults, 1);
    return 0.5;
  }
}

async function runSemanticEval(
  seedSpec: SeedSpec,
  artifactContent: string
): Promise<SemanticEvalResult> {
  if (!seedSpec.acceptance_criteria || seedSpec.acceptance_criteria.length === 0) {
    return {
      ac_results: [],
      ac_compliance: 0,
      goal_alignment: 0,
      drift: 1.0,
      overall: 0,
      status: "SKIPPED",
    };
  }

  const ollamaOk = await checkOllamaAvailable();
  if (!ollamaOk) {
    console.log("  Ollama unavailable — Stage 2 SKIPPED");
    return {
      ac_results: seedSpec.acceptance_criteria.map(c => ({
        criterion: c,
        verdict: "SKIPPED" as ACVerdict,
        justification: "Ollama unavailable",
      })),
      ac_compliance: 0,
      goal_alignment: 0,
      drift: 1.0,
      overall: 0,
      status: "SKIPPED",
    };
  }

  const goal = seedSpec.goal || "(no goal specified)";

  // Evaluate each AC sequentially (to avoid overloading local Ollama)
  const ac_results: ACResult[] = [];
  for (let i = 0; i < seedSpec.acceptance_criteria.length; i++) {
    const ac = seedSpec.acceptance_criteria[i];
    console.log(`  Evaluating AC ${i + 1}/${seedSpec.acceptance_criteria.length}...`);
    const result = await evaluateAC(ac, artifactContent, goal);
    ac_results.push(result);
  }

  // Compute ac_compliance: (PASS + 0.5*PARTIAL) / (total - INCONCLUSIVE - SKIPPED)
  const scoreable = ac_results.filter(r => r.verdict !== "INCONCLUSIVE" && r.verdict !== "SKIPPED");
  const passCount = scoreable.filter(r => r.verdict === "PASS").length;
  const partialCount = scoreable.filter(r => r.verdict === "PARTIAL").length;
  const ac_compliance = scoreable.length > 0
    ? (passCount + 0.5 * partialCount) / scoreable.length
    : 0;

  // Goal alignment
  console.log("  Evaluating goal alignment...");
  const goal_alignment = await evaluateGoalAlignment(goal, artifactContent, ac_results);

  // Drift: 1.0 - |goal_alignment - ac_compliance|
  const drift = 1.0 - Math.abs(goal_alignment - ac_compliance);

  // Overall: ac_compliance * 0.5 + goal_alignment * 0.3 + drift * 0.2
  const overall = ac_compliance * 0.5 + goal_alignment * 0.3 + drift * 0.2;

  return { ac_results, ac_compliance, goal_alignment, drift, overall, status: "COMPLETED" };
}

// --- Stage 3: Consensus Deliberation ---

function shouldTriggerStage3(
  semanticResult: SemanticEvalResult,
  forceConsensus: boolean
): boolean {
  if (forceConsensus) return true;
  if (semanticResult.status !== "COMPLETED") return false;
  // Trigger: overall 0.60-0.85
  if (semanticResult.overall >= 0.60 && semanticResult.overall <= 0.85) return true;
  // Trigger: drift < 0.70
  if (semanticResult.drift < 0.70) return true;
  // Trigger: any AC is PARTIAL
  if (semanticResult.ac_results.some(r => r.verdict === "PARTIAL")) return true;
  return false;
}

async function runConsensus(
  seedSpec: SeedSpec,
  artifactContent: string,
  semanticResult: SemanticEvalResult,
  forceConsensus: boolean
): Promise<ConsensusResult> {
  if (!shouldTriggerStage3(semanticResult, forceConsensus)) {
    return {
      proposer: "",
      devils_advocate: "",
      synthesizer_verdict: "INCONCLUSIVE",
      synthesizer_confidence: 0,
      revision_items: [],
      rationale: "",
      status: "NOT_TRIGGERED",
    };
  }

  const ollamaOk = await checkOllamaAvailable();
  if (!ollamaOk) {
    console.log("  Ollama unavailable — Stage 3 SKIPPED");
    return {
      proposer: "",
      devils_advocate: "",
      synthesizer_verdict: "INCONCLUSIVE",
      synthesizer_confidence: 0,
      revision_items: [],
      rationale: "Ollama unavailable",
      status: "SKIPPED",
    };
  }

  const goal = seedSpec.goal || "(no goal specified)";
  const acSummary = semanticResult.ac_results
    .map(r => `[${r.verdict}] ${r.criterion}: ${r.justification}`)
    .join("\n");
  const scores = `AC Compliance: ${semanticResult.ac_compliance.toFixed(2)}, Goal Alignment: ${semanticResult.goal_alignment.toFixed(2)}, Drift: ${semanticResult.drift.toFixed(2)}, Overall: ${semanticResult.overall.toFixed(2)}`;

  // --- Proposer ---
  console.log("  Running Proposer perspective...");
  let proposerText = "";
  try {
    const proposerPrompt = `You are the PROPOSER in a three-perspective evaluation deliberation. Your role is to argue FOR approval of this implementation.

GOAL: ${goal}

STAGE 2 RESULTS:
${acSummary}
${scores}

ARTIFACT (truncated):
${artifactContent.slice(0, 4000)}

Write a 2-3 paragraph argument for why this implementation should be APPROVED. Highlight strengths, evidence of goal alignment, and quality of implementation. Acknowledge weaknesses but argue they are manageable. Be specific and cite evidence.`;

    proposerText = await ollamaGenerate(proposerPrompt, CONSENSUS_TIMEOUT_MS);
  } catch (err: any) {
    proposerText = `[Proposer failed: ${err.message?.slice(0, 80) || "unknown"}]`;
  }

  // --- Devil's Advocate ---
  console.log("  Running Devil's Advocate perspective...");
  let daText = "";
  try {
    const daPrompt = `You are the DEVIL'S ADVOCATE in a three-perspective evaluation deliberation. Your role is to argue AGAINST approval and identify risks.

GOAL: ${goal}

STAGE 2 RESULTS:
${acSummary}
${scores}

PROPOSER'S ARGUMENT:
${proposerText.slice(0, 2000)}

ARTIFACT (truncated):
${artifactContent.slice(0, 4000)}

Write a 2-3 paragraph argument for why this implementation should be REJECTED or REVISED. Challenge the Proposer's claims. Identify gaps, missing acceptance criteria, potential regressions, and architectural concerns. Be specific and cite evidence.`;

    daText = await ollamaGenerate(daPrompt, CONSENSUS_TIMEOUT_MS);
  } catch (err: any) {
    daText = `[Devil's Advocate failed: ${err.message?.slice(0, 80) || "unknown"}]`;
  }

  // --- Synthesizer ---
  console.log("  Running Synthesizer perspective...");
  try {
    const synthPrompt = `You are the SYNTHESIZER in a three-perspective evaluation deliberation. You must weigh both arguments and render a final verdict.

GOAL: ${goal}

STAGE 2 SCORES: ${scores}

PROPOSER'S ARGUMENT:
${proposerText.slice(0, 2000)}

DEVIL'S ADVOCATE ARGUMENT:
${daText.slice(0, 2000)}

Weigh both perspectives and render your verdict. Respond with ONLY a JSON object:
{
  "verdict": "ACCEPT" | "REVISE" | "REJECT",
  "confidence": 0.85,
  "revision_items": ["item1", "item2"],
  "rationale": "one paragraph explaining your decision"
}

Rules:
- ACCEPT: Implementation is good enough to proceed
- REVISE: Implementation needs specific changes (list them in revision_items)
- REJECT: Implementation fundamentally fails to meet the goal
- confidence: 0.0-1.0 how confident you are in your verdict
- revision_items: only populate for REVISE verdict, otherwise empty array`;

    const raw = await ollamaGenerate(synthPrompt, CONSENSUS_TIMEOUT_MS);
    let parsed = extractJSON(raw);

    // Retry once on parse failure
    if (!parsed || !parsed.verdict) {
      const raw2 = await ollamaGenerate(synthPrompt, CONSENSUS_TIMEOUT_MS);
      parsed = extractJSON(raw2);
    }

    if (parsed && parsed.verdict) {
      const verdict = String(parsed.verdict).toUpperCase();
      if (["ACCEPT", "REVISE", "REJECT"].includes(verdict)) {
        return {
          proposer: proposerText,
          devils_advocate: daText,
          synthesizer_verdict: verdict as any,
          synthesizer_confidence: Math.min(1.0, Math.max(0.0, Number(parsed.confidence) || 0.5)),
          revision_items: Array.isArray(parsed.revision_items) ? parsed.revision_items.map(String) : [],
          rationale: String(parsed.rationale || ""),
          status: "COMPLETED",
        };
      }
    }

    // INCONCLUSIVE fallback
    return {
      proposer: proposerText,
      devils_advocate: daText,
      synthesizer_verdict: "INCONCLUSIVE",
      synthesizer_confidence: 0,
      revision_items: [],
      rationale: `Could not parse Synthesizer response: ${raw.slice(0, 100)}`,
      status: "COMPLETED",
    };
  } catch (err: any) {
    return {
      proposer: proposerText,
      devils_advocate: daText,
      synthesizer_verdict: "INCONCLUSIVE",
      synthesizer_confidence: 0,
      revision_items: [],
      rationale: `Synthesizer failed: ${err.message?.slice(0, 100) || "unknown"}`,
      status: "COMPLETED",
    };
  }
}

// --- Final Decision Logic ---

function computeFinalDecision(
  stage1Passed: boolean,
  semanticResult: SemanticEvalResult,
  consensusResult: ConsensusResult
): string {
  if (!stage1Passed) return "NEEDS WORK";
  if (semanticResult.status === "SKIPPED") return "PENDING SEMANTIC EVALUATION (Ollama unavailable)";

  // If Stage 3 ran and completed, use its verdict
  if (consensusResult.status === "COMPLETED" && consensusResult.synthesizer_verdict !== "INCONCLUSIVE") {
    switch (consensusResult.synthesizer_verdict) {
      case "ACCEPT": return "APPROVED";
      case "REVISE": return "NEEDS WORK";
      case "REJECT": return "REJECTED";
    }
  }

  // Stage 3 INCONCLUSIVE — fall back to Stage 2 thresholds
  if (consensusResult.status === "COMPLETED" && consensusResult.synthesizer_verdict === "INCONCLUSIVE") {
    if (semanticResult.overall >= 0.85) return "APPROVED";
    if (semanticResult.overall < 0.60) return "REJECTED";
    return "MANUAL REVIEW";
  }

  // No Stage 3 — use Stage 2 thresholds
  if (semanticResult.overall >= 0.85) return "APPROVED";
  if (semanticResult.overall < 0.60) return "REJECTED";
  return "MANUAL REVIEW";
}

// --- Report Formatting ---

function formatReport(
  evalId: string,
  artifactPath: string,
  seedSpec: SeedSpec,
  mechanicalChecks: MechanicalCheck[],
  semanticResult: SemanticEvalResult | null,
  consensusResult: ConsensusResult | null,
  finalDecision: string,
  depCheck?: DependencyCheckResult
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];

  lines.push("Evaluation Report");
  lines.push("=================");
  lines.push(`ID: ${evalId}`);
  lines.push(`Artifact: ${artifactPath}`);
  lines.push(`Seed: ${seedSpec.id || "inline"}`);
  lines.push(`Date: ${now}`);
  lines.push("");

  // Dependency Check section
  if (depCheck) {
    lines.push("Dependency Check");
    lines.push("─".repeat(35));
    lines.push(`  Status: ${depCheck.status}`);
    lines.push(`  Scanned seeds: ${depCheck.scanned_seeds}`);
    if (depCheck.dag.edges.length > 0) {
      lines.push("  Edges:");
      for (const e of depCheck.dag.edges) {
        const tag = e.reason === "import_dependency" ? "import" : "file";
        const symbols = e.imported_symbols && e.imported_symbols.length > 0
          ? ` [${e.imported_symbols.join(", ")}]`
          : "";
        lines.push(`    ${e.resolved ? "[resolved]" : "[UNRESOLVED]"} (${tag}) ${e.from_seed} → ${e.to_seed} (${e.shared_files.join(", ")})${symbols}`);
      }
    }
    if (depCheck.import_warn_count > 0) {
      lines.push(`  Import warnings: ${depCheck.import_warn_count}`);
    }
    if (depCheck.dag.topological_order.length > 0) {
      lines.push(`  Recommended order: ${depCheck.dag.topological_order.join(" → ")}`);
    }
    if (depCheck.dag.cycle) {
      lines.push(`  CYCLE: ${depCheck.dag.cycle.join(" → ")}`);
    }
    lines.push("");
  }

  // Stage 1
  lines.push("Stage 1: Mechanical Verification");
  lines.push("─".repeat(35));
  let stage1Passed = true;
  for (const check of mechanicalChecks) {
    const status = check.passed ? "PASS" : "FAIL";
    lines.push(`  [${status}] ${check.name}: ${check.detail}`);
    if (!check.passed) stage1Passed = false;
  }
  lines.push(`  Result: ${stage1Passed ? "PASSED" : "FAILED"}`);
  lines.push("");

  if (!stage1Passed) {
    lines.push("Stage 1 FAILED — fix mechanical issues before proceeding to semantic evaluation.");
    lines.push("");
    lines.push(`Final Decision: ${finalDecision}`);
    return lines.join("\n");
  }

  // Stage 2
  if (semanticResult) {
    lines.push("Stage 2: Semantic Evaluation");
    lines.push("─".repeat(35));
    if (semanticResult.status === "SKIPPED") {
      lines.push("  Status: SKIPPED (Ollama unavailable)");
    } else {
      lines.push("  AC Results:");
      for (const ac of semanticResult.ac_results) {
        const icon = ac.verdict === "PASS" ? "PASS" : ac.verdict === "PARTIAL" ? "PART" : ac.verdict === "FAIL" ? "FAIL" : "SKIP";
        lines.push(`    [${icon}] ${ac.criterion}`);
        lines.push(`           ${ac.justification}`);
      }
      lines.push("");
      lines.push(`  AC Compliance:  ${(semanticResult.ac_compliance * 100).toFixed(1)}%`);
      lines.push(`  Goal Alignment: ${semanticResult.goal_alignment.toFixed(2)}`);
      lines.push(`  Drift:          ${semanticResult.drift.toFixed(2)}`);
      lines.push(`  Overall Score:  ${semanticResult.overall.toFixed(2)}`);
    }
    lines.push("");
  }

  // Stage 3
  if (consensusResult) {
    lines.push("Stage 3: Consensus Deliberation");
    lines.push("─".repeat(35));
    if (consensusResult.status === "NOT_TRIGGERED") {
      lines.push("  Not triggered (overall score outside trigger range)");
    } else if (consensusResult.status === "SKIPPED") {
      lines.push("  Status: SKIPPED (Ollama unavailable)");
    } else {
      lines.push("  Proposer:");
      for (const pLine of consensusResult.proposer.split("\n").slice(0, 15)) {
        lines.push(`    ${pLine}`);
      }
      lines.push("");
      lines.push("  Devil's Advocate:");
      for (const dLine of consensusResult.devils_advocate.split("\n").slice(0, 15)) {
        lines.push(`    ${dLine}`);
      }
      lines.push("");
      lines.push(`  Synthesizer Verdict: ${consensusResult.synthesizer_verdict} (confidence: ${consensusResult.synthesizer_confidence.toFixed(2)})`);
      if (consensusResult.rationale) {
        lines.push(`  Rationale: ${consensusResult.rationale}`);
      }
      if (consensusResult.revision_items.length > 0) {
        lines.push("  Revision Items:");
        for (const item of consensusResult.revision_items) {
          lines.push(`    - ${item}`);
        }
      }
    }
    lines.push("");
  }

  lines.push(`Final Decision: ${finalDecision}`);

  return lines.join("\n");
}

// --- Main ---

async function main() {
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

  const evalId = `eval-${randomUUID().slice(0, 8)}`;
  const stageLimit = values.stage ? parseInt(values.stage as string) : undefined;
  const forceConsensus = values["force-consensus"] as boolean;
  const seedsDir = (values["seeds-dir"] as string) || "/home/workspace/seeds";
  const strictImports = values["strict-imports"] as boolean;

  // Dependency Check (runs before Stage 1 — hard gate for file collisions, WARN for imports)
  const depCheck = runDependencyCheck(seedSpec, seedsDir, strictImports);
  console.log(`Dependency Check: ${depCheck.status} (${depCheck.scanned_seeds} siblings scanned)`);
  if (depCheck.dag.edges.length > 0) {
    console.log("  DAG Edges:");
    for (const edge of depCheck.dag.edges) {
      const status = edge.resolved ? "✓" : "✗";
      const symbols = edge.imported_symbols && edge.imported_symbols.length > 0
        ? ` [${edge.imported_symbols.join(", ")}]`
        : "";
      console.log(`    [${status}] ${edge.from_seed} → ${edge.to_seed} (${edge.reason}: ${edge.shared_files.join(", ")})${symbols}`);
    }
    if (depCheck.dag.topological_order.length > 0) {
      console.log(`  Recommended order: ${depCheck.dag.topological_order.join(" → ")}`);
    }
  }
  console.log(`  ${depCheck.message}\n`);

  if (depCheck.status === "BLOCKED" || depCheck.status === "CYCLE_ERROR") {
    console.log(`DEPENDENCY_ORDER: ${depCheck.status} — evaluation halted.`);
    console.log("Stage 2 and Stage 3 will not run until dependencies are resolved.\n");

    // Save minimal report
    const outputDir = (values.output as string) || join(artifactPath, "evaluations");
    if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
    const reportLines = [
      "Evaluation Report", "=================",
      `ID: ${evalId}`, `Seed: ${seedSpec.id || "inline"}`, `Date: ${new Date().toISOString()}`, "",
      `DEPENDENCY_ORDER: ${depCheck.status}`, "─".repeat(35),
      `Scanned seeds: ${depCheck.scanned_seeds}`,
      `Unresolved: ${depCheck.unresolved_count}`,
      `Import warnings: ${depCheck.import_warn_count}`,
      "", depCheck.message, "",
      `Final Decision: BLOCKED (dependency gate)`,
    ];
    const reportPath = join(outputDir, `${evalId}.txt`);
    writeFileSync(reportPath, reportLines.join("\n"));
    console.log(`Report saved to: ${reportPath}`);
    process.exit(3); // Exit code 3 = dependency blocked
  }

  if (depCheck.status === "WARN") {
    console.log(`DEPENDENCY_ORDER: WARN — import dependencies detected but not blocking.`);
    console.log("Evaluation will continue. Use --strict-imports to enforce.\n");
  }

  // Stage 1
  console.log("Stage 1: Running mechanical checks...\n");
  const checks = runMechanicalChecks(artifactPath);
  const stage1Passed = checks.every(c => c.passed);

  let semanticResult: SemanticEvalResult | null = null;
  let consensusResult: ConsensusResult | null = null;

  if (stage1Passed && (!stageLimit || stageLimit >= 2)) {
    // Read artifact content for LLM evaluation
    const artifactContent = readArtifactFiles(artifactPath);
    if (artifactContent.length === 0) {
      console.log("Warning: No evaluatable files found in artifact directory.\n");
    }

    // Stage 2
    console.log("Stage 2: Running semantic evaluation...\n");
    semanticResult = await runSemanticEval(seedSpec, artifactContent);

    // Stage 3
    if (semanticResult.status === "COMPLETED" && (!stageLimit || stageLimit >= 3)) {
      if (shouldTriggerStage3(semanticResult, forceConsensus)) {
        console.log("\nStage 3: Running consensus deliberation...\n");
      }
      consensusResult = await runConsensus(seedSpec, artifactContent, semanticResult, forceConsensus);
    }
  }

  const finalDecision = computeFinalDecision(
    stage1Passed,
    semanticResult || { ac_results: [], ac_compliance: 0, goal_alignment: 0, drift: 1, overall: 0, status: "SKIPPED" },
    consensusResult || { proposer: "", devils_advocate: "", synthesizer_verdict: "INCONCLUSIVE", synthesizer_confidence: 0, revision_items: [], rationale: "", status: "NOT_TRIGGERED" }
  );

  const report = formatReport(
    evalId,
    artifactPath,
    seedSpec,
    checks,
    semanticResult,
    consensusResult,
    finalDecision,
    depCheck
  );

  console.log("\n" + report);

  // Save report
  const outputDir = (values.output as string) || join(artifactPath, "evaluations");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const reportPath = join(outputDir, `${evalId}.txt`);
  writeFileSync(reportPath, report);
  console.log(`\nReport saved to: ${reportPath}`);

  // v4.10: Create episode record in memory system
  if (semanticResult && semanticResult.status === "COMPLETED") {
    try {
      const { Database } = await import("bun:sqlite");
      const { createEpisodeRecord } = await import("/home/workspace/Skills/zo-memory-system/scripts/continuation.ts");
      const dbPath = process.env.ZO_MEMORY_DB || "/home/workspace/.zo/memory/shared-facts.db";
      const db = new Database(dbPath);

      const outcomeMap: Record<string, "success" | "failure" | "ongoing"> = {
        "APPROVED": "success",
        "REJECTED": "failure",
        "NEEDS WORK": "ongoing",
        "MANUAL REVIEW": "ongoing",
      };

      const episodeId = createEpisodeRecord(db, {
        summary: `Eval ${evalId}: ${seedSpec.id || "inline"} → ${finalDecision} (overall: ${semanticResult.overall.toFixed(2)})`,
        outcome: outcomeMap[finalDecision] || "ongoing",
        happenedAt: Math.floor(Date.now() / 1000),
        entities: [
          `eval.${evalId}`,
          ...(seedSpec.id ? [`seed.${seedSpec.id}`] : []),
          `artifact.${artifactPath.split("/").pop()}`,
        ],
        metadata: {
          seed_id: seedSpec.id,
          artifact_path: artifactPath,
          ac_compliance: semanticResult.ac_compliance,
          goal_alignment: semanticResult.goal_alignment,
          drift: semanticResult.drift,
          overall: semanticResult.overall,
          stage3_verdict: consensusResult?.synthesizer_verdict || null,
          stage3_confidence: consensusResult?.synthesizer_confidence || null,
          final_decision: finalDecision,
        },
      });

      db.close();
      console.log(`Episode saved: ${episodeId}`);
    } catch (err: any) {
      console.error(`Warning: Could not save episode: ${err.message}`);
    }
  }

  // Exit with appropriate code
  if (finalDecision === "APPROVED") process.exit(0);
  if (finalDecision === "REJECTED") process.exit(2);
  process.exit(1); // NEEDS WORK, MANUAL REVIEW, etc.
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
