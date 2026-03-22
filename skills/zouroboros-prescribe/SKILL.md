---
name: zouroboros-prescribe
description: >
  Self-prescription engine for the Zouroboros system. Takes an introspection scorecard,
  identifies the weakest subsystem, maps it to a known improvement pattern, and generates
  a seed YAML + autoloop program.md for autonomous improvement. Includes a governor that
  flags high-risk prescriptions for human approval.
compatibility: Created for Zo Computer
metadata:
  author: marlandoj.zo.computer
  version: "1.0.0"
  phase: "Zouroboros Phase 2 — Self-Prescription"
---

# Zouroboros Prescribe

Takes an introspection scorecard and generates actionable improvement artifacts:
1. A **seed YAML** (spec-first format) defining the improvement goal, constraints, and acceptance criteria
2. A **program.md** (autoloop format) for autonomous metric optimization
3. A **governor report** flagging any risks that require human approval

## Usage

```bash
bun Skills/zouroboros-prescribe/scripts/prescribe.ts [--scorecard <path>] [--live] [--target <metric>] [--output <dir>] [--dry-run]
```

### Flags

| Flag | Description |
|------|-------------|
| `--scorecard <path>` | Path to scorecard JSON (from `introspect.ts --json`) |
| `--live` | Run introspect live and use its output (default if no --scorecard) |
| `--target <metric>` | Override: prescribe for this metric instead of weakest |
| `--output <dir>` | Output directory for seed + program (default: `Seeds/zouroboros/`) |
| `--dry-run` | Show what would be prescribed without writing files |

### Governor Safety Rules

The governor blocks autonomous execution and flags for human review when:
- Prescription touches **schema migrations** or database structure
- Prescription modifies **>3 files**
- Prescription changes **executor bridges** or **routing weights** beyond ±10%
- Seed **ambiguity score > 0.20** (same gate as spec-first-interview)
- Target metric has **no baseline data** (N/A status)

### Improvement Patterns

Each metric maps to a known remediation playbook (see `references/playbooks.md`).

## Integration

- **Input**: Introspection scorecard (Phase 1)
- **Output**: Seed YAML + program.md → feeds Phase 3 (autoloop evolution)
- **Memory**: Stores prescription as episode tagged `[[zouroboros.prescription]]`
