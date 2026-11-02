# Example: a page built to fail

A synthetic set for trying the critique partner end to end:

| File | Role |
| --- | --- |
| [`taste.md`](taste.md) | Spark's design taste: typography, colour, density, buttons, shadows, voice, anti-patterns |
| [`principles.md`](principles.md) | Spark's seven design principles |
| [`subject/landing.html`](subject/landing.html) | A landing page that breaks those rules on purpose |

## Try it

```bash
cd example
```

Then, in Claude Code:

> `/crit subject/landing.html`

Add `--no-grill` to skip the questions. The critic finds `taste.md` and `principles.md` in this folder.

## What's planted

A good critique catches all of these, each as a finding that quotes the rule it breaks:

| In `landing.html` | Rule it breaks | Where the rule is |
| --- | --- | --- |
| `font-family: Arial, Helvetica, sans-serif` | "Use only **Inter** or **Manrope**. Never Arial, Helvetica, system-ui…" | taste.md § Typography |
| Blue-to-purple gradients on text (the h1, the stat numbers) | "No gradients on text under any circumstance." | taste.md § Color |
| Blue-to-purple gradients on the buttons and the closing band | "Never use blue, teal, or purple gradients." | taste.md § Color |
| A drop shadow on every card | "Never use drop shadows for elevation." | taste.md § Shadows & borders |
| An outlined-rectangle secondary button | "No outlined-rectangle buttons." | taste.md § Buttons |
| 6px button corners and a 16px band | "Border radius: 4px for inputs, 8px for cards, 999px for pills. No other values." | taste.md § Shadows & borders |
| A full-bleed hero image with white text over it | "No full-bleed hero images with text overlays." | taste.md § Density & spacing |
| Seamless, unlocked, powerful, transforms, leverage, synergy, delight | The banned-words list | taste.md § Voice & copy |
| An exclamation point on every button | "No exclamation points outside of error states and confirmations." | taste.md § Voice & copy |
| An animated ✨ in the headline and footer | "Animated emojis or auto-playing video in any context other than a deliberate demo." | taste.md § Anti-patterns |
| A pure white background and pure black text | "No pure `#FFFFFF`, no pure `#000000`." | taste.md § Color |
| A centred hero | "Asymmetry over centeredness" | principles.md § 4 |
| Blue and purple used as two accents | "A design has one accent color used sparingly." | principles.md § 6 |

One problem no rule covers: at 390px the features and stats grids run past the screen edge. Capture reports it, and a good critique raises it as a judgment call, not a finding.

## What a good critique looks like

- **Verdict:** back to drawing board, since fixing the P0s means replacing the look. There's an **Answer** line and a **Fix first** line.
- **6 to 8 findings, mostly P0, grouped by rule.** Thirteen violations fit under the cap of eight because findings that share a rule or a fix are grouped.
- **Every Rule line passes the gate,** and every Where line names page text or a selector the capture recorded, such as `a.btn-primary` or `div.card`.
- **Not checked** lists the hero with its image loaded (the image URL doesn't resolve) and hover and focus states.

## The gate by hand

```bash
node ../skills/crit/scripts/check.mjs <round>/critique.md \
  --refs taste.md principles.md --evidence <round>/evidence [--verify <round>/verify.md]
```

A `FAIL` line means the critique quoted a rule or page text that isn't there or broke the format; with `--verify`, it also means the second critic disputed a finding or found one missing.
