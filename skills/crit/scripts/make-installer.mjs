#!/usr/bin/env node
// crit: write the critique partner's installer from the live files, so the installer can never drift
// from what is installed here. Run it after any change to the agent, the skill or its scripts.
//
//   make-installer.mjs [--out <path>]     default ~/.claude/plans/install-critique-partner.sh
//   make-installer.mjs --export <dir>     copy the live files into a checkout of the GitHub repo instead

import { readFileSync, writeFileSync, chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CLAUDE = join(homedir(), '.claude');
const FILES = [
  'agents/critique-partner.md',
  'skills/crit/SKILL.md',
  'skills/crit/scripts/capture.mjs',
  'skills/crit/scripts/check.mjs',
  'skills/crit/scripts/make-installer.mjs',
];
const x = process.argv.indexOf('--export');
if (x > 0) {
  const dir = process.argv[x + 1];
  if (!dir) throw new Error('--export needs a directory');
  for (const rel of FILES) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(join(CLAUDE, rel), join(dir, rel));
  }
  console.log(`exported ${FILES.length} files to ${dir}`);
  process.exit(0);
}

const i = process.argv.indexOf('--out');
const out = i > 0 ? process.argv[i + 1] : join(CLAUDE, 'plans', 'install-critique-partner.sh');
const today = new Date().toISOString().slice(0, 10);

const blocks = FILES.map((rel, n) => {
  const text = readFileSync(join(CLAUDE, rel), 'utf8');
  const tag = `CRIT_FILE_${n + 1}_EOF`;
  if (text.split('\n').includes(tag)) throw new Error(`${rel} contains the heredoc tag ${tag}`);
  return `write_file "${rel}" <<'${tag}'\n${text.endsWith('\n') ? text : `${text}\n`}${tag}\n`;
}).join('\n');

const script = `#!/usr/bin/env bash
# Installs the critique partner for Claude Code: the critique-partner agent and the /crit skill.
# Generated ${today} by ~/.claude/skills/crit/scripts/make-installer.mjs from the live files.
# Don't edit this file: change the live files, then run the generator again.
#
#   bash install-critique-partner.sh      installs into ~/.claude (set CLAUDE_DIR to install elsewhere)
#
# Idempotent. An existing agent is kept as agents/critique-partner.md.bak.<stamp>, and an existing
# skill as backups/crit.<stamp>/, outside skills/ so the copy doesn't load as a second /crit.
set -euo pipefail
CLAUDE_DIR="\${CLAUDE_DIR:-$HOME/.claude}"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "Installing the critique partner into $CLAUDE_DIR"
if [ -f "$CLAUDE_DIR/agents/critique-partner.md" ]; then
  cp "$CLAUDE_DIR/agents/critique-partner.md" "$CLAUDE_DIR/agents/critique-partner.md.bak.$STAMP"
  echo "  kept the old agent as agents/critique-partner.md.bak.$STAMP"
fi
if [ -d "$CLAUDE_DIR/skills/crit" ]; then
  mkdir -p "$CLAUDE_DIR/backups"
  cp -R "$CLAUDE_DIR/skills/crit" "$CLAUDE_DIR/backups/crit.$STAMP"
  echo "  kept the old skill as backups/crit.$STAMP"
fi

write_file() {
  local dest="$CLAUDE_DIR/$1"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest"
  echo "  wrote $1"
}

${blocks}
echo "Checking"
for f in agents/critique-partner.md skills/crit/SKILL.md; do
  if [ "$(head -1 "$CLAUDE_DIR/$f")" != "---" ]; then echo "  $f has no frontmatter"; exit 1; fi
done
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
echo "Next:"
echo "  1. Open a new Claude Code session, or type /reload-skills."
echo "  2. Try it on the example: cd ~/.claude/plans/critique-partner-example, then /crit subject/landing.html"
echo "  3. On a real page: /crit <url>. A project can deny the agent (permissions.deny: Agent(critique-partner)); /crit says so when it does."
`;

writeFileSync(out, script);
chmodSync(out, 0o755);
console.log(`wrote ${out} (${FILES.length} files, ${script.split('\n').length} lines)`);
