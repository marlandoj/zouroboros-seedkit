/**
 * Zouroboros Configuration
 *
 * Resolves paths for all Zouroboros skills. Portable across Zo Computer
 * installations and any Bun-compatible environment.
 *
 * Override defaults with environment variables or by editing this file.
 */

import { join } from "path";
import { existsSync } from "fs";

const HOME = process.env.HOME || "/home/workspace";

function resolve(envVar: string, fallback: string): string {
  return process.env[envVar] || fallback;
}

export const config = {
  // Root workspace — where user files live
  workspace: resolve("ZOUROBOROS_WORKSPACE", HOME),

  // Skills directory — where Zouroboros skills are installed
  skillsDir: resolve("ZOUROBOROS_SKILLS_DIR", join(HOME, "Skills")),

  // Memory system
  memoryDb: resolve("ZOUROBOROS_MEMORY_DB", join(HOME, ".zo/memory/shared-facts.db")),
  memoryScripts: resolve("ZOUROBOROS_MEMORY_SCRIPTS", join(HOME, "Skills/zo-memory-system/scripts")),

  // Seeds output
  seedsDir: resolve("ZOUROBOROS_SEEDS_DIR", join(HOME, "Seeds/zouroboros")),

  // Swarm orchestrator
  swarmDir: resolve("ZOUROBOROS_SWARM_DIR", join(HOME, "Skills/zo-swarm-orchestrator")),
  executorsDir: resolve("ZOUROBOROS_EXECUTORS_DIR", join(HOME, "Skills/zo-swarm-executors")),

  // Autoloop
  autoloopScript: resolve("ZOUROBOROS_AUTOLOOP", join(HOME, "Skills/autoloop/scripts/autoloop.ts")),

  // Eval reports directory
  evalReportsDir: resolve("ZOUROBOROS_EVAL_DIR", join(HOME, "evaluations")),

  // Get paths for self-enhancement skills
  get introspectScript() {
    return join(this.skillsDir, "zouroboros-introspect/scripts/introspect.ts");
  },
  get prescribeScript() {
    return join(this.skillsDir, "zouroboros-prescribe/scripts/prescribe.ts");
  },
  get evolveScript() {
    return join(this.skillsDir, "zouroboros-evolve/scripts/evolve.ts");
  },

  // Memory CLI helpers
  get memoryTs() {
    return join(this.memoryScripts, "memory.ts");
  },
  get evalContinuationTs() {
    return join(this.memoryScripts, "eval-continuation.ts");
  },
  get graphTs() {
    return join(this.memoryScripts, "graph.ts");
  },
};

// Validate critical paths exist
export function validateConfig(): { valid: boolean; missing: string[] } {
  const critical = [
    { name: "Memory DB", path: config.memoryDb },
    { name: "Memory scripts", path: config.memoryScripts },
    { name: "Skills dir", path: config.skillsDir },
  ];

  const missing = critical.filter(c => !existsSync(c.path)).map(c => `${c.name}: ${c.path}`);
  return { valid: missing.length === 0, missing };
}

export default config;
