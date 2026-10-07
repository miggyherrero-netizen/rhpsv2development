# Design backlog (ideas found during the redesign, deliberately NOT implemented)
They touch copy, naming, structure or behaviour, so each needs an owner decision first.

## Public site
- Add a skip-to-content link; use a real `<dialog>` for the piano dialog (and `role="dialog"` on shared `Modal` in `ui.tsx`).
- Replace third-party Pexels images in Restorations/Craft with the atelier's own photos, and use `next/image` (CLS).
- Hide the "Private Access" workshop/owner links from the public footer.
- Link the "Voices" section to the Facebook reviews.
- Review the new hero top/bottom scrims (the old code comment said "no overlay").

## Admin / kiosk
- Rename "Live Monitor" and "Client Curator"; split the long sidebar into collapsible groups.
- Loading skeletons and error states for admin lists; a mono-styled KPI component for dashboard numbers.
- Kiosk PIN pad: "Cancel / not you?" label. PIN pad and dashboard states were not screenshotted (need PIN login).

## Owner (My Desk)
- Mobile calendar: "Today" quick-jump and default to Agenda view on phones; week grid still scrolls sideways at 390px.
- Visible label for the "Detailed" capture button on mobile; skeleton loading; swipe-to-complete on task rows.
- Month-grid day cells are mouse-only clicks.
- Possible bug: calendar hour labels use `fmtTime` (Asia/Manila) on browser-local dates, so a non-Manila browser shows shifted hours.
- Use one name for "Personal Workspace" / "My Desk".

## Home Service
- `loading.tsx` / `error.tsx` per route (a `.svc-skeleton` class exists but is unused).
- Phone: one-tap Call / Directions on job and invoice cards; Schedule defaults to a day view instead of the 7-column grid.
- Rename the "More ▾" status filter on Jobs. `Chip`/`StatusChip` are colour + text only (no icons).
- Share pages (`/share/service`, quote/document views) were not restyled; invoice print preview not re-checked.

## Growth OS
- `loading.tsx` skeletons; mobile header with page title and a floating "Add inquiry"; group Today into Overdue / Due soon.
- One-tap call/WhatsApp on customer cards; step progress on the customer detail; sticky section index in Settings.
- Replace `window.confirm` for delete/merge with an in-page dialog. Lockout/blocked screens were not reviewed visually.
