# miles.ai — Brand & Design System

miles.ai is an AI marketing specialist for local service businesses (home services, roofing, dental, solar), judged on one thing: results. The design system reflects that: a monochrome brand where the only color on screen is information, and a hierarchy built around the owner's 30-second read.

## Design philosophy

- The brand is monochrome: Ink on Paper, or Paper on Ink. A miles.ai surface with no live data on it is fully black and white.
- Color is reserved for meaning. Green = a number moved the right way (a measured result — never branding, marketing headers, or empty states). Amber = needs attention. Red = failure/destructive/overspend. Blue = in progress, focus, links.
- Hierarchy follows the owner's 30-second read: verdict first ("are we on track"), then the four numbers that matter (leads, spend, booked jobs, revenue), then decisions waiting for approval, then details.

## Color

Core neutrals (everything is built from these):
- Ink `#111112` — logo, headings, primary buttons
- Graphite `#3F3F46` — body copy
- Mute `#8A8A92` — labels, secondary text, icons
- Line `#E6E6EA` — borders, dividers
- Canvas `#F4F4F5` — app/page background
- Paper `#FFFFFF` — cards, sheets, inputs

Signals (semantic only — one lightness, one chroma, four hues):
- Result Green `oklch(0.55 0.13 150)` / `#1B8552` — CPA at/under target, positive deltas, measured outcomes only
- Focus Blue `oklch(0.55 0.13 255)` / `#2B6FCB` — focus rings, links, in-progress
- Caution Amber `oklch(0.55 0.13 75)` / `#86651C` — budget warnings, needs review
- Alert Red `oklch(0.55 0.13 25)` / `#A45359` — failures, destructive actions, overspend
- Tints: `oklch(0.96 0.03 <hue>)` — badge and row backgrounds only, never text

Rules:
- Brand color is Ink. Primary action is an Ink-filled pill; signals never fill a button — they color text, figures, and badges.
- All four signals share lightness 0.55 / chroma 0.13 so no status shouts over another.
- Never place a signal color on a signal tint of a different hue.
- Dark mode: Ink becomes surface, Paper becomes text; signals shift to lightness 0.72, same hue.

## Typography

Load only: Archivo 400/600/700/800 + IBM Plex Mono 500.

- Hero — Archivo 800, 52–64px, −0.03em, line-height 1.05
- H2 — Archivo 700, 28–32px, −0.02em
- Body — Archivo 400, 16–17px, line-height 1.6, Graphite (never pure black), max 65ch
- Overline label — Archivo 600, 12–13px, uppercase, 0.1em tracking, Mute
- Numbers/metrics — IBM Plex Mono 500, always tabular; result figures may take Result Green (the only colored text)

## Surfaces & layout

- Canvas `#F4F4F5` page, Paper `#FFFFFF` cards, hairline Line borders, radius 12–16px (up to 20px on large dashboard cards), shadows no heavier than `0 1px 2px`
- Spacing on an 8px grid; section padding 96–128px vertical on marketing pages
- Links: Ink, underline on hover; never blue-by-default
- Buttons: pill radius (999px), Archivo 600 15px, 12px/22px padding; primary Ink fill, secondary Line border
- Dashboard (product UI) may use the Apple-language treatment: translucent Paper (`rgba(255,255,255,0.72)` + backdrop blur), system font stack for UI chrome, iOS-style toggles — same color and hierarchy rules apply

## Logo — the sweep-face mark

Structure: a squircle tile containing a split ring ("sweep") with two dot eyes.

- Tile: corner radius 27.5% of tile size
- Ring: diameter ~52% of tile; stroke 8% of tile
- Sweep: solid arc covering ~three quarters of the ring over the top; faint trail arc on the lower-left quadrant (22% opacity of the foreground color, or `#454548` on Ink / `#CFCFD2` on Paper)
- Eyes: two dots, diameter 8% of tile, gap 8% of tile, horizontally centered
- Wordmark: `miles.ai` in Archivo Bold, −0.02em, set at 44% of tile height, gap between tile and wordmark = 32% of tile

Usage:
- Monochrome only: Ink tile with Paper mark, or Paper tile with Ink mark. Never on an accent color.
- Minimum size 16px; below 20px drop the eyes and let the sweep alone carry it (favicon)
- Clear space: half the tile width on all sides of the lockup

Asset files live in `exports/` (svg/, png/, jpg/). Prefer the SVGs.

## Voice

Clean, matter-of-fact, results-first. Numbers do the talking; copy explains what happened and what to do next. No hype, no decoration, no emoji.
