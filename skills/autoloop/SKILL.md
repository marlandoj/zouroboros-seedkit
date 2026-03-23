---
name: autoloop
description: |
  Autonomous single-metric optimization loop driven by a program.md file. The agent edits one target file, runs an experiment, measures a metric, keeps improvements (git commit), reverts regressions (git reset), and loops indefinitely. Inspired by karpathy/autoresearch. Use for trading backtests, prompt optimization, site performance tuning, or any task with a clear numeric metric.
compatibility: Created for Zo Computer
metadata:
  author: marlandoj.zo.computer
  origin: karpathy/autoresearch patterns
  version: 1.0.0
---
# Autoloop — Autonomous Optimization Skill

## Quick Start

```bash
# 1. Create a program.md in your project directory (see template)
cp Skills/autoloop/assets/template.program.md my-project/program.md
# Edit program.md with your metric, target file, and run command

# 2. Run the loop
bun Skills/autoloop/scripts/autoloop.ts --program my-project/program.md

# 3. Stop anytime with Ctrl+C — progress is saved via git commits
```

## How It Works

1. Reads your `program.md` for configuration
2. Creates a git branch `autoloop/{name}-{date}`
3. Runs the baseline (first experiment, no changes)
4. Loops forever:
   - Agent proposes a change to the target file
   - Commits the change
   - Runs the experiment via your run command
   - Extracts the metric via your extract command
   - If improved → keep commit, advance branch
   - If regressed → `git reset --hard HEAD~1`
   - If crashed → log, attempt fix (max 3), skip if unfixable
5. Stagnation detection triggers increasingly radical exploration
6. Writes `results.tsv` with full experiment history

## Options

```
--program <path>     Path to program.md (required)
--executor <name>    Executor to use for proposals (default: claude-code)
--resume             Resume from existing autoloop branch instead of creating new
--dry-run            Parse program.md and show config without running
```

## Scheduling as a Zo Agent

The autoloop can run overnight as a scheduled agent:

```
Create a Zo agent that runs:
bun /home/workspace/Skills/autoloop/scripts/autoloop.ts --program /home/workspace/my-project/program.md
```

Cost guardrails (maxExperiments, maxDurationHours, maxCostUSD) prevent runaway spending.

## References

- `assets/template.program.md` — Template for new programs
- `references/autoresearch-patterns.md` — Design notes from karpathy/autoresearch
- Spec: `Skills/zo-swarm-orchestrator/specs/autoresearch-patterns-spec.md` (Spec 3)
