---
name: zouroboros-introspect
description: >
  Self-diagnostic health scorecard for the Zouroboros system. Measures memory recall quality,
  knowledge graph connectivity, swarm routing accuracy, eval calibration, procedure freshness,
  and autoloop efficiency. Outputs a ranked scorecard with improvement opportunities.
  Run daily or on-demand to feed the self-enhancement pipeline.
compatibility: Created for Zo Computer
metadata:
  author: marlandoj.zo.computer
  version: "1.0.0"
  phase: "Zouroboros Phase 1 — Introspection"
---

# Zouroboros Introspect

Self-diagnostic agent that measures health across all Zouroboros subsystems and produces a ranked scorecard of improvement opportunities.

## Usage

```bash
bun Skills/zouroboros-introspect/scripts/introspect.ts [--json] [--store] [--verbose]
```

### Flags

| Flag | Description |
|------|-------------|
| `--json` | Output scorecard as JSON instead of formatted text |
| `--store` | Store the scorecard as a memory episode with outcome and entity tags |
| `--verbose` | Show detailed per-check output |

### What It Measures

| Metric | Source | Target | Weight |
|--------|--------|--------|--------|
| Memory Recall | `eval-continuation.ts` | ≥ 85% pass rate | 0.25 |
| Graph Connectivity | `graph.ts knowledge-gaps` | ≥ 80% linked facts | 0.15 |
| Routing Accuracy | Episode analysis (predicted vs actual) | ≥ 85% | 0.20 |
| Eval Calibration | Stage 3 override rate from eval reports | ≤ 15% override | 0.15 |
| Procedure Freshness | Procedures not evolved in 14+ days | ≤ 30% stale | 0.15 |
| Episode Velocity | Success/failure trend over 14 days | Positive trend | 0.10 |

### Output

Formatted scorecard with:
- Per-metric score, trend arrow, and status (HEALTHY / WARNING / CRITICAL)
- Composite health score (0–100)
- Ranked improvement opportunities with recommended action
- Weakest subsystem identification

### Integration

- **Memory**: `--store` saves scorecard as episode (`[[zouroboros.introspection]]`)
- **Prescribe**: Output feeds Phase 2 prescription engine
- **Scheduling**: Run as daily Zo agent at 05:00 AM Phoenix (after conversation capture at 04:00)

## References

- `references/metric-thresholds.md` — threshold tuning guide and rationale
