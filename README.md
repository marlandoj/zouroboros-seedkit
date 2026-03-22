# 🐍 Zouroboros

**Self-learning AI development skills for [Zo Computer](https://zocomputer.com).**

Zouroboros is a self-enhancing AI development toolkit. It starts with specification-first development — Socratic interviews, immutable seed specs, and 3-stage evaluation. Then it closes the loop: the system diagnoses its own health, prescribes improvements, executes them autonomously, and verifies the results.

The snake eats its own tail.

```
Interview → Seed → Execute → Evaluate
    ↑                           ↓
    ↑     Introspect → Prescribe → Evolve
    ↑         ↑                      ↓
    └─────────┴──────────────────────┘
```

Adapted from [Q00/ouroboros](https://github.com/Q00/ouroboros). Native TypeScript/Bun, zero Python dependencies, designed as [Zo Skills](https://agentskills.io/specification).

---

## What's Included

### Foundational Skills

| Skill | Description |
|-------|-------------|
| **spec-first-interview** | Socratic interview → ambiguity scoring → immutable seed YAML |
| **three-stage-eval** | Mechanical → Semantic → Consensus verification pipeline |
| **unstuck-lateral** | 5 lateral-thinking personas to break through stagnation |

### Self-Enhancement Skills (the closed loop)

| Skill | Description |
|-------|-------------|
| **zouroboros-introspect** | Self-diagnostic health scorecard across 6 system metrics |
| **zouroboros-prescribe** | Auto-generates improvement seeds from scorecard, with governor safety gate |
| **zouroboros-evolve** | Executes prescriptions, measures delta, reverts regressions |

### Personas

| Persona | Purpose |
|---------|---------|
| **Zouroboros** | The self-enhancement engine — clinical, metric-driven, autonomous |
| **Hacker** | Break past constraints creatively |
| **Researcher** | Stop and investigate systematically |
| **Simplifier** | Cut to MVP ruthlessly |
| **Architect** | Fix structural problems |
| **Contrarian** | Question the problem itself |

---

## Install

### Zo Computer (recommended)

```bash
git clone https://github.com/marlandoj/Zo-Ouroboros.git /tmp/zouroboros
bash /tmp/zouroboros/install.sh
rm -rf /tmp/zouroboros
```

### One-liner

```bash
git clone https://github.com/marlandoj/Zo-Ouroboros.git /tmp/zouroboros && bash /tmp/zouroboros/install.sh && rm -rf /tmp/zouroboros
```

### Environment Variables (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `ZOUROBOROS_WORKSPACE` | `$HOME` | Root workspace path |
| `ZOUROBOROS_SKILLS_DIR` | `$HOME/Skills` | Where skills are installed |
| `ZOUROBOROS_IDENTITY_DIR` | `$HOME/IDENTITY` | Where persona files go |
| `ZOUROBOROS_SEEDS_DIR` | `$HOME/Seeds/zouroboros` | Where prescriptions are saved |
| `ZOUROBOROS_MEMORY_DB` | `$HOME/.zo/memory/shared-facts.db` | SQLite memory database |
| `ZOUROBOROS_MEMORY_SCRIPTS` | `$HOME/Skills/zo-memory-system/scripts` | Memory system CLI |

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0+)
- SQLite3 CLI
- [zo-memory-system](https://github.com/zocomputer/skills) skill (for memory DB, graph, episodes, procedures)
- Optional: [Ollama](https://ollama.ai) with `qwen2.5:1.5b` + `nomic-embed-text` (for memory gate + embeddings)
- Optional: [autoloop](https://github.com/zocomputer/skills) skill (for file-targeting metric optimization)

---

## Quick Start

### 1. Score a request

```bash
bun Skills/spec-first-interview/scripts/interview.ts score \
  --request "Add rate limiting to the API"
```

### 2. Run the self-diagnostic

```bash
bun Skills/zouroboros-introspect/scripts/introspect.ts --verbose
```

Output:
```
╔════════════════════════════════════════════════════════╗
║  ZOUROBOROS INTROSPECTION SCORECARD                     ║
╠════════════════════════════════════════════════════════╣
║  ✅ Memory Recall          100.0% → score:100%  ║
║  ✅ Graph Connectivity      90.0% → score:100%  ║
║  ⚠️  Routing Accuracy        N/A   → score: 50%  ║
║  ⚠️  Eval Calibration        N/A   → score: 50%  ║
║  ⚠️  Procedure Freshness     N/A   → score: 50%  ║
║  ⚠️  Episode Velocity        N/A   → score: 50%  ║
╠════════════════════════════════════════════════════════╣
║  ⚠️  COMPOSITE HEALTH: 70/100                          ║
║     Weakest: Routing Accuracy                           ║
╚════════════════════════════════════════════════════════╝
```

### 3. Run the full self-enhancement pipeline

```bash
# Introspect → identify weakest metric
bun Skills/zouroboros-introspect/scripts/introspect.ts --json > /tmp/scorecard.json

# Prescribe → generate improvement seed
bun Skills/zouroboros-prescribe/scripts/prescribe.ts --scorecard /tmp/scorecard.json

# Evolve → execute the prescription
bun Skills/zouroboros-evolve/scripts/evolve.ts --prescription Seeds/zouroboros/rx-*.json
```

### 4. Schedule it (Zo Computer)

Create a scheduled agent that runs the pipeline daily. The Zouroboros persona handles the rest autonomously — diagnosing, prescribing, executing, and reporting via email.

---

## The Self-Enhancement Loop

### How It Works

1. **Introspect** — Measures 6 health metrics across memory, graph, routing, eval, procedures, and episode velocity. Outputs a composite score (0–100) and ranks improvement opportunities.

2. **Prescribe** — Maps the weakest metric to one of 12 playbooks. Generates a seed YAML (spec-first format) and optionally a program.md (autoloop format). A governor gate blocks high-risk prescriptions.

3. **Evolve** — Executes the prescription via autoloop (file-targeting) or script mode (procedural). Captures pre/post scorecards. Reverts on regression.

### 6 Health Metrics

| Metric | Source | Target | Weight |
|--------|--------|--------|--------|
| Memory Recall | Continuation eval fixture pass rate | ≥ 85% | 0.25 |
| Graph Connectivity | Knowledge graph orphan fact ratio | ≥ 80% linked | 0.15 |
| Routing Accuracy | Swarm episode success rate | ≥ 85% | 0.20 |
| Eval Calibration | Stage 3 override rate | ≤ 15% | 0.15 |
| Procedure Freshness | Stale procedure ratio (14+ days) | ≤ 30% | 0.15 |
| Episode Velocity | 7-day success trend vs prior 7 days | Positive | 0.10 |

### 12 Playbooks

| ID | Playbook | Metric | Severity |
|----|----------|--------|----------|
| A | Fixture Expansion | Memory Recall | WARNING |
| B | Graph-Boost Weight Tuning | Memory Recall | CRITICAL |
| C | Batch Wikilink Extraction | Graph Connectivity | WARNING |
| D | Entity Consolidation | Graph Connectivity | CRITICAL |
| E | Signal Weight Adjustment | Routing Accuracy | WARNING |
| F | Capability Keyword Expansion | Routing Accuracy | CRITICAL ⚠️ |
| G | Drift Threshold Adjustment | Eval Calibration | WARNING |
| H | Semantic Fixture Addition | Eval Calibration | CRITICAL ⚠️ |
| I | Batch Procedure Evolution | Procedure Freshness | WARNING |
| J | Procedure Regeneration | Procedure Freshness | CRITICAL |
| K | Failure Root-Cause Analysis | Episode Velocity | WARNING |
| L | Executor Health Check | Episode Velocity | CRITICAL ⚠️ |

⚠️ = Requires human approval (governor blocks autonomous execution)

### Governor Safety Rules

The governor prevents runaway self-modification:

1. **Approval gate** — Playbooks marked ⚠️ require human approval before execution
2. **Schema protection** — Never touches database migrations or structure
3. **Blast radius limit** — Max 3 files modified per cycle
4. **Weight bounds** — Routing/scoring weights can only change ±10% per cycle
5. **Regression detection** — Any metric dropping >2% triggers automatic revert
6. **Audit trail** — Every cycle stored as a memory episode with full metadata

---

## Foundational Skills

### Spec-First Interview

Scores ambiguity across three dimensions:

| Dimension | Weight |
|-----------|--------|
| Goal clarity | 40% |
| Constraint clarity | 30% |
| Success criteria | 30% |

**Ambiguity** = 1 − (goal × 0.40 + constraints × 0.30 + success × 0.30)

Gate passes at ambiguity ≤ 0.20. Output is an immutable seed YAML.

```bash
bun Skills/spec-first-interview/scripts/interview.ts score --request "Make the site faster"
# → Ambiguity: 0.98 — HIGH AMBIGUITY

bun Skills/spec-first-interview/scripts/interview.ts score \
  --request "Add Redis caching to the /api/products endpoint using a 5-minute TTL that invalidates on product updates"
# → Ambiguity: 0.15 — READY
```

### Three-Stage Evaluation

| Stage | Cost | Checks |
|-------|------|--------|
| 1. Mechanical | $0 | Compile, lint, test, coverage |
| 2. Semantic | Low | AC compliance, goal alignment, drift score |
| 3. Consensus | Medium | 3-perspective deliberation (if drift > 0.3 or score uncertain) |

```bash
bun Skills/three-stage-eval/scripts/evaluate.ts \
  --artifact ./my-project/ --seed ./seeds/seed-abc.yaml
```

### Unstuck Lateral

Auto-selects the right persona based on problem signals:

| Signal | Persona |
|--------|---------|
| "error", "can't", "constraint" | Hacker |
| "don't understand", "why" | Researcher |
| "too complex", "overwhelming" | Simplifier |
| "keeps breaking", "touching everything" | Architect |
| "wrong approach", "step back" | Contrarian |

---

## File Structure

```
Zouroboros/
├── README.md
├── LICENSE
├── install.sh                          # Installer script
├── zouroboros.config.ts                # Portable path configuration
├── skills/
│   ├── spec-first-interview/           # Socratic interview + seed generation
│   │   ├── SKILL.md
│   │   ├── scripts/interview.ts
│   │   └── references/
│   ├── three-stage-eval/               # 3-stage verification pipeline
│   │   ├── SKILL.md
│   │   ├── scripts/evaluate.ts
│   │   └── references/
│   ├── unstuck-lateral/                # 5 lateral-thinking personas
│   │   ├── SKILL.md
│   │   └── references/
│   ├── zouroboros-introspect/          # Self-diagnostic scorecard
│   │   ├── SKILL.md
│   │   ├── scripts/introspect.ts
│   │   └── references/metric-thresholds.md
│   ├── zouroboros-prescribe/           # Self-prescription engine
│   │   ├── SKILL.md
│   │   ├── scripts/prescribe.ts
│   │   └── references/playbooks.md
│   └── zouroboros-evolve/              # Evolution executor
│       ├── SKILL.md
│       └── scripts/evolve.ts
└── personas/
    ├── zouroboros.md                   # Self-enhancement persona template
    ├── unstuck-hacker.md
    ├── unstuck-researcher.md
    ├── unstuck-simplifier.md
    ├── unstuck-architect.md
    └── unstuck-contrarian.md
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      USER (Approval)                         │
│   • Reviews high-risk prescriptions                          │
│   • Receives daily email scorecards                          │
│   • Can override governor, adjust thresholds                 │
└────────────────────────┬────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
  │  INTROSPECT │→│  PRESCRIBE  │→│   EVOLVE    │
  │  (measure)  │ │  (plan)     │ │  (execute)  │
  │             │ │             │ │             │
  │ 6 metrics   │ │ 12 playbooks│ │ Autoloop or │
  │ Composite   │ │ Governor    │ │ Script mode │
  │ score 0-100 │ │ Seed YAML   │ │ Pre/post    │
  │             │ │ Program.md  │ │ scorecard   │
  └──────┬──────┘ └─────────────┘ └──────┬──────┘
         │                                │
         │        ┌─────────────┐         │
         └───────→│   MEMORY    │←────────┘
                  │             │
                  │ Facts       │
                  │ Episodes    │
                  │ Procedures  │
                  │ Graph       │
                  └─────────────┘
```

### Dependencies

Zouroboros builds on these Zo Computer subsystems:

| System | Role | Required? |
|--------|------|-----------|
| **zo-memory-system** | Facts, episodes, procedures, graph, embeddings | Yes |
| **zo-swarm-orchestrator** | Parallel task execution with 6-signal routing | For routing metrics |
| **autoloop** | Single-metric file optimization | For file-targeting playbooks |
| **Ollama** | Local inference (memory gate, auto-capture, procedure evolution) | For memory gate |

---

## Extending

### Adding a New Metric

1. Add a collector function in `introspect.ts` (follow the `measureMemoryRecall` pattern)
2. Add thresholds in `references/metric-thresholds.md`
3. Add playbooks in `references/playbooks.md` (WARNING + CRITICAL variants)
4. Register the playbook in `prescribe.ts`'s `getPlaybook()` switch
5. Add an executor in `evolve.ts` if the playbook uses script mode

### Adding a New Playbook

1. Define it in `references/playbooks.md` with target file, metric command, and constraints
2. Add it to the `getPlaybook()` registry in `prescribe.ts`
3. If script mode: add a case in `evolve.ts`'s execution switch
4. If file mode: autoloop handles it automatically via program.md

### Adjusting Thresholds

Edit `references/metric-thresholds.md` and the corresponding constants in `introspect.ts`. The system will auto-calibrate — if composite stays above 90 for 2+ weeks, tighten targets.

---

## Credits

Adapted from **[Q00/ouroboros](https://github.com/Q00/ouroboros)** by [@Q00](https://github.com/Q00) — a specification-first AI development system. Also inspired by [potentialInc/claude-ooo](https://github.com/potentialInc/claude-ooo) and [karpathy/autoresearch](https://github.com/karpathy) patterns.

Self-enhancement architecture designed and built on [Zo Computer](https://zocomputer.com).

---

## License

MIT — see [LICENSE](LICENSE).
