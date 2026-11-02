# critique-partner

A design critic for [Claude Code](https://claude.com/claude-code) that argues from your rules, not from generic best practice.

Point it at a URL. It looks at the page, grills you about what the page is for and what you want from the crit, then writes a critique where every issue quotes one of your own rules word for word. Then it loops: a script checks every quote and every claim about the page, a second critic tries to knock the serious findings down, and the first critic fixes only what they caught, until the critique holds up.

```
/crit https://example.com/pricing
```

**Site:** [bbulman.github.io/critique-partner](https://bbulman.github.io/critique-partner/)

## Install

You need Claude Code, Node 18 or later, and Playwright with Chromium:

```bash
npm i -g playwright && npx playwright install chromium
```

Then:

```bash
git clone https://github.com/bbulman/critique-partner.git
cd critique-partner
./install.sh
```

It copies the agent to `~/.claude/agents/` and the skill to `~/.claude/skills/crit/`, keeping any earlier copy as a backup. Open a new Claude Code session (or type `/reload-skills`), and run `/crit` on a page.


## What it does, step by step

1. **Finds your rules.** It reads the design rules your project already wrote down: `taste.md` for judgment, `DESIGN.md` for rules, `principles.md`, `.claude/rules/design-principles.md`. It skips a file that only points somewhere else, and asks you when it finds none.
2. **Looks before it asks.** It screenshots the page in headless Chrome at phone and desktop width (the first screen, then the whole page screen by screen) and measures what a critic would otherwise guess: fonts, sizes, colours, contrast, buttons above the fold, gradients, shadows, corner radii, alt text, form labels, anything running past the screen edge. It warns you when it lands on a sign-in screen or gets redirected.
3. **Grills you.** One question at a time, each with its recommended answer drawn from what it saw: the page's one job; who's on it, and when; how finished it is; what you want from this crit, and whether you want its opinions or your rules only; what's already settled. It pushes back on vague answers ("cleaner" for whom, doing what?) and ends by showing you a five-line brief to confirm.
4. **Critiques.** A fresh `critique-partner` agent writes the critique: a verdict, a direct answer to your question, the one thing to fix first, then P0, P1 and P2 findings. Each finding names the page text or selector, quotes your rule word for word, says what's wrong and why it matters to the person on the page, and suggests a fix. Then up to three labelled opinions, what works and must survive the fixes, and what it couldn't check.
5. **Checks itself against a script.** `check.mjs` fails the critique if a quoted rule isn't word for word in the section it cites (a paraphrase, an invention, or a quote that drops the "never" in front of it), if quoted page text or a selector isn't on the page, or if the verdict contradicts the findings.
6. **Gets a second opinion.** Another fresh agent tries to prove each serious finding wrong against the screenshots and measurements, checks the severity and the verdict, and looks for anything serious the first one missed.
7. **Loops.** If the script or the second critic objects, the critic fixes only what was flagged, and both checks run again. Three passes at most.
8. **Reports.** The verdict, the answer to your question and what to fix first, the serious findings one line each, and anything assumed or unchecked.
9. **Keeps going with you.** Push back on a finding and the critic re-examines it, changing it on evidence, never on pressure; if you still reject it, it lands in a dismissed list and is never raised again. Fix the page and run `/crit` again, and round 2 shows what's fixed, still open, new or regressed.

## What a finding looks like

```markdown
### The hero copy sits over a full-bleed image
**Where:** 1280-fold.png, hero: "Spark is the powerful, AI-native workspace" (`section.hero`)
**Rule:** "No full-bleed hero images with text overlays." (taste.md § Density & spacing)
**What's wrong:** The image failed to load, so the white subhead sits on a white page.
A visitor deciding in seconds sees a slogan and two buttons, with nothing to judge the trial by.
**Fix:** Two grid cells: the copy in ink on one side, the image on the other.
```

Anything your rules don't cover is a **judgment call**: labelled, kept in its own section, at most three, and it never sets the verdict.

## Why it holds up

Language models are confident critics and unreliable ones. In Google's UICrit study, 13% of zero-shot UI critiques held up. Three things keep this one honest:

- **The gate is a script, not a vibe.** Self-correction without outside feedback makes models worse ([Huang et al. 2023](https://arxiv.org/abs/2310.01798)). So the loop runs on checks outside the model: the rule files, the captured page, and a deterministic gate with 55 self-test cases.
- **A second critic, with fresh eyes.** Model judges favour their own output ([Zheng et al. 2023](https://arxiv.org/abs/2306.05685)). The verifier never sees the first critic's reasoning, only its claims, and has to uphold each one line by line before the loop stops.
- **Short and anchored.** Longer critiques invent more bugs and nitpicks ([CriticGPT](https://arxiv.org/abs/2407.00215)), and models can't locate elements from a screenshot ([UICrit](https://arxiv.org/abs/2407.08850)). So findings are capped at 8, grouped by rule, and every one points at page text or a selector the capture recorded.

In testing on the example page, the loop took all three passes. The second critic caught five factual slips (a button placed on the wrong screenshot, a 56px headline reported as 48px, a black background that didn't exist), and each was fixed before the critique was shown.


## Use

| You type | What happens |
| --- | --- |
| `/crit <url>` | Capture, grill, critique loop, report |
| `/crit <url> --quick` | Two questions: the page's job, and what you want from the crit |
| `/crit <url> --no-grill` | No questions; every assumption is written into the brief |
| `/crit <url> --batch` | The grill asks every open question at once, round by round |
| `/crit <same url>` again | A short grill ("still true?"), then what's fixed, still open, new or regressed |
| `/crit page.html` | A local file works too; so does a screenshot or a Figma frame |
| "push back on the second P0" | The critic re-examines that finding against the evidence |

It writes each round to `.scratch/critiques/<page>/r<N>/` when your project gitignores `.scratch/`, or `.critiques/` otherwise: the brief, the screenshots and measurements, the critique, the gate's report and the verifier's lines.

## Your rules

The critic cites nothing but what you wrote. The better your rule files, the sharper the crit:

- **Write rules as sentences someone could quote.** "Use one filled button per screen" can be cited; "keep it clean" can't.
- **Say which rules are absolute.** Never, no, must and always mark a rule whose break is a P0.
- **Keep judgment and rules apart.** `taste.md` for what's good, `DESIGN.md` for what's allowed works well.

When the same judgment call keeps coming back, the critic offers it as a candidate rule. It never edits your rule files itself.

## Project notes

Put what a page can't tell the critic in `.claude/crit.md` at your project root. Both the skill and the agent read it first.

```markdown
# crit: project notes

## Widths
- /app/ pages are desktop-only: capture with --viewports 1100x800,1440x900.

## Signing in
- `node scripts/make-session.mjs <out.json>` writes a Playwright storage state for localhost; pass it as --storage.

## Settled: offer these as fences
- Brand-red buttons keep white text. Raise contrast on them only in an accessibility pass.
```

Signed-in pages take a Playwright storage state (cookies and localStorage) through `--storage`. The critic never types a password into a page.

## Try it on the example

[`example/`](example/) holds a landing page built to fail, with 13 planted violations of its own `taste.md` and `principles.md`:

```bash
cd example
```

Then, in Claude Code, `/crit subject/landing.html`. The [example README](example/README.md) lists what's planted and what a good critique finds.

## Files

| File | What it is |
| --- | --- |
| [`agents/critique-partner.md`](agents/critique-partner.md) | The critic. Modes: critique, revise, verify, reconsider |
| [`skills/crit/SKILL.md`](skills/crit/SKILL.md) | `/crit`: capture, grill, the loop, rounds |
| [`skills/crit/scripts/capture.mjs`](skills/crit/scripts/capture.mjs) | Playwright capture: screenshots, page text, the rendered DOM, measured facts |
| [`skills/crit/scripts/check.mjs`](skills/crit/scripts/check.mjs) | The gate. `node check.mjs --selftest` runs its 55 cases |
| [`skills/crit/scripts/make-installer.mjs`](skills/crit/scripts/make-installer.mjs) | Builds a one-file installer, or exports the live files into this repo |
| [`install.sh`](install.sh) | Copies the agent and the skill into `~/.claude` |
| [`example/`](example/) | The planted-violations test page and its rules |
| [`docs/`](docs/) | The GitHub Pages site |

## The research behind it

| Design choice | Source |
| --- | --- |
| The grill runs in the main session, not the agent | Claude Code removes AskUserQuestion from subagents ([docs](https://code.claude.com/docs/en/sub-agents)) |
| The loop runs on outside checks, capped at three passes | [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents); [Self-Refine](https://arxiv.org/abs/2303.17651); [Huang et al.](https://arxiv.org/abs/2310.01798) |
| A fresh critic verifies the serious findings | [Zheng et al.](https://arxiv.org/abs/2306.05685); [NN/g on severity ratings](https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/) |
| Findings capped, grouped and anchored to the page | [CriticGPT](https://arxiv.org/abs/2407.00215); [UICrit](https://arxiv.org/abs/2407.08850) |
| It answers your question first; opinions are opt-in | [Liz Lerman's Critical Response Process](https://lizlerman.com/critical-response-process/) |
| Each finding ties what it saw to the page's job | Adam Connor and Aaron Irizarry, *Discussing Design* |
| What works is a list to protect, not a compliment sandwich | [Parkes et al.](https://doi.org/10.1007/s10459-012-9377-9); [NN/g on design critiques](https://www.nngroup.com/articles/design-critiques/) |
| The fix is a suggestion; the diagnosis is the deliverable | Ed Catmull on Pixar's Braintrust, *Creativity, Inc.* |
| One question at a time, each with a recommendation | Matt Pocock's [grilling skill](https://github.com/mattpocock/skills) |

## Limits

- It captures two widths, scrolled once. Hover, focus, open menus and multi-step flows go under "Not checked".
- Contrast is measured against solid backgrounds; text over an image or a gradient counts as unknown.
- A full loop costs up to six Opus agent runs: three writes and three verifies.
- The Figma path hasn't been run end to end yet.
- A project can deny the agent in its settings (`permissions.deny: Agent(critique-partner)`). `/crit` stops and says so rather than routing around it.

## Maintaining

The live copy is the one in `~/.claude`. After changing it, refresh this repo with:

```bash
node ~/.claude/skills/crit/scripts/make-installer.mjs --export .
node skills/crit/scripts/check.mjs --selftest
```

## License

MIT. Made by [Workshopr.io](https://workshopr.io).
