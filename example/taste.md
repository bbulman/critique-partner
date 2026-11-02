# Taste: Spark design

Opinionated, specific. These rules describe what *this team* does and doesn't do. They are not universal truths. Update them when team taste evolves; do not relax them in individual reviews.

---

## Typography

- Use only **Inter** or **Manrope**. Never Arial, Helvetica, system-ui, Times, Georgia, or any serif as body text.
- One typographic scale per page: max 6 sizes. If you need a 7th, you don't.
- Tracking: -0.01em on display sizes (≥32px), default on body, +0.02em on small caps and labels.
- Line height: 1.15 for display, 1.5 for body, 1.4 for UI labels.

## Color

- Calibrated grayscale base. The only accent is a single warm orange `#E85D04`. Use it for primary CTAs and rare emphasis — not decoration.
- **Never use blue, teal, or purple gradients.** No "AI-shimmer" effects.
- No gradients on text under any circumstance.
- Backgrounds are off-white `#FAFAF7` or near-black `#0A0A0A`. No pure `#FFFFFF`, no pure `#000000`.

## Density & spacing

- Editorial spacing. Minimum 24px between sections; cards have at least 32px internal padding.
- Density over whitespace, but **never** below the minimums above.
- No full-bleed hero images with text overlays. Text and image must occupy their own grid cells.

## Buttons

- Primary button is a solid pill (border-radius: 999px) with a 1px border in a slightly darker shade of its own color.
- Secondary is a borderless text button with an underline on hover.
- **No outlined-rectangle buttons.** No "ghost" buttons that disappear on dark backgrounds.

## Shadows & borders

- **Never use drop shadows for elevation.** Use a 1px solid border (`#E5E5E0` on light, `#1F1F1F` on dark) instead.
- Inner shadows are forbidden.
- Border radius: 4px for inputs, 8px for cards, 999px for pills. No other values.

## Voice & copy

- Direct, opinionated, slightly contrarian. Sentences earn their length.
- **Banned words in marketing copy:** "delight", "seamless", "powerful", "revolutionary", "leverage", "synergy", "unlock", "transform" (when used as a marketing verb).
- No exclamation points outside of error states and confirmations.

## Anti-patterns (never ship these)

- Glassmorphism (blurred semi-transparent panels).
- Animated emojis or auto-playing video in any context other than a deliberate demo.
- Skeleton loaders that pulse — use a single static state instead.
- Notification dot UI on tabs that haven't been earned (no "engagement bait").
