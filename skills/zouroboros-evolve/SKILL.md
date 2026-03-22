---
name: zouroboros-evolve
description: >
  Evolution engine for the Zouroboros self-enhancement pipeline. Takes a prescription
  (seed + playbook) and executes the improvement: either via autoloop (file-targeting
  playbooks) or via script execution (procedural playbooks). Measures before/after,
  keeps improvements, reverts regressions, and stores results as episodes.
compatibility: Created for Zo Computer
metadata:
  author: marlandoj.zo.computer
  version: "1.0.0"
  phase: "Zouroboros Phase 3 — Evolution"
---

# Zouroboros Evolve

Executes a prescribed improvement and validates the result.

## Usage

```bash
bun Skills/zouroboros-evolve/scripts/evolve.ts --prescription <path> [--dry-run] [--skip-governor]
```

### Flags

| Flag | Description |
|------|-------------|
| `--prescription, -p` | Path to prescription JSON from prescribe.ts |
| `--dry-run` | Show what would be executed without running |
| `--skip-governor` | Override governor flags (requires explicit intent) |

### Execution Modes

1. **Autoloop mode** — When prescription has a program.md, delegates to autoloop.ts
2. **Script mode** — When prescription has no target file, executes the playbook directly via a generated remediation script

### Safety

- Pre-flight: run introspect to capture baseline metrics
- Post-flight: run introspect again to measure delta
- Any metric regression > 2% triggers automatic revert
- All changes logged as memory episodes
