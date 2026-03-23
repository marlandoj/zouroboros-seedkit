#!/bin/bash
# Zouroboros Installer
# Installs skills and personas into a Zo Computer workspace (or any Bun-compatible environment)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="${ZOUROBOROS_SKILLS_DIR:-$HOME/Skills}"
IDENTITY_DIR="${ZOUROBOROS_IDENTITY_DIR:-$HOME/IDENTITY}"
SEEDS_DIR="${ZOUROBOROS_SEEDS_DIR:-$HOME/Seeds/zouroboros}"

echo "🐍 Zouroboros Installer"
echo "========================"
echo "Skills dir:   $SKILLS_DIR"
echo "Identity dir: $IDENTITY_DIR"
echo "Seeds dir:    $SEEDS_DIR"
echo ""

# Create directories
mkdir -p "$SKILLS_DIR" "$IDENTITY_DIR" "$SEEDS_DIR"

# Install foundational skills
echo "Installing foundational skills..."
cp -r "$SCRIPT_DIR/skills/spec-first-interview" "$SKILLS_DIR/"
cp -r "$SCRIPT_DIR/skills/three-stage-eval" "$SKILLS_DIR/"
cp -r "$SCRIPT_DIR/skills/unstuck-lateral" "$SKILLS_DIR/"
cp -r "$SCRIPT_DIR/skills/autoloop" "$SKILLS_DIR/"

# Install self-enhancement skills
echo "Installing self-enhancement skills..."
cp -r "$SCRIPT_DIR/skills/zouroboros-introspect" "$SKILLS_DIR/"
cp -r "$SCRIPT_DIR/skills/zouroboros-prescribe" "$SKILLS_DIR/"
cp -r "$SCRIPT_DIR/skills/zouroboros-evolve" "$SKILLS_DIR/"

# Install config
echo "Installing config..."
cp "$SCRIPT_DIR/zouroboros.config.ts" "$SKILLS_DIR/zouroboros.config.ts"

# Install personas
echo "Installing personas..."
cp "$SCRIPT_DIR/personas/unstuck-"*.md "$IDENTITY_DIR/" 2>/dev/null || true
echo "  → Zouroboros persona template at: $SCRIPT_DIR/personas/zouroboros.md"
echo "    (Create manually in Settings > AI > Personas)"

# Verify
echo ""
echo "Verifying installation..."
PASS=0
FAIL=0

for skill in spec-first-interview three-stage-eval autoloop zouroboros-introspect zouroboros-prescribe zouroboros-evolve; do
  if [ -f "$SKILLS_DIR/$skill/SKILL.md" ]; then
    echo "  ✅ $skill"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $skill"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
if [ $FAIL -eq 0 ]; then
  echo "✅ Zouroboros installed successfully ($PASS skills)"
  echo ""
  echo "Quick start:"
  echo "  bun $SKILLS_DIR/zouroboros-introspect/scripts/introspect.ts --help"
  echo "  bun $SKILLS_DIR/zouroboros-prescribe/scripts/prescribe.ts --help"
  echo "  bun $SKILLS_DIR/zouroboros-evolve/scripts/evolve.ts --help"
  echo ""
  echo "Prerequisites:"
  echo "  • Bun runtime (https://bun.sh)"
  echo "  • zo-memory-system skill (for memory DB, graph, episodes)"
  echo "  • SQLite3 CLI (for direct DB queries)"
  echo "  • Optional: Ollama with qwen2.5:1.5b + nomic-embed-text (for memory gate + embeddings)"
else
  echo "⚠️  Installation incomplete ($FAIL skills missing)"
  exit 1
fi
