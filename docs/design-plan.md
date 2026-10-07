# Design Plan: full-system redesign (ui-ux-pro-max)

Owner direction (2026-10-07): apply the `ui-ux-pro-max` skill across the whole system and let it
override the older per-area theme rules in CLAUDE.md where they conflict. This plan is the single
source of truth for that pass. Visual polish only: **no copy, naming, routes, data or behaviour changes.**
Copy/structure ideas found along the way go to `docs/design-backlog.md`, not into the code.

Still untouchable (not design): auth, `/api/live` session check, idempotent seeding, Dockerfile `public/`
copies, Manila-timezone helpers, schema (no schema changes in this pass).

## 1. Principles (every area)
Taken from the skill's priority list (accessibility, touch, performance, style, layout, type/colour, motion, forms, nav, data).

| Rule | Standard |
|---|---|
| Contrast | Text 4.5:1 (large 3:1), UI borders/icons 3:1, in the area's own mode |
| Touch | Targets >= 44x44px, >= 8px between targets (kiosk >= 64px) |
| Focus | Visible 2px ring + 2px offset on every interactive element, never removed |
| Motion | 150-250ms ease-out, transform/opacity only, honour `prefers-reduced-motion` |
| Type | Body 16px (dense tables 14px min), line-height 1.5, no text under 12px, `tabular-nums` for money/time |
| Spacing | 4/8px scale only; cards pad 16/20/24; section gaps 24/32/48 |
| Radius | Controls 10px, cards 14px, pills full; one value per role |
| Icons | SVG (lucide) only, sized 16/20/24, decorative ones `aria-hidden`, icon-only buttons have `aria-label` |
| States | Every list/table has loading, empty, error; hover + active + disabled on every control; `cursor-pointer` on clickables |
| Responsive | Mobile first, no horizontal page scroll at 360px, sticky bars respect safe area |
| Colour | Semantic tokens only (no raw hex in components), status never conveyed by colour alone |

## 2. Per-area direction
Each area keeps its own scoped token set (so areas can't leak into each other) but all share Section 1.
Palettes come from the skill's `--design-system` / `--domain color` output, checked for contrast.

| Area | Mode | Surface / text | Accent | Fonts |
|---|---|---|---|---|
| Public site + portal + login gate | Light, editorial luxury | paper `#FAFAF9`, linen `#F3F0EA`, card `#FFFFFF`, ink `#1C1917`, subtle `#57534E`, line `#E7E2DA` | Bronze `#A16207` (text), primary button `#1C1917` / white text, dark bands `#1C1917` with accent `#D6A24A` | Cormorant (display, >= 28px only) + Montserrat |
| Admin (Shop) + login + start + workshop kiosk | Dark, operations | bg `#0B1120`, surface `#111A2E`, raised `#1E293B`, line `#334155`, text `#F8FAFC`, dim `#94A3B8` | Green `#22C55E` (button text `#04210F`), info `#38BDF8`, warn `#FBBF24`, danger `#F87171` | Fira Sans + Fira Code for numbers |
| Owner (My Desk) | Dark, calm focus | bg `#0C1220`, surface `#131B2E`, line `#26324A`, text `#F1F5F9`, dim `#94A3B8` | Blue `#2563EB` (white text), violet `#A78BFA`, teal `#2DD4BF`, rose `#FB7185` | Figtree |
| Home Service | Dark graphite | bg `#0A0F18`, surface `#101826`, raised `#18233A`, line `#2A3850`, text `#F1F5F9`, dim `#94A3B8` | Sky `#0369A1` buttons (white text), `#7DD3FC` accent text, emerald `#34D399` success, rose `#FB7185` danger | Outfit (headings) + Work Sans, tabular numerals |
| Growth OS | Light, high legibility | keep `--gos-*` structure | Emerald `#059669` + blue `#2563EB` | Keep Atkinson Hyperlegible + Bricolage (skill's own "verify fit" rule: already the most accessible choice) |
| Workshop kiosk | Dark, glove-friendly | inherits Admin | Clock-in green, clock-out red `#EF4444`, targets >= 64px | Inter / Fira Sans |

The old "no brown/yellow in Personal Workspace" and "never change base `:root`" rules are superseded for this
pass (the owner chose the skill over them). Scoping is still kept: each area redefines tokens inside its own wrapper.

## 3. Phases
1. **Foundations** (done by the area owners below, in parallel, each in its own files):
   tokens, fonts, shared primitives (`ui.tsx`, `owner-ui.tsx`, `service-ui.tsx`, buttons, inputs, chips, cards, tables, empty states).
2. **Area passes** (parallel, file-disjoint):
   - A: public site, showroom, portal, login-gate (`public-site.tsx`, `public-*`, `showroom*`, `portal*`, `pub-fonts.ts`, `.pub-*` CSS)
   - B: admin (`admin-*`), login, `/start`, workshop kiosk, base `@theme`/surfaces in `globals.css`
   - C: owner (`owner-*`, `.ow-*` / `--color-ow-*` CSS)
   - D: home service (`service-*`, `.svc-*` / `--color-svc-*` CSS)
   - E: Growth OS (`src/components/gos/*`, `src/app/os/gos.css`)
3. **Integration**: full route sweep (desktop 1440 + mobile 390), axe contrast/a11y counts before vs after, `tsc`, `eslint`, `next build`, fix regressions.
4. **Handover**: commit to the working branch, summary with before/after screenshots. PR/merge only when the owner says so.

## 4. Verification (no "looks right" without evidence)
- Local throwaway Postgres + seeded data + `next dev` (scratchpad harness, not committed).
- Per route: screenshot (desktop + mobile), console errors, axe violations (colour-contrast, labels, names).
- Gate: `npx tsc --noEmit` clean, `npx eslint <changed>` clean, `next build` compiles.

## 5. Definition of done
Every logged-in route and public page renders in the new system at 1440 and 390px with no console errors,
zero new axe violations (target: zero colour-contrast failures), keyboard focus visible, and no behaviour change.
