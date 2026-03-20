# 🐍 Zourorobros-Seedkit

**Specification-first AI development skills for [Zo Computer](https://zocomputer.com).**

Stop telling AI what to build before you've defined what _should_ be built. Zo-Ouroboros adds a Socratic interview → immutable seed spec → 3-stage evaluation loop to your Zo workspace — plus 5 lateral-thinking personas for when you're stuck.

Adapted from [Q00/ouroboros](https://github.com/Q00/ouroboros) by [@Q00](https://github.com/Q00). The upstream project is a Python-based specification-first AI development system with Claude Code integration. Zo-Ouroboros is a native Zo Computer port — zero Python dependencies, all TypeScript/Bun, designed to run as [Zo Skills](https://agentskills.io/specification) and IDENTITY personas.

---

## What's Included

### Skills

| Skill | Description |
|-------|-------------|
| **spec-first-interview** | Socratic interview that scores ambiguity, then generates an immutable seed specification |
| **three-stage-eval** | Mechanical → Semantic → Consensus verification pipeline for any artifact |
| **unstuck-lateral** | 5 lateral-thinking personas to break through stagnation |

### Personas

| Persona | When You're Stuck Because... |
|---------|------------------------------|
| **Hacker** | "I can't get past this error / constraint" |
| **Researcher** | "I don't understand why this is happening" |
| **Simplifier** | "This is too complex / scope is too big" |
| **Architect** | "Simple changes touch everything" |
| **Contrarian** | "Are we even solving the right problem?" |

### The Loop

```
Interview → Seed → Execute → Evaluate
    ↑                           ↓
    └─── Evolutionary Loop ─────┘
```

---

## Install

### Zo Computer (recommended)

Copy the skills and personas into your workspace:

```bash
# Clone the repo
git clone https://github.com/marlandoj/Zo-Ouroboros.git /tmp/zo-ouroboros

# Copy skills into your Skills directory
cp -r /tmp/zo-ouroboros/skills/spec-first-interview ~/Skills/
cp -r /tmp/zo-ouroboros/skills/three-stage-eval ~/Skills/
cp -r /tmp/zo-ouroboros/skills/unstuck-lateral ~/Skills/

# Copy personas into your IDENTITY directory
cp /tmp/zo-ouroboros/personas/unstuck-*.md ~/IDENTITY/

# Clean up
rm -rf /tmp/zo-ouroboros
```

Or just ask Zo:

> "Install Zo-Ouroboros from https://github.com/marlandoj/Zo-Ouroboros"

### One-liner

```bash
git clone https://github.com/marlandoj/Zo-Ouroboros.git /tmp/zo-ouroboros && cp -r /tmp/zo-ouroboros/skills/* ~/Skills/ && cp /tmp/zo-ouroboros/personas/*.md ~/IDENTITY/ && rm -rf /tmp/zo-ouroboros && echo "✅ Zo-Ouroboros installed"
```

### Verify

```bash
bun ~/Skills/spec-first-interview/scripts/interview.ts --help
bun ~/Skills/three-stage-eval/scripts/evaluate.ts --help
```

---

## Quick Start

### Via Zo Chat (natural language)

You don't need to touch the terminal. Just talk to Zo:

**Interview before building:**
> "Run the spec-first-interview skill for: build a webhook retry system with exponential backoff"

Zo will conduct a Socratic interview — asking 5-8 focused questions about your goal, constraints, and success criteria. When ambiguity drops below 20%, it generates an immutable seed spec.

**Check if a request is too vague:**
> "Score the ambiguity of: make the site better"

Zo will tell you exactly what's unclear and what to clarify.

**Evaluate an artifact against a spec:**
> "Run the three-stage-eval skill against Skills/spec-first-interview/ using the seed at /path/to/seed.yaml"

Zo runs mechanical checks (compile, lint, test), then evaluates acceptance criteria, and triggers consensus if needed.

**Get unstuck:**
> "I'm stuck — the webhook handler keeps timing out and I can't figure out why"

Zo auto-selects the right lateral-thinking persona (Researcher in this case) and attacks the problem from a fresh angle.

> "I'm stuck — this is way too complex, there are too many moving parts"

Zo switches to the Simplifier persona and starts cutting to MVP.

**Use a specific unstuck persona:**
> "Switch to the unstuck-hacker persona — I need to bypass this API rate limit"

### Via Terminal (CLI)

**Score ambiguity of a request:**
```bash
bun Skills/spec-first-interview/scripts/interview.ts score \
  --request "Build a REST API for user auth with JWT tokens that returns 401 on invalid credentials"
```

Output:
```
Ambiguity Score
===============
Request: "Build a REST API for user auth with JWT tokens that returns 401 on invalid credentials"

  Goal clarity:       0.70 / 1.00  (weight: 40%)
  Constraint clarity: 0.25 / 1.00  (weight: 30%)
  Success criteria:   0.30 / 1.00  (weight: 30%)

  Ambiguity:          0.55 / 1.00  (threshold: ≤ 0.20)

Assessment: NEEDS CLARIFICATION — Run a Socratic interview to fill gaps.
```

**Score a vague request:**
```bash
bun Skills/spec-first-interview/scripts/interview.ts score \
  --request "Make the site better"
```

Output:
```
Ambiguity Score
===============
Request: "Make the site better"

  Goal clarity:       0.05 / 1.00  (weight: 40%)
  Constraint clarity: 0.00 / 1.00  (weight: 30%)
  Success criteria:   0.00 / 1.00  (weight: 30%)

  Ambiguity:          0.98 / 1.00  (threshold: ≤ 0.20)

Assessment: HIGH AMBIGUITY — Significant interview required before any implementation.
```

**Generate a seed spec template:**
```bash
bun Skills/spec-first-interview/scripts/interview.ts seed \
  --topic "Webhook retry system" \
  --output ./seeds/
```

**Generate from interview notes:**
```bash
bun Skills/spec-first-interview/scripts/interview.ts seed \
  --topic "Webhook retry system" \
  --from ./interview-notes.md \
  --output ./seeds/
```

**Evaluate an artifact (mechanical checks):**
```bash
bun Skills/three-stage-eval/scripts/evaluate.ts \
  --artifact ./my-project/ \
  --seed ./seeds/seed-abc123.yaml
```

**Run only Stage 1 (fast, $0):**
```bash
bun Skills/three-stage-eval/scripts/evaluate.ts \
  --artifact ./my-project/ \
  --seed ./seeds/seed-abc123.yaml \
  --stage 1
```

**Force consensus evaluation:**
```bash
bun Skills/three-stage-eval/scripts/evaluate.ts \
  --artifact ./my-project/ \
  --seed ./seeds/seed-abc123.yaml \
  --force-consensus
```

---

## Examples

### Example 1: New Feature Build

```
You: "Run the spec-first-interview skill for: add Stripe webhook handling to the site"

Zo: "What specific Stripe events do you need to handle? 
     (e.g., checkout.session.completed, payment_intent.succeeded, subscription changes)"

You: "Checkout completed and subscription created"

Zo: "What should happen when a checkout completes? 
     Should it update a database, send a confirmation email, provision access, or something else?"

You: "Update the order status in our database and send a confirmation email"

Zo: [continues for 3-5 more questions until ambiguity ≤ 0.2]
Zo: "Ambiguity is now at 0.15. Generating seed specification..."
Zo: [produces seed-abc123.yaml with goal, constraints, acceptance criteria, and ontology]
```

### Example 2: Evaluating Work

```
You: "Evaluate Skills/spec-first-interview/ with three-stage-eval"

Zo: "Running mechanical checks...

     Stage 1: Mechanical Verification
       [PASS] Files exist: 7 files found
       [PASS] TypeScript compile: No type errors
     Result: PASSED

     Stage 2: Semantic Evaluation
       No acceptance criteria found in seed. Define criteria to enable semantic evaluation.

     Final Decision: PENDING SEMANTIC EVALUATION"
```

### Example 3: Getting Unstuck

```
You: "I'm stuck — the API keeps returning 403 and the docs say I have the right scopes"

Zo: [auto-selects Researcher persona]
    "Let me investigate systematically:
     1. What exact endpoint are you calling?
     2. What HTTP method? (GET/POST/PUT — some endpoints require specific methods)
     3. Are you in a sandbox/test environment or production?
     4. When did this last work? What changed since then?"
```

### Example 4: Full Loop

```bash
# 1. Score the request
bun Skills/spec-first-interview/scripts/interview.ts score \
  --request "Add rate limiting to the API"
# → Ambiguity: 0.72 — NEEDS CLARIFICATION

# 2. Run the interview (via Zo chat)
# → Zo asks focused questions, gets ambiguity to 0.18

# 3. Generate the seed
bun Skills/spec-first-interview/scripts/interview.ts seed \
  --topic "Rate limiting" --from ./interview-notes.md --output ./seeds/

# 4. Build the feature
# → (implementation happens here)

# 5. Evaluate against the seed
bun Skills/three-stage-eval/scripts/evaluate.ts \
  --artifact ./src/ --seed ./seeds/seed-xyz.yaml
# → Stage 1: PASSED, Stage 2: 0.85, Final: APPROVED
```

---

## File Structure

```
Zo-Ouroboros/
├── README.md
├── LICENSE
├── skills/
│   ├── spec-first-interview/
│   │   ├── SKILL.md              # Skill definition (Agent Skills spec)
│   │   ├── scripts/
│   │   │   └── interview.ts      # CLI: score, seed, interview
│   │   └── references/
│   │       ├── socratic-interviewer.md
│   │       ├── seed-architect.md
│   │       └── ontologist.md
│   ├── three-stage-eval/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   │   └── evaluate.ts       # CLI: mechanical + semantic eval
│   │   └── references/
│   │       ├── evaluator.md
│   │       └── qa-judge.md
│   └── unstuck-lateral/
│       ├── SKILL.md
│       └── references/
│           ├── hacker.md
│           ├── researcher.md
│           ├── simplifier.md
│           ├── architect.md
│           └── contrarian.md
└── personas/
    ├── unstuck-hacker.md
    ├── unstuck-researcher.md
    ├── unstuck-simplifier.md
    ├── unstuck-architect.md
    └── unstuck-contrarian.md
```

---

## Requirements

- [Zo Computer](https://zocomputer.com) workspace (or any environment with [Bun](https://bun.sh) installed)
- No external dependencies — all scripts use Bun built-ins only

---

## How It Works

### Spec-First Interview

The Socratic interviewer tracks three dimensions:

| Dimension | Weight | Measures |
|-----------|--------|----------|
| Goal clarity | 40% | What exactly should this do and for whom? |
| Constraint clarity | 30% | What boundaries, limits, or requirements exist? |
| Success criteria | 30% | How will we know it's done correctly? |

**Ambiguity** = 1 − (goal × 0.40 + constraints × 0.30 + success × 0.30)

The interview gate passes when ambiguity ≤ 0.20 (80% clarity). The output is an immutable **seed specification** — a YAML file with goal, constraints, acceptance criteria, an ontology (domain model), evaluation principles, and exit conditions.

### Three-Stage Evaluation

| Stage | Cost | What It Checks |
|-------|------|----------------|
| **1. Mechanical** | $0 | Compile, lint, test, coverage — automated checks |
| **2. Semantic** | Low | Each acceptance criterion against evidence in the artifact |
| **3. Consensus** | Medium | Multi-perspective deliberation (Proposer vs. Devil's Advocate vs. Synthesizer) |

Each gate must pass before the next. Stage 3 only triggers on drift, uncertain scores, or explicit request.

### Unstuck Personas

Each persona attacks stagnation from a fundamentally different angle. The auto-selection logic matches problem signals to the right persona:

| Signal Words | → Persona |
|-------------|-----------|
| "error", "can't", "won't let me", "constraint" | Hacker |
| "don't understand", "unexpected", "why" | Researcher |
| "too complex", "too many", "overwhelming" | Simplifier |
| "keeps breaking", "touching everything" | Architect |
| "wrong approach", "step back" | Contrarian |

---

## Credits

This project is adapted from **[Q00/ouroboros](https://github.com/Q00/ouroboros)** by [@Q00](https://github.com/Q00) — a specification-first AI development system that treats AI like a junior developer: it needs a clear spec before it writes code.

Key concepts ported from the upstream project:
- **Socratic Interview** → ambiguity scoring → seed specification workflow
- **3-stage evaluation pipeline** (mechanical → semantic → consensus)
- **Ontological analysis** (Essence, Root Cause, Prerequisites, Hidden Assumptions)
- **Lateral-thinking agent personas** (Hacker, Researcher, Simplifier, Architect, Contrarian)

Also inspired by patterns from [potentialInc/claude-ooo](https://github.com/potentialInc/claude-ooo), a downstream fork that extended the ouroboros interviewer and evaluator agents.

Zo-Ouroboros is a clean-room re-implementation for the Zo Computer ecosystem — zero Python dependencies, native TypeScript/Bun, Zo Skills format, and IDENTITY persona integration.

---

## License

MIT — see [LICENSE](LICENSE).
