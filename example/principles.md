# Principles: Spark design

Higher-level than taste.md. Principles describe *what good looks like* — taste describes the specific rules that follow from them. When taste.md and principles.md appear to conflict, principles win; update taste.md to follow.

---

## 1. Honesty over polish

Show real state, not optimistic mockups. If a list is empty, render the real empty state. If a process takes 30 seconds, show 30 seconds — don't fake a 2-second progress bar. Designs that look better than they perform train users to distrust the product.

## 2. Density earns space

Whitespace is a tool, not a default. Content earns its room; chrome does not. A page that looks "empty and spacious" usually means we're hiding the actual product. A page that looks "dense and confident" usually means we trust the user to read.

## 3. One typographic scale

Every page reuses a fixed set of type sizes. New sizes do not get invented per screen. If a layout needs a size that doesn't exist, the layout is wrong — not the scale.

## 4. Asymmetry over centeredness

Centered hero compositions are the default of someone who didn't decide. Break the grid intentionally to draw attention to the one thing that matters. If everything is centered, nothing is emphasized.

## 5. No surprise

Visible state changes must have a cause the user took. Animations, toasts, banners, modals, redirects — every one must trace back to a user action within the last 500ms. Time-based interruptions (auto-popups, scroll-triggered overlays, idle-state nags) violate this principle.

## 6. Single accent

A design has one accent color used sparingly. If everything is highlighted, nothing is. The accent earns its visibility by being rare.

## 7. Critique punches up

Critique is for the work, never the maker. A critique without specifics is gossip. A critique without acknowledgment of what works is destructive. Always name what's strong before what's broken.
