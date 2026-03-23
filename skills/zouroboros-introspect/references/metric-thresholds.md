# Metric Thresholds & Rationale

## Threshold Design

Each metric has three zones:
- **HEALTHY** (green): At or above target — no action needed
- **WARNING** (yellow): Below target but above critical — improvement opportunity
- **CRITICAL** (red): Below critical threshold — urgent attention needed

## Thresholds

### Memory Recall (weight: 0.22)
- **Target:** ≥ 85% pass rate
- **Warning:** < 85%
- **Critical:** < 70%
- **Source:** eval-continuation.ts fixture pass rate
- **Rationale:** 85% is the existing target from zo-memory-system v3.3.1. Below 70% means the system is forgetting critical context.
- **Improvement patterns:** Add continuation fixtures, tune graph-boost weights, retrain embeddings on missed cases

### Graph Connectivity (weight: 0.14)
- **Target:** ≥ 80% linked facts
- **Warning:** < 80%
- **Critical:** < 60%
- **Source:** graph.ts knowledge-gaps orphan ratio
- **Rationale:** Orphan facts don't contribute to graph-boost scoring (0.15 weight in RRF). High orphan rates degrade hybrid search quality.
- **Improvement patterns:** Run wikilink auto-capture on orphan entities, suggest link candidates, batch-link co-occurring entities

### Routing Accuracy (weight: 0.18)
- **Target:** ≥ 85% correct routing
- **Warning:** < 85%
- **Critical:** < 70%
- **Source:** Episode analysis — compare routed executor with outcome (success = correct, failure on executor-specific error = misroute)
- **Rationale:** Misrouting wastes tokens and time. 85% accounts for inherent uncertainty in task complexity estimation.
- **Improvement patterns:** Retune 6-signal weights, add capability keywords, adjust complexity thresholds

### Eval Calibration (weight: 0.14)
- **Target:** ≤ 15% Stage 3 override rate
- **Warning:** > 15%
- **Critical:** > 30%
- **Source:** Eval report files — count Stage 3 outcomes that differ from Stage 2
- **Rationale:** High override rate means Stage 2 scoring is unreliable. Stage 3 is expensive (3 LLM calls); it should be needed rarely.
- **Improvement patterns:** Adjust drift threshold, add semantic fixtures, calibrate AC compliance scoring

### Procedure Freshness (weight: 0.14)
- **Target:** ≤ 30% stale (no evolution in 14+ days)
- **Warning:** > 30%
- **Critical:** > 60%
- **Source:** Procedure table — compare last_evolved timestamp to now
- **Rationale:** Stale procedures may reference outdated tools, paths, or patterns. Active evolution keeps workflows current.
- **Improvement patterns:** Trigger procedure evolution on stale entries, archive unused procedures, merge duplicates

### Episode Velocity (weight: 0.08)
- **Target:** Positive success trend (7-day moving average)
- **Warning:** Flat or slightly negative
- **Critical:** Strongly negative (>20% decline)
- **Source:** Episode success/failure counts over 14-day window
- **Rationale:** Declining success rate indicates systemic regression. Early detection prevents cascading failures.
- **Improvement patterns:** Investigate recent failure episodes, check for infrastructure changes, review executor health

### Skill Effectiveness (weight: 0.10)
- **Target:** ≥ 85% success rate
- **Warning:** < 85%
- **Critical:** < 70%
- **Source:** skill_executions table — success/failure counts over 14-day window
- **Rationale:** Low skill success rates indicate broken tools, stale scripts, or misconfigured integrations. Tracking per-skill helps identify specific problem areas.
- **Improvement patterns:** Analyze error messages for common patterns, fix input validation, improve error handling, expand skill capabilities

## Composite Score

```
composite = Σ(metric_score × weight) × 100
```

Where each metric_score is normalized to 0.0–1.0:
- At or above target: 1.0
- Between critical and target: linear interpolation
- At or below critical: 0.0

## Tuning

These thresholds should be revisited monthly or when:
- A new subsystem is added
- Significant architectural changes occur
- The composite score plateaus above 90 for 2+ weeks (tighten targets)
- The composite score stays below 60 for 1+ week (loosen targets or investigate root cause)
