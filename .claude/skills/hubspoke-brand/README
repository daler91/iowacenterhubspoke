# HubSpoke Brand — Reference

Complete written reference. Open `brand-kit.html` for the visual version.

---

## Identity

**Product:** HubSpoke Scheduler — the Iowa Center's internal scheduling platform for dispatching employees from a central hub in Des Moines to satellite classes across Iowa.

**Design identity:** *The "E1" Logistics Architect.* A precise, instrument-grade SaaS feel. Earthy Iowa roots expressed through a modern palette, not rustic textures.

**Four principles:**
1. **Clarity is king** — ambiguity in logistics is fatal; every pixel serves a purpose.
2. **Radiate from the hub** — Des Moines at the center; spokes extend outward; visuals follow the metaphor.
3. **Time is physical** — drive time has weight (dashed, gray); class time has energy (solid indigo).
4. **Iowa-grounded, not rustic** — soil, corn, sky as color roots; flat high-contrast SaaS execution.

---

## Palette

### Core

| Role | Name | HEX | HSL | Token |
|---|---|---|---|---|
| Primary | Hub Indigo | `#4F46E5` | `239 84% 67%` | `--primary` / `--hub` |
| Secondary | Spoke Teal | `#0D9488` | `168 80% 30%` | `--secondary` / `--spoke` |
| Accent | Warning Amber | `#F59E0B` | `38 92% 50%` | `--accent` / `--warn` |
| Foreground | Deep Soil | `#1E2733` | `215 25% 15%` | `--foreground` |
| Border | Drive Time Gray | `#E5E7EB` | `214 20% 90%` | `--border` / `--muted` |
| Background | Canvas White | `#F9FAFB` | `210 20% 98%` | `--background` |

### Semantic pairs

Every state gets a strong fill + soft background:

| Token | Use |
|---|---|
| `--hub` / `--hub-soft` | Primary actions, hub marker, active state |
| `--spoke` / `--spoke-soft` | Spoke locations, successful routes |
| `--warn` / `--warn-soft` | Town-to-town warnings, conflicts |
| `--info` / `--info-soft` | Scheduled, general info |
| `--progress` | Completed, trending up |
| `--danger` / `--danger-soft` | Errors, destructive actions |
| `--ownership-internal` / `-soft` | Iowa Center–owned (blue) |
| `--ownership-partner` / `-soft` | Partner-org–owned (purple) |

**Rule:** Never `bg-blue-500`, `text-purple-600`, etc. Always use the semantic token. The Tailwind config exposes these as `bg-hub`, `bg-hub-soft`, `text-hub-strong`, `bg-spoke`, `bg-warn`, `bg-ownership-partner`, etc.

---

## Typography

| Role | Font | Weight | Size | Use |
|---|---|---|---|---|
| H1 Display | Manrope | 700 | 36px, tracking -0.025em | Page titles |
| H2 Section | Manrope | 600 | 28px, tracking -0.02em | Section titles |
| H3 Card | Manrope | 600 | 22px | Card titles |
| Body | Inter | 400 | 16px, line-height 1.65 | Paragraphs, UI text |
| Caption/Label | Inter | 500 | 11.5px, uppercase, tracking 0.12em | Metric labels |
| Metric | Manrope | 800 | 40px, tabular-nums | Large numbers |
| Mono | JetBrains Mono | 400/500 | as needed | Times, IDs, HEX, durations |

**Stacks:**
- Headings: `font-family: 'Manrope', sans-serif;`
- Body: `font-family: 'Inter', sans-serif;`
- Code/data: `font-family: 'JetBrains Mono', ui-monospace, monospace;`

Every number in the UI should use `font-variant-numeric: tabular-nums`.

---

## Iconography

**Lucide React, exclusively.** Per-icon import: `import { Calendar, MapPin, Car } from 'lucide-react'`. 1.5px stroke, size 16–24px via Tailwind (`size-4`, `size-6`).

Common glyphs for this product:
- `CalendarDays` — calendar
- `MapPin` — location
- `Car`, `Route` — drive time, routing
- `UsersRound` — employees
- `GraduationCap` — class
- `Building2` — location/facility
- `TrendingUp` — analytics
- `FileSpreadsheet` — CSV import
- `TriangleAlert` — conflicts
- `Clock` — time
- `Repeat` — recurrence
- `CheckCircle2` — confirmed
- `Bell` — notifications
- `ShieldCheck` — RBAC/auth
- `Settings` — settings

