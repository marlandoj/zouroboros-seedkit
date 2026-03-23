# Improvement Playbooks

Each metric maps to specific, tested remediation patterns. The prescriber selects the appropriate playbook based on the scorecard.

## Memory Recall (eval-continuation pass rate)

### When WARNING (70–85%)
- **Pattern A: Fixture Expansion** — Analyze which continuation queries fail, generate new fixtures targeting those gaps
- **Target file:** `Skills/zo-memory-system/assets/continuation-eval-fixture-set.json`
- **Metric command:** `bun Skills/zo-memory-system/scripts/eval-continuation.ts 2>&1 | grep -oP 'Rate: \K[\d.]+'`
- **Constraints:** Only add fixtures, never remove existing ones. Max 10 new fixtures per cycle.

### When CRITICAL (<70%)
- **Pattern B: Graph-Boost Weight Tuning** — Adjust RRF fusion weights in graph-boost.ts
- **Target file:** `Skills/zo-memory-system/scripts/graph-boost.ts`
- **Metric command:** Same as above
- **Constraints:** Weights must sum to 1.0. No single weight > 0.70 or < 0.05.

## Graph Connectivity (orphan fact ratio)

### When WARNING (60–80%)
- **Pattern C: Batch Wikilink Extraction** — Scan orphan facts for entity co-occurrence, auto-generate links
- **Target file:** A generated linking script (disposable)
- **Metric command:** `bun Skills/zo-memory-system/scripts/graph.ts knowledge-gaps 2>&1 | grep -oP 'Linked facts: \d+ \(\K[\d.]+'`
- **Constraints:** Only create links with weight ≥ 0.5. Never delete existing links. Max 500 links per cycle.

### When CRITICAL (<60%)
- **Pattern D: Entity Consolidation** — Merge duplicate entities, standardize naming, create hub nodes
- **Target file:** A generated consolidation script (disposable)
- **Metric command:** Same as above
- **Constraints:** Require exact entity match for merge. Log all merges. Never delete facts.

## Routing Accuracy (episode success rate)

### When WARNING (70–85%)
- **Pattern E: Signal Weight Adjustment** — Tune the 6-signal composite weights based on recent episode outcomes
- **Target file:** `Skills/zo-swarm-orchestrator/config.json`
- **Metric command:** Custom episode analysis query
- **Constraints:** No single signal weight > 0.40 or < 0.05. Total must sum to 1.0. Changes ≤ ±0.05 per signal per cycle.

### When CRITICAL (<70%)
- **Pattern F: Capability Keyword Expansion** — Add domain keywords to executor capability profiles
- **Target file:** `Skills/zo-swarm-executors/registry/executor-registry.json`
- **Metric command:** Same as above
- **Constraints:** Only add keywords, never remove. Max 10 keywords per executor per cycle.
- **Governor: REQUIRES HUMAN APPROVAL** — executor registry changes affect all swarm routing.

## Eval Calibration (Stage 3 override rate)

### When WARNING (15–30%)
- **Pattern G: Drift Threshold Adjustment** — Lower the drift threshold that triggers Stage 3
- **Target file:** `Skills/three-stage-eval/scripts/evaluate.ts`
- **Metric command:** Count overrides in eval report files
- **Constraints:** Drift threshold must stay between 0.1 and 0.5. Changes ≤ ±0.05 per cycle.

### When CRITICAL (>30%)
- **Pattern H: Semantic Fixture Addition** — Add eval fixtures from recent false positives/negatives
- **Target file:** Eval fixture files
- **Metric command:** Same as above
- **Governor: REQUIRES HUMAN APPROVAL** — eval logic changes affect all future evaluations.

## Procedure Freshness (stale ratio)

### When WARNING (30–60%)
- **Pattern I: Batch Procedure Evolution** — Trigger Ollama-powered evolution on stale procedures
- **Target file:** None (uses memory.ts CLI)
- **Metric command:** `sqlite3 .zo/memory/shared-facts.db "SELECT CAST(SUM(CASE WHEN updated_at < datetime('now','-14 days') THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 FROM procedures;"`
- **Constraints:** Evolve max 5 procedures per cycle. Archive (don't delete) procedures with 0 success over 30 days.

### When CRITICAL (>60%)
- **Pattern J: Procedure Regeneration** — Auto-generate new procedures from recent successful episodes
- **Target file:** None (uses memory.ts CLI)
- **Metric command:** Same as above
- **Constraints:** Only generate from episodes with outcome=success. Max 3 new procedures per cycle.

## Episode Velocity (success trend)

### When WARNING (flat/slightly negative)
- **Pattern K: Failure Root-Cause Analysis** — Query recent failure episodes, categorize, identify top cause
- **Target file:** Analysis report (informational only)
- **Metric command:** Episode success rate query
- **Constraints:** Read-only analysis. No mutations. Output feeds next introspection cycle.

### When CRITICAL (>20% decline)
- **Pattern L: Executor Health Check** — Run doctor.ts on all executors, restart failing ones
- **Target file:** None (uses executor tools)
- **Metric command:** Same as above
- **Governor: REQUIRES HUMAN APPROVAL** — executor restarts affect running tasks.

## Skill Effectiveness (per-skill success rate)

### When WARNING (70–85%)
- **Pattern M: Skill Error Pattern Fix** — Analyze top error patterns from skill_executions, generate targeted fixes
- **Target file:** Identified failing skill script
- **Metric command:** `sqlite3 .zo/memory/shared-facts.db "SELECT CAST(SUM(CASE WHEN outcome='success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 FROM skill_executions WHERE created_at > datetime('now', '-14 days');"`
- **Constraints:** Read-only analysis first, then targeted fix. Max 1 skill file per cycle.
- **Governor: REQUIRES HUMAN APPROVAL** — skill code modifications require human review.

### When CRITICAL (<70%)
- **Pattern N: Tool Call Optimization** — Fix argument patterns, timeout handling, error recovery in failing skills
- **Target file:** Identified failing skill scripts
- **Metric command:** Same as above
- **Constraints:** Only modify error handling and argument validation. Max 2 skills per cycle.
- **Governor: REQUIRES HUMAN APPROVAL** — modifying skill scripts affects live system behavior.
