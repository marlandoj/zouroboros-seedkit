# Autoresearch Patterns Reference

Source: https://github.com/karpathy/autoresearch (MIT, 46k+ stars)

## Core Idea
Give an AI agent a single file to edit, a fixed-time experiment budget, and one metric.
Loop forever: propose change → commit → run → measure → keep or revert.

## Key Design Decisions (from Karpathy)

1. **Single file to modify** — Keeps scope manageable and diffs reviewable
2. **Fixed time budget** — Makes experiments comparable regardless of what the agent changes
3. **Self-contained** — No external deps beyond what's in pyproject.toml
4. **program.md as skill** — Human edits the prompt, agent edits the code
5. **NEVER STOP** — Agent runs indefinitely until manually interrupted

## Patterns Borrowed for Autoloop

### From PR #329 (observability + memory)
- Hebbian association tracking for change categories
- Circuit breaker for executor health (implemented in orchestrate-v4.ts)
- Backpressure monitoring for degraded executors

### From PR #331 (structured results)
- result.json contract: structured JSON instead of grepping stdout
- "No file = crash" convention
- Atomic write (tmp + mv) to prevent partial reads
- Injection hardening: never feed raw output into retry prompts

### From PR #341 (episodic memory)
- SQLite-backed experiment memory with confidence gating
- Z-score normalization for hyperparameter distances
- LLM conflict resolution for contradicting results

### From PR #327 (stagnation guidance)
- Tiered stagnation response (mild → radical → stop)
- Exploration vs exploitation phase detection

## What We Changed
- Generalized beyond ML training to any single-metric optimization
- Added cost guardrails (maxExperiments, maxDurationHours, maxCostUSD)
- Integrated with Zo executor system instead of raw Claude/Codex CLI
- Added git branch auto-cleanup (7-day TTL for no-keeper branches)
- Structured result.json output per Spec 2