**No emoji in product UI.** No icon fonts. If a Lucide glyph doesn't exist, leave a 16×16 empty square as a placeholder.

---

## Components

### Buttons

```tsx
// Primary
<button className="bg-hub hover:bg-hub-strong text-white rounded-lg px-4 py-2 font-medium transition-all">
// Secondary
<button className="bg-white border border-border text-foreground hover:bg-muted rounded-lg px-4 py-2 font-medium">
// Destructive
<button className="bg-danger-soft text-danger hover:bg-red-100 border border-red-200 rounded-lg px-4 py-2">
```

### Inputs

```tsx
<input className="rounded-lg border-border focus:border-hub focus:ring-hub shadow-sm bg-muted/50 px-3 py-2.5" />
```

Focus ring: 3px `hsl(var(--hub) / 0.15)`.

### Chips

Pill, `rounded-full`, `text-xs font-medium`, soft background + strong text:
```tsx
<span className="bg-hub-soft text-hub-strong px-2.5 py-0.5 rounded-full text-xs font-medium">
  Des Moines · Hub
</span>
```

### Cards

```tsx
<div className="bg-card rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow duration-200 p-6">
```

---

## Schedule blocks (signature pattern)

The most important pattern in the product.

### Class block
Solid indigo fill, white text, 4px darker-indigo left border, small shadow.
```css
background: hsl(var(--hub));
color: white;
border-left: 4px solid hsl(var(--hub-strong));
box-shadow: 0 1px 0 hsl(var(--hub-strong));
```

### Drive block
Gray repeating diagonal hatch, dashed border, muted text. Compact height (28–32px).
```css
background: repeating-linear-gradient(
  -45deg,
  hsl(var(--muted)),
  hsl(var(--muted)) 4px,
  hsl(var(--border)) 4px,
  hsl(var(--border)) 5px
);
border: 1px dashed hsl(214 15% 75%);
color: hsl(var(--muted-foreground));
```

### Town-to-town warning
Amber soft background, amber left border, amber-700 text.
```css
background: hsl(var(--warn-soft));
color: hsl(38 92% 32%);
border: 1px solid hsl(38 92% 82%);
border-left: 4px solid hsl(var(--warn));
```

Auto-insert drive blocks before and after any class that's not at the hub, sized to the actual drive time.

---

## Map markers

- **Hub marker:** 30px circle, `hsl(var(--hub))`, 3px white ring, subtle drop shadow. Label in Manrope 700 `--hub-strong`.
- **Spoke marker:** 22px circle, `hsl(var(--spoke))`, 3px white ring. Label in Manrope 600 ink-700.
- **Planned route:** 1.5px dashed line, `hsl(var(--hub) / 0.55)`, `stroke-dasharray: 4 4`.
- **Town-to-town leg:** solid 2px amber.

Never Google's red drop-pin. Never hand-draw markers inside the map tile — render as absolutely-positioned HTML overlays so the brand tokens apply.

---

## Voice & tone

**Do:**
- Write like a dispatcher: "Ames class at 9 am. 38 min drive. Leave Des Moines by 8:20."
- Surface the next decision. Every block of copy should answer "what do I do next?"
- Use second person: "Your Wednesday has two town-to-town trips."
- Name real cities — never "the spoke location."
- Sentence case everywhere (buttons, headings, labels — proper nouns excepted).
- Keep numbers in mono: `42h 15m`, `08:45`, `$1,240`.

**Don't:**
- No corporate fluff ("empowering your scheduling journey").
- No emoji in UI.
- No acronym soup on user-facing surfaces.
- No Title Case buttons.
- No vague errors — always say what failed and what to do.
- No gradients for meaning — color is semantic.

---

## Spacing & radius

- Scale: **4, 8, 16, 24, 32, 48, 64** px.
- Card padding: `p-6` (24px).
- Section gap: `gap-8` (32px).
- Container: `max-w-7xl`.
- Radius base: `--radius` = `0.625rem` (10px). Buttons `8px`, inputs `6px`, cards `10–12px`, chips full-pill.

---

## Logo

See `logo.svg`. A central indigo hub with six asymmetric spokes radiating to nodes of varied sizes. One orbital arc suggests motion. Always paired with the wordmark `hubspoke` in Manrope ExtraBold (800), all-lowercase, with an optional muted `.scheduler` suffix.

**Clear space:** minimum of 1× mark height on all sides.
**Minimum size:** 24px mark height, 18px wordmark type.
**Color:** indigo on light, white on dark, white on indigo.
