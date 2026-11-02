#!/usr/bin/env bash
# Installs the critique partner into Claude Code: the critique-partner agent and the /crit skill.
#
#   ./install.sh      installs into ~/.claude (set CLAUDE_DIR to install elsewhere)
#
# An existing agent is kept as agents/critique-partner.md.bak.<stamp>, and an existing skill as
# backups/crit.<stamp>/, outside skills/ so the copy doesn't load as a second /crit.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "Installing the critique partner into $CLAUDE_DIR"
mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/skills"
if [ -f "$CLAUDE_DIR/agents/critique-partner.md" ]; then
  cp "$CLAUDE_DIR/agents/critique-partner.md" "$CLAUDE_DIR/agents/critique-partner.md.bak.$STAMP"
  echo "  kept the old agent as agents/critique-partner.md.bak.$STAMP"
fi
if [ -d "$CLAUDE_DIR/skills/crit" ]; then
  mkdir -p "$CLAUDE_DIR/backups"
  mv "$CLAUDE_DIR/skills/crit" "$CLAUDE_DIR/backups/crit.$STAMP"
  echo "  kept the old skill as backups/crit.$STAMP"
fi
cp "$HERE/agents/critique-partner.md" "$CLAUDE_DIR/agents/critique-partner.md"
cp -R "$HERE/skills/crit" "$CLAUDE_DIR/skills/crit"
echo "  wrote agents/critique-partner.md and skills/crit/"

echo "Checking"
if command -v node >/dev/null 2>&1; then
  echo "  gate self-test: $(node "$CLAUDE_DIR/skills/crit/scripts/check.mjs" --selftest | tail -1)"
  if node -e "require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright')" >/dev/null 2>&1; then
    echo "  Playwright: found in the global npm root"
  else
    echo "  Playwright: not global; capture uses a project's own copy, or run: npm i -g playwright && npx playwright install chromium"
  fi
else
  echo "  Node not found: the capture and check scripts need Node 18 or later"
fi

echo
echo "Next: open a new Claude Code session (or type /reload-skills), then run /crit <url>."
echo "Try it first on the example: cd $HERE/example, then /crit subject/landing.html"
