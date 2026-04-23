---
name: hubspoke-brand
description: Brand kit for the Iowa Center Hub & Spoke scheduling platform. Use when designing, styling, or generating UI in the iowacenterhubspoke repo — covers the Hub Indigo / Spoke Teal / Warning Amber palette, Manrope + Inter + JetBrains Mono type stack, semantic color tokens, schedule-block patterns, map markers, iconography rules, and voice & tone. Always follow these tokens instead of inventing new colors, fonts, or spacing.
---

# HubSpoke Brand Skill

You are styling UI for **HubSpoke** (the Iowa Center Hub & Spoke scheduling platform). Follow the brand kit strictly — the visual system is already defined and shipped in `frontend/src/index.css`. Do not invent new colors, type, or spacing.

## When to read what

- **You need color values, fonts, or token names** → read `README.md` in this skill.
- **You're writing new CSS/Tailwind** → copy the variables in `tokens.css` or reuse the semantic tokens (`--hub`, `--spoke`, `--warn`, `--info`, `--danger`, `--progress`, `--ownership-internal`, `--ownership-partner`) that already exist in the repo.
- **You need the logo mark** → use `logo.svg`.
- **You want the full visual reference** → open `brand-kit.html` in a browser.

## Non-negotiable rules

1. **Never use raw Tailwind color classes** (`bg-blue-500`, `text-purple-600`, etc.) when a semantic token exists. Use `bg-hub`, `bg-spoke`, `bg-warn`, `bg-ownership-internal`, etc.
2. **Typography stack is fixed.** Manrope for all headings and display; Inter for body and UI; JetBrains Mono for every number, time, duration, ID, code, and HEX value.
3. **Schedule blocks are the signature pattern.** Class time = solid indigo with a 4px left border and small shadow. Drive time = gray with a dashed diagonal hatch pattern. Town-to-town warning = amber soft background with amber left border. Never reinvent these three looks.
4. **Icons are Lucide React only.** 1.5px stroke, 16–24px. No emoji in UI. No icon fonts. No custom icons unless a Lucide glyph truly doesn't exist.
5. **Map markers:** Hub is a 30px indigo pin. Spokes are 22px teal pins. Planned routes are dashed 1.5px indigo lines. Never use Google's default red drop-pin.
6. **Voice:** Sentence case everywhere, second person, dispatcher-style brevity. Name real cities ("Marshalltown"), not "the spoke location." Numbers in mono.
7. **Every interactive element must have a `data-testid` attribute.** (Repo convention.)
8. **Respect the hub-and-spoke metaphor.** Layouts that visualize the network should radiate from Des Moines. Don't use generic admin-template layouts.

## Tokens (quick reference)

See `tokens.css` for the full set. The essentials:

- `--primary` / `--hub` — Hub Indigo `#4F46E5` (239 84% 67%) — primary actions, hub location
- `--secondary` / `--spoke` — Spoke Teal `#0D9488` (168 80% 30%) — spoke locations, successful routes
- `--accent` / `--warn` — Warning Amber `#F59E0B` (38 92% 50%) — town-to-town, conflicts
- `--info` — Info Blue (217 91% 60%) — general status, scheduled
- `--progress` — Progress Green (142 71% 45%) — completed, improving
- `--danger` — Danger Red (0 84% 60%) — errors, destructive
- `--ownership-internal` — Iowa Center-owned (blue, 217 91% 60%)
- `--ownership-partner` — Partner-org-owned (purple, 280 65% 60%)

Every semantic token has a `-soft` variant for backgrounds. Use `bg-{token}-soft` + `text-{token}` (the strong variant) for chips and soft-filled badges.

## Radius

- `--radius` = `0.625rem` (10px). Cards and modals use this.
- Buttons and chips: 8px. Small inputs: 6px. Large feature cards: 12px.

## Spacing scale (Tailwind)

`4, 8, 16, 24, 32, 48, 64` px — use steps, not arbitrary values. Card padding `p-6`. Section gap `gap-8`. Container `max-w-7xl`.

## File index

| File | Purpose |
|---|---|
| `README.md` | Full written reference (palette, type, components, patterns, voice). |
| `tokens.css` | Copy-paste CSS variables matching `frontend/src/index.css`. |
| `logo.svg` | Modern HubSpoke mark (indigo). |
| `brand-kit.html` | Visual reference — open in browser for the full rendered kit. |
