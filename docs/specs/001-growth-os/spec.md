# Feature 001: Herrero Growth OS (v1)

**Status:** Approved v1.0 (Robert, 4 Oct 2026: "okay ko sa A" = spec OK + login lockout allowed)
**Created:** 2026-10-04
**Branch:** `001-growth-os` (created at start of sdd-execute, never `main`)
**Sources (no new features added):** MASTER-PLAN v3 · CLICK-SPEC 01–13 (+ 4 Oct update notes) · REVIEW-CRITIQUE-A11Y · BUSINESS-FACTS · Robert's decisions of 4 Oct: no offline mode, no push notifications, ads sync prepared but OFF, Growth OS only ADDS to the existing app.
**Repo location later:** `docs/specs/001-growth-os/spec.md`
**v0.2 changes:** fixed 6 critical + 26 important + 11 minor findings from the independent review (job unit, balance rule, status table, owner-only access, login left unchanged, ad-spend proration, missing ACs). Small scope cuts by the assistant to save build time are listed in Out of Scope.

---

## Problem Statement

Robert runs R. Herrero Piano Sales & Services alone: ads, Messenger replies, quotes, travel costs, visits, payments and repeat tuning. Nothing holds customers, pianos, quotes and money in one place, so replies get late, travel gets undercharged, balances and re-tunes get forgotten, and he cannot tell if ad spend turns into paid jobs. He needs one app on phone and desktop that remembers, computes and drafts for him, so he only does the next action.

## Goals

- G1: Every new inquiry shows as "waiting" and becomes overdue at 1 hour, until Robert marks it replied.
- G2: A quote is computed and ready to copy in under 1 minute, with travel cost from the formula, never silently ₱0.
- G3: Every unpaid job balance stays visible until it reaches ₱0 (zero forgotten balances).
- G4: Every completed tuning sets the piano's next due date; the piano appears in "Tuning due" 14 days before it.
- G5: For any period, Robert sees ad spend, inquiries, paid jobs, ₱ collected and cost per paid job; missing numbers show "Not recorded", never ₱0.
- G6: Every screen works at 320px wide (phone) and 1280px (desktop).

## Non-Goals

- Sending, reading or receiving Messenger messages inside the app.
- Push notifications, SMS or email reminders (reminders show inside the app only).
- Offline mode (nothing saves without internet).
- Ads connection switched ON (prepared but OFF; manual entry + CSV only).
- Changing ads from the app; automatic messages to customers.
- Staff accounts, accounting, tax.
- Changing, moving or deleting any existing screen, login behaviour, table or data of the current app (showroom, admin, owner workspace, client portal, workshop kiosk).

## Users and Context

**Primary user:** Robert, owner and only worker. Only his owner account may use Growth OS.
**Secondary users:** Customers never use the app; they only receive text Robert copies and pastes. Other account types already in the app (client portal links, workshop workers) must never reach Growth OS.
**Usage context:** Phone on the road (one hand, sunlight); desktop for planning the week.
**User mental model:** "Customer" is the center; each piece of paid work is a "job". Status words: New, Replied, Quoted, Booked, Completed, Paid, Lost. Money in pesos (₱). Language: Bisaya/English mix. Time: Asia/Manila. Week starts Monday.

## Core Rules (apply to all stories)

### R1. Customer and Job
- A **customer** can have many **jobs** over time (first tuning, re-tune next year, a repair).
- A **job** starts when Robert makes a quote, books a visit, or records an Advance payment for a customer. Each job has its own status (R3). It holds: quote versions, visit(s), Done details, final price, payments, balance.
- **Customer status** = status of the customer's latest job that is not only a Draft quote; if no such job → New or Replied (inquiry stage); if all jobs are Paid and nothing is open → Paid. A Draft-only job never changes the customer status.
- A repeat inquiry for an existing customer (AC-2.12) or a "yes" to a tuning invite puts the customer back to the inquiry stage (New/Replied) until a new job's quote is sent.
- **Paid job** = a job whose balance reached ₱0; it counts in the period of the date of the payment that brought it to ₱0.

### R2. Balance
- **Job price** = Done final price if Done is saved; otherwise the latest sent quote total; otherwise no price ("Set price first").
- **Balance** = job price − sum of that job's payments, **not counting tips** (exact to the centavo). Tips are stored separately on the job and DO count in Growth's "₱ collected".
- Payments before Done are allowed ("Advance"); the job shows "Paid ahead ₱<amount>" until a price exists.
- If balance < 0 after a price change → "Overpaid by ₱<amount>" shown on the job (Tip / Fix choice, see Story 7).

### R3. Status transitions (only Robert's taps change status)
| From | To | Trigger |
|---|---|---|
| (none) | New | + Add inquiry saved |
| New | Replied | "Yes, sent" or "Mark replied" |
| Replied | New | "Undo replied" |
| New / Replied | Quoted | quote "Yes, sent" or "Mark quote sent" |
| New / Replied / Quoted | Booked | visit booked (without a quote: warning "No quote yet", still allowed) |
| Booked | Quoted | Cancel visit → "Back to Quoted", or No-show |
| Booked | Completed | Done saved, balance > 0 |
| Booked | Paid | Done saved and balance = 0 (Paid full, or fully prepaid by Advance) |
| Completed | Paid | payment brings balance to 0 |
| Paid | Completed | a payment edited/deleted so balance > 0 again |
| Paid / Completed / Lost | Quoted | "New quote anyway" (starts a NEW job; old jobs unchanged) |
| Paid / Completed / Lost | New | repeat inquiry for this customer (AC-2.12) or invite answered yes (AC-8.8): inquiry stage, no new job yet |
| New / Replied (repeat customer) | Quoted | quote on the new job marked sent |
| any | Lost | Lost + reason |
| Lost | previous status | Reopen |
"Customer replied again" ("She replied") never changes status; it only adds a reply task. There is no "Qualified" status.

### R4. Reminders (inside the app only)
| Reminder | Due when | Shows in Today section | Overdue when |
|---|---|---|---|
| Reply | inquiry time + 1 h (setting) | Reply first | past due |
| No quote yet | Replied + 1 day (setting) with no sent quote | Follow-ups due | past due |
| Quote not sent | quote copied, not marked sent | Follow-ups due | immediately |
| Quote follow-up | quote sent + 1 day (setting) | Follow-ups due | past due |
| Visit to confirm | day before visit, 6 PM (setting) | Visits to confirm | visit day reached, not confirmed |
| Next visit | visit day, 7 AM (setting) | Next visit | — (not counted as overdue) |
| Visit happened? | visit end time passed, no Done | Do this first / Next visit | past due |
| Unpaid | 3 days after Done or after the last payment (setting), then every 7 days | Money to collect | past due |
| Tuning due | next due − 14 days (setting) | Tuning due | next due date passed |
| Tuning follow-up | invite sent + 7 days, max 1 | Tuning due | past due |
- **Red badge count on the Today tab** = number of overdue items, excluding snoozed ones.
- Due/overdue states recompute when the app opens, when the app comes back to the front, and every 60 seconds while it is open.
- Lost customer: all customer reminders stop; **piano tuning reminders continue** unless the piano is retired (Spec 07).

### R5. Money math
- Fuel per km = diesel ₱/L ÷ km per L. Travel = km × (2 if round trip, 1 if one way) × (fuel per km + vehicle cost per km), rounded **up** to the nearest ₱10 (setting, default on).
- Travel counted once per visit even with several pianos.
- All amounts exact to the centavo; quotes store a snapshot of the prices used.

### R6. Ad spend periods
- Spend is entered as a date range (start, end, amount, ad or "Whole campaign", optional conversations count).
- For any period, a range counts **pro-rata by day** (amount ÷ days in range × days inside the period), rounded to the centavo.
- "Whole campaign" spend counts in total Ad spend and shows as its own row "Whole campaign (not split by ad)" in the by-ad table.
- Periods: This week (Mon–Sun), Last week, This month, Custom; all Asia/Manila.

## User Stories

### Story 1: Use Growth OS with the existing login (Spec 12A)
**As** Robert **I want** to use my existing login **so that** I have one account and nothing old breaks.
- [ ] **AC-1.1** Given Robert is signed in with the existing login When he opens the Growth OS address Then Today shows (a return-to-page redirect is used only if the existing login already supports it)
- [ ] **AC-1.2** Given a signed-out visitor When they open any Growth OS page or call any Growth OS action Then they are sent to the login page and no Growth OS data is returned
- [ ] **AC-1.3** Given a signed-in account whose role is not "owner" (the existing user role field), or a workshop/portal visitor When they open any Growth OS page or call any Growth OS action Then access is refused (403) and no data is returned
- [ ] **AC-1.4** Given the existing login, session length and sign-out behaviour When Growth OS is added Then they behave exactly as before (existing app tests still pass), except the one approved change in AC-1.5
- [ ] **AC-1.5** Given 5 wrong password tries for the same email within 15 minutes When a 6th try is made within 15 minutes of the 5th Then sign-in is refused even with the correct password and "Too many tries. Try again in 15 minutes." shows; after 15 minutes a correct password works and the counter resets (Robert approved this one change to the existing login, 4 Oct)

### Story 2: Add an inquiry (Spec 01)
**As** Robert **I want** to add a new inquiry in about 5 seconds **so that** no Messenger chat is forgotten.
- [ ] **AC-2.1** Given Robert is on Today, Customers, Work, Growth or a customer record When he taps "+ Add inquiry" Then a form opens with the cursor in Name (phone: bottom sheet; desktop: right panel 480px)
- [ ] **AC-2.2** Given Name is filled When he taps Save Then the customer is created with status New, he is taken to the new record, and a toast says "<Name> added. Reply reminder set for <time+1h>."
- [ ] **AC-2.3** Given Name is empty When he taps Save Then nothing is saved and "Add a name so you can find this customer later." shows under Name
- [ ] **AC-2.4** Given an existing customer whose name matches after ignoring case and extra spaces When he taps Save Then "You already have <Name> (<area>, last job <date>). Same person?" shows with "Yes, open her record" (nothing created) and "No, add new" (creates new)
- [ ] **AC-2.5** Given "Came from" = Messenger When the form shows Then "Which ad?" offers Photo 01 · Creative 02 Grand · Creative 03 Upright · Don't know · Not from an ad, default "Don't know"; for other "Came from" values it is hidden
- [ ] **AC-2.6** Given "Which ad?" = Don't know When saved Then the customer shows a "No ad tag" badge
- [ ] **AC-2.7** Given something is typed When he presses Cancel, Esc, swipes down or taps outside Then "Discard this inquiry?" shows with "Keep editing" as default; given nothing typed Then it closes at once
- [ ] **AC-2.8** Given there is no internet When he taps Save Then nothing is saved, everything typed stays, and "No internet. Your typing is kept — tap Save again when you have signal." shows
- [ ] **AC-2.9** Given a server error When he taps Save Then everything typed stays and "Couldn't save. Your typing is kept. Try Save again." shows
- [ ] **AC-2.10** Given Save was tapped When the save is in progress Then the button shows "Saving…" and a second tap does nothing
- [ ] **AC-2.11** Given Name has 60 characters or Note has 500 When he types more Then no more is accepted and the counter shows the limit
- [ ] **AC-2.12** Given "Came from" = Repeat customer and a customer with the same name has a piano When saved Then the new inquiry is linked to that existing customer and piano instead of a new record (after the AC-2.4 confirm)
- [ ] **AC-2.13** Given the form When Robert taps "+ Add phone" Then a phone field appears; the phone is optional

### Story 3: Reply to a customer (Spec 02)
**As** Robert **I want** ready reply text and a reminder of who waits **so that** I reply within 1 hour.
- [ ] **AC-3.1** Given a New customer When Robert taps "Copy reply" Then the template for status + service (General template if none) with the name filled in (area line dropped if area empty) is copied and "✓ Copied" shows for 2 s
- [ ] **AC-3.2** Given Copy reply or Open Inbox was tapped When the app becomes visible again within 30 minutes Then "Did you send it?" shows; "Yes, sent" sets Replied and logs the time; "Not yet" changes nothing; ignored for 30 s it disappears with no change
- [ ] **AC-3.3** Given a New customer When Robert taps "Mark replied" Then status becomes Replied, same as "Yes, sent"
- [ ] **AC-3.4** Given a New customer added at 9:12 When it is 10:12 or later and not replied Then the Today row shows "✕ Over 1 hour, reply now" with red edge, icon and text; at 24 h or more it shows "1 day"
- [ ] **AC-3.5** Given clipboard copy is blocked When Robert taps Copy Then a sheet shows the text selected with "Long-press → Copy" and nothing is marked
- [ ] **AC-3.6** Given any status When Robert taps "Lost" and picks a reason (Too expensive · No reply from customer · Went with someone else · Just asking · Other) Then status becomes Lost, customer reminders stop, the customer leaves Today (piano tuning rows excepted, R4), and Undo shows for 10 s
- [ ] **AC-3.7** Given a status change older than 10 s When Robert opens the record's Activity log Then an "Undo" for that change is available and restores the previous status
- [ ] **AC-3.8** Given "Change text" When Robert edits and copies Then the edited text is used for this customer only; "Save as my default for <status> + <service>" replaces the template
- [ ] **AC-3.9** Given a Quoted or Booked customer messages again When Robert taps "She replied" Then a "Reply" task appears with a fresh waiting timer and the status does not change
- [ ] **AC-3.10** Given nobody is waiting When Today shows Then Reply first shows "All replied ✓" collapsed; reply text is limited to 1,000 characters
- [ ] **AC-3.11** Given Open Inbox is tapped When it opens Then the Business Suite inbox opens outside the app; if it fails "Couldn't open the inbox. Open Messenger yourself — your reply is copied." shows

### Story 4: Make and send a quote (Spec 03)
**As** Robert **I want** the travel cost computed for me **so that** I never undercharge for distance.
- [ ] **AC-4.1** Given Tuning ₱3,000, 18 km, round trip, diesel ₱110/L, 10 km/L, vehicle ₱4/km When computed Then Travel = ₱540 and Total = ₱3,540
- [ ] **AC-4.2** Given diesel ₱115/L, 10 km/L, vehicle ₱4/km, 18 km round trip When computed Then raw travel ₱558 is rounded up to ₱560
- [ ] **AC-4.3** Given vehicle cost blank, 18 km round trip, ₱11/km fuel When computed Then travel = ₱396 → ₱400 and "Vehicle cost not set — travel may be too low. Set in Settings." shows with icon + text
- [ ] **AC-4.4** Given one way, 18 km, ₱11 + ₱4/km When computed Then Travel = ₱270
- [ ] **AC-4.5** Given km is empty When the sheet shows Then Copy is disabled with hint "Enter km (0 if walk-in)"; given km = 0 Then the Travel line is hidden
- [ ] **AC-4.6** Given km > 200 When entered Then "200+ km — correct?" is asked once
- [ ] **AC-4.7** Given a selected service has no price set When the sheet shows Then that line shows a "Set price" input and Copy is disabled until it is filled; after filling, "Save as default price?" is offered
- [ ] **AC-4.8** Given total ≤ ₱0 When Robert tries to copy Then it is blocked with "Total must be above ₱0."; a discount larger than the subtotal is refused
- [ ] **AC-4.9** Given a quote When Robert taps "Copy quote" Then the customer text shows only lines with an amount, from: Tuning, Cleaning, Repair (all repair/parts lines grouped into one), Travel, Meals, Discount (as "Discount −₱<amount>"), Total, plus "Valid 7 days" and payment methods; it never shows km, per-km math or phone numbers
- [ ] **AC-4.10** Given Meals is switched on When computed Then ₱150 is added by default and the amount is editable for this quote only
- [ ] **AC-4.11** Given two pianos for one visit When Tuning ×2 is added Then both service lines count and travel counts once
- [ ] **AC-4.12** Given Copy quote is tapped Then the quote is saved as Draft v1; "Save as draft" saves without copying
- [ ] **AC-4.13** Given "Did you send the quote?" When Robert taps "Yes, sent" or "Mark quote sent" Then status becomes Quoted and the log shows "Quote ₱<total> sent <time>"; When "Not yet" Then a "Quote not sent" row shows in Follow-ups due
- [ ] **AC-4.14** Given a sent quote When diesel price changes in Settings Then the old quote keeps its numbers; only new quotes use the new price
- [ ] **AC-4.15** Given a sent quote When Robert changes it Then a new version is saved, the old version stays in the log, the customer text starts "Updated quote", and only the latest sent version counts in Money and Growth
- [ ] **AC-4.16** Given a quote sent more than 7 full days ago and not accepted When the record opens Then "Quote expired" shows with Resend (same amounts, new date) and Change
- [ ] **AC-4.17** Given a Quoted customer When Robert taps "Customer said OK" or books a visit Then the quote counts as Accepted

### Story 5: Book a visit (Spec 04)
**As** Robert **I want** to lock a day and time without double-booking **so that** I save trips and never miss a visit.
- [ ] **AC-5.1** Given a customer When Robert picks a date (next 14 days strip or "Other date"), a time (8 AM · 10 AM · 1 PM · 3 PM · Other) and a length (1 h · 2 h · 3 h · Half day = 4 h; Tuning defaults to 2 h) and taps Book Then status becomes Booked and the card shows date, time and area
- [ ] **AC-5.2** Given another visit overlaps the new visit's start–end When Robert taps Book Then "Overlaps with <name>. Book anyway?" shows with "Book anyway" and "Pick another time"
- [ ] **AC-5.3** Given another booked visit in the same area within the 14-day strip When choosing a date Then a hint "You have <n> visit(s) in <area> on <date>" shows
- [ ] **AC-5.4** Given a past date When Robert tries to book Then it is blocked with "Pick today or later"; "Log past visit" records a past visit without reminders
- [ ] **AC-5.5** Given a customer without a sent quote When Robert books Then "No quote yet" warning shows and booking is still allowed
- [ ] **AC-5.6** Given Book saved When the card shows Then "Copy confirmation" (date, time, total) and Open Inbox are offered
- [ ] **AC-5.7** Given a booked visit When Robert reschedules Then the old time stays in the log, reminders move, and "Copy new schedule" is offered
- [ ] **AC-5.8** Given a booked visit When Robert taps Cancel visit Then "Cancel or Lost?" offers "Back to Quoted" and "Lost" (reason)
- [ ] **AC-5.9** Given a booked visit's end time has passed without Done When Today opens Then "Did the <date> visit happen?" shows with Done · Reschedule · No-show; No-show sets Quoted and adds a follow-up due 1 day later
- [ ] **AC-5.10** Given the day already has 3 visits When a 4th is booked Then "4 visits <date> — busy day." shows and booking is still allowed
- [ ] **AC-5.11** Given a visit tomorrow When Robert taps "Confirmed with customer" Then it leaves Visits to confirm
- [ ] **AC-5.12** Given a Lost customer When the record shows Then Book is hidden

### Story 6: Job day → Done (Spec 05)
**As** Robert at the customer's house **I want** to record the job in a few taps **so that** I remember the piano and get paid.
- [ ] **AC-6.1** Given a booked visit When the Job day screen opens Then it shows customer, area, time, quote total and buttons Open Maps · I'm on my way · Start job · Done ✓ (56px)
- [ ] **AC-6.2** Given Open Maps When tapped Then Google Maps opens with the address text (no location stored)
- [ ] **AC-6.3** Given "I'm on my way" When tapped Then "Hi <name>, on the way na ko, mga <minutes> mins 🙂" is copied (minutes editable, default 20) with Open Inbox
- [ ] **AC-6.4** Given Start job When tapped Then the start time is saved on the job
- [ ] **AC-6.5** Given Done ✓ When tapped Then the Done sheet opens with done items pre-ticked from the quote, final price = latest quote total, piano, notes, photos (max 5), Paid now? (Paid full · Paid part · Not yet), next tuning (default 1 yr)
- [ ] **AC-6.6** Given the final price differs from the quote When Robert changes it Then a reason (Extra repair / Less work / Discount) is required; if higher, "Tell <name> about the change?" offers Copy text
- [ ] **AC-6.7** Given "Paid full" When saved Then a payment of the full balance is recorded with the method chosen in the sheet (default Cash) and status becomes Paid
- [ ] **AC-6.8** Given "Paid part" When saved Then amount and method fields (Story 7) must be filled, the payment is recorded and status is Completed
- [ ] **AC-6.9** Given "Not yet" When saved Then status is Completed and the toast says "Job done ✓. Next tuning <month year>."; "Copy thank you" is offered
- [ ] **AC-6.10** Given Tuning was ticked When Done is saved Then the piano's last tuned = visit date and next due is set; if Tuning was unticked Then last tuned is not changed
- [ ] **AC-6.11** Given no piano chosen When Done is saved Then it saves and the customer gets a "No piano details" badge
- [ ] **AC-6.12** Given a photo is added When saved Then it is stored at ≤ 500 KB with the label "Photo <n> of <customer>'s <piano>, <date>" (editable), visible only to Robert
- [ ] **AC-6.13** Given a photo upload fails When Robert saves Then the job still saves without that photo and "Photo not uploaded — try again" shows on that photo
- [ ] **AC-6.14** Given camera permission is denied When adding a photo Then "Allow camera in phone settings, or pick from gallery." shows
- [ ] **AC-6.15** Given Done was saved by mistake When Undo (10 s) or "Undo done" in the log is tapped Then the job returns to Booked and any payment recorded in that same Done sheet is removed (other payments stay)
- [ ] **AC-6.16** Given a job continues next day When Robert taps "Continue tomorrow" Then a second visit is booked for the same job and Done stays available only on the last visit

### Story 7: Record a payment (Spec 06)
**As** Robert **I want** to log money in 5 seconds **so that** no balance is forgotten.
- [ ] **AC-7.1** Given a job with balance ₱4,310 When Robert records ₱4,310 Then the job is Paid, the toast says "₱4,310 paid in full ✓" and the Money to collect row disappears
- [ ] **AC-7.2** Given balance ₱4,310 When Robert records ₱2,155 Then status stays Completed with badge "Balance ₱2,155", toast "₱2,155 recorded. ₱2,155 left.", and the Unpaid reminder is due 3 days later, then every 7 days
- [ ] **AC-7.3** Given balance ₱4,310 When Robert records ₱4,810 Then "₱500 more than balance. Tip / extra work / mistake?" shows; Tip saves ₱4,310 as payment + ₱500 as tip (balance ₱0, job Paid); Extra work raises the final price by ₱500 with reason "Extra repair" (balance ₱0, job Paid); Fix amount returns to the field
- [ ] **AC-7.4** Given amount empty or 0 When Save Then it is blocked with "Enter amount."
- [ ] **AC-7.5** Given the sheet When it opens Then amount defaults to the balance with chips Full · Half, method defaults to Cash (Cash · GCash · Maya · Bank · Other), date defaults to today and may be today or earlier but not later, reference number optional; card/bank account numbers are never asked
- [ ] **AC-7.6** Given a job with no price yet When Robert records ₱1,000 Then it is saved as Advance and the job shows "Paid ahead ₱1,000"; when Done is later saved at ₱3,540 Then the balance is ₱2,540
- [ ] **AC-7.7** Given a payment is edited or deleted When confirmed Then the balance recalculates, the log shows "edited", and a Paid job with balance > 0 returns to Completed
- [ ] **AC-7.8** Given payments exist When Growth totals ₱ collected Then it counts by payment date, not job date
- [ ] **AC-7.9** Given a balance row When Robert taps "Copy friendly reminder" Then a soft-tone payment reminder with name and balance is copied
- [ ] **AC-7.10** Given a customer with payments When marked Lost Then the payments stay and the warning "This customer has payments recorded" shows

### Story 8: Piano + re-tune (Spec 07)
**As** Robert **I want** pianos due for tuning to come back to me with invite text **so that** past customers bring ₱0-ad revenue.
- [ ] **AC-8.1** Given a piano When saved Then it holds nickname, type (Upright · Grand · Digital · Not sure), optional brand/model/serial, location, interval (6 mo · 1 yr · 1.5 yr = 18 months · 2 yr; default 1 yr), last tuned, next due, notes, photos, history
- [ ] **AC-8.2** Given last tuned 2025-10-22 and interval 1 yr When saved Then next due = 2026-10-22; given a date that does not exist in the target month (e.g. Feb 29) Then the last day of that month is used
- [ ] **AC-8.3** Given next due is 14 days or less away, or already past When Today opens Then the piano shows in Tuning due ("Overdue since <date>" sorted first) with Copy invite
- [ ] **AC-8.4** Given Copy invite then "Yes, sent" When saved Then the log shows "Invited <date>"; if no answer for 7 days Then 1 follow-up row shows; after that nothing until 3 months later (max 2 messages per cycle)
- [ ] **AC-8.5** Given the customer says not now When Robert taps Snooze 1 / 3 / 6 months Then the piano leaves Tuning due until then
- [ ] **AC-8.6** Given Robert changes the interval or edits next due by hand When saved Then the new date shows in a toast
- [ ] **AC-8.7** Given a piano is retired When saved Then its reminders stop and history stays; given it is moved to another customer Then its history moves with it
- [ ] **AC-8.9** Given two piano records for the same piano When Robert picks Merge on a piano Then one piano is kept with both histories joined
- [ ] **AC-8.8** Given a customer replies yes to an invite When Robert taps Make quote Then a new job's quote opens prefilled with the last km and service

### Story 9: Today (Spec 08)
**As** Robert **I want** to see only what I must do now, in order **so that** nothing slips.
- [ ] **AC-9.1** Given open items When Today opens Then "Do this first" shows the single most urgent item: overdue reply > visit happened? > visit within 2 h > overdue balance > follow-up > tuning due
- [ ] **AC-9.2** Given items When Today opens Then sections show in order Reply first · Next visit · Visits to confirm · Follow-ups due · Money to collect · Tuning due · 3 to check, each as a heading with its count, and empty sections are hidden
- [ ] **AC-9.3** Given overdue items (R4) When any Growth OS screen shows Then the Today tab shows a red badge with the count, excluding snoozed items
- [ ] **AC-9.4** Given no customers at all When Today opens Then "No customers yet. Tap + Add inquiry when someone messages you." shows
- [ ] **AC-9.5** Given customers but nothing due When Today opens Then "All caught up ✓ — next visit <date, time>" shows (or without the visit part if none)
- [ ] **AC-9.6** Given loading failed When Today opens Then "Couldn't update. Try again" shows with Retry and "All caught up" is never shown
- [ ] **AC-9.7** Given a section has more than 5 items When shown Then the top 5 show plus "Show all (<n>)"
- [ ] **AC-9.8** Given a row's "⋯" or swipe left When Robert picks Snooze 1 h · Tomorrow · Lost Then the row hides until then (or goes Lost), and "<n> snoozed" shows
- [ ] **AC-9.9** Given a row's main button When tapped Then the action runs directly without opening the record
- [ ] **AC-9.10** Given data-quality issues ("No ad tag", "Possible duplicate", "No piano details") When any exist Then "3 to check" lists up to 3 of them with Fix (list refreshed each Monday)

### Story 10: Work (Spec 09)
**As** Robert at my desk **I want** quotes, visits and balances in lists **so that** I can plan my week.
- [ ] **AC-10.1** Given quotes When Work → Quotes opens Then the filters are Draft, Sent, Accepted, Expired and Lost; default sort is oldest waiting first (option: highest ₱); the bar shows "<n> waiting · ₱<total>"
- [ ] **AC-10.2** Given visits When Work → Schedule opens Then phone shows an agenda (Today, Tomorrow, This week, Later) and desktop shows a Mon–Sun 7 AM–7 PM week view plus a list, with area tags like "Lanang ×2"
- [ ] **AC-10.3** Given balances When Work → Money opens Then "To collect" lists balances oldest first with total "₱<n> outstanding", and "Received" shows this week/month by method
- [ ] **AC-10.4** Given no payments recorded When Received shows Then "Not recorded yet" shows, not ₱0
- [ ] **AC-10.5** Given a month When Robert taps "Download CSV" Then a CSV of that month's payments (date, customer, amount, method, reference) downloads, with cells starting with = + - @, tab or carriage return made safe
- [ ] **AC-10.6** Given more than 50 rows When a list shows Then it pages by 50 with search on top

### Story 11: Growth (Spec 10)
**As** Robert **I want** to see if ads bring paid jobs and what each cost **so that** I spend ad money wisely.
- [ ] **AC-11.1** Given period chips This week · Last week · This month · Custom When one is chosen Then all numbers use that period (R6)
- [ ] **AC-11.2** Given no ad spend entered for the period When Growth opens Then Ad spend shows "Not recorded" with "Add this week's spend"
- [ ] **AC-11.3** Given spend ₱3,500 and 0 paid jobs from ads When Growth opens Then "₱3,500 spent · 0 paid jobs yet" shows and cost per paid job shows "Need spend + 1 paid ad job"
- [ ] **AC-11.4** Given spend and ≥ 1 paid job from ads When Growth opens Then cost per paid job = spend ÷ paid jobs from ads (rounded to the nearest peso) and Revenue vs spend = ₱ collected from ad customers ÷ spend, shown like "3.2×" (one decimal). "From ads" = the customer's inquiry is tagged with a named ad (not Don't know, not Not from an ad)
- [ ] **AC-11.5** Given the by-ad table When shown Then each ad row shows Spend, Inquiries, Quoted, Paid jobs, ₱ collected, plus rows Don't know, Not from an ad and Whole campaign; footer "Tagged: 7 of 9 inquiries (78%)" (rounded to whole %)
- [ ] **AC-11.6** Given an ad has fewer than 3 paid jobs in the period When Growth opens Then it is never shown as best ad; if no ad has 3, "Too early to tell" shows
- [ ] **AC-11.7** Given "+ Add spend" When Robert enters start, end, ad or Whole campaign, ₱ amount and optional conversations count Then it is saved with source Manual
- [ ] **AC-11.8** Given a CSV with the right columns When imported Then a preview shows; rows with the same start, end and ad as existing ones are skipped and listed; non-PHP rows are skipped and listed; the rest import only after "Import <n> rows"
- [ ] **AC-11.9** Given a CSV with missing or wrong columns When imported Then nothing is imported and "Couldn't read column '<name>'. Use the Ads Manager export or ADS-TALLY template." shows with a template download
- [ ] **AC-11.10** Given every number on Growth When shown Then its source shows (Manual / CSV)
- [ ] **AC-11.11** Given conversations entered for a week and fewer inquiries added When Growth opens Then "Ads Manager shows <n> chats, app has <m> — add the missing <n−m>?" shows
- [ ] **AC-11.12** Given Settings allowance ₱5,000, a start date and daily rate ₱500, and ₱1,500 spend since the start date When Growth opens Then "₱5,000 allowance · ₱1,500 used · ~7 days left at ₱500/day" shows, labelled as an estimate (days left = (allowance − spend since start) ÷ daily rate, rounded down)
- [ ] **AC-11.13** Given the ads connection When Settings or Growth opens Then it shows "Not connected"; no sync runs, no access key is stored, and no number shows source "Synced"

### Story 12: Settings (Spec 11)
**As** Robert **I want** to set prices and timings once **so that** quotes and reminders are right without thinking.
- [ ] **AC-12.1** Given groups Prices · Travel · Reminders · Reply texts · Ad names · Ad allowance (amount, start date, daily rate) · Lost reasons · Business · Data · Ads connection When Settings opens Then each group shows as a heading with its fields
- [ ] **AC-12.2** Given a field is changed When focus leaves it Then it saves and "Saved ✓" shows; on failure "Not saved — try again"
- [ ] **AC-12.3** Given a number field When ≤ 0 is entered Then it is refused; blank is allowed only for Cleaning, Repair labor, Vehicle cost per km, Home base
- [ ] **AC-12.4** Given diesel or km per L When changed Then "₱<x>/km fuel" updates and "New quotes only. Old quotes keep their price." shows
- [ ] **AC-12.5** Given a template When saved Then placeholders {name} {area} {total} {date} {time} {balance} {piano} {minutes} are allowed; any other shows a red warning naming it; max 1,000 characters; "Reset template" asks to confirm
- [ ] **AC-12.6** Given an ad name When retired Then it is hidden for new inquiries but stays on old ones; the last active ad name cannot be retired or deleted
- [ ] **AC-12.7** Given the backup When Settings opens Then "Last backup <date time> ✓" or a red "Backup failed <date>" shows, from the backup job's last recorded result
- [ ] **AC-12.8** Given Data When Robert taps "Export all (CSV)" Then customers, jobs, payments and pianos download as CSV

### Story 13: Customers + search (Specs 13, 12B)
**As** Robert **I want** everything about a customer in one place and found in 2 seconds **so that** I answer them confidently.
- [ ] **AC-13.1** Given customers When the list opens Then the filters are All, Active, Unpaid, Past and Lost; rows show name, area, status (text + icon), next date and badges; sort Recent activity (default) · Name · Next due
- [ ] **AC-13.2** Given a record When opened Then it shows header (name, area, status, "Came from: <source> · <ad>"), the Next step card, and tabs Activity · Quotes · Visits · Money · Pianos; Activity shows 20 items then "Show older"
- [ ] **AC-13.3** Given 1+ typed letters When searching Then customers, pianos and quotes matching name, area, phone, piano brand or note show grouped; "maira" finds "Maria"; with an empty box the last 5 opened records show; on desktop "/" opens search when no field is focused
- [ ] **AC-13.4** Given no match When searching Then "No match for '<text>'. + Add inquiry '<text>'?" prefills the name
- [ ] **AC-13.9** Given another customer with the same name (ignoring case and extra spaces) or the same phone When the list or record shows Then both get a "Possible duplicate" badge until merged or marked "Not the same"
- [ ] **AC-13.5** Given two records When Robert picks Merge Then a preview "Keep: <older>. Join: <n> quotes, <n> visits, <n> payments, <n> pianos" shows; Merge keeps the older record, joins everything, and offers Undo 10 s
- [ ] **AC-13.6** Given a customer with no payments When Delete is confirmed ("Delete <name> and all her records?") Then the customer and their jobs are removed; given payments exist Then "Can't delete: has payments. Mark Lost instead." shows
- [ ] **AC-13.7** Given a Lost customer When Reopen is tapped Then status returns to the status before Lost
- [ ] **AC-13.8** Given a phone number was added When the record shows Then tapping it starts a call; without one, no phone line shows

## Functional Requirements

### FR-1: Customer is the center, jobs hold the work
**Must:** follow R1; one record shows everything about a customer.
**Must not:** create a second record for the same person without the duplicate check (AC-2.4).

### FR-2: Status changes only from Robert's actions
**Must:** follow the transition table R3 exactly.
**Must not:** change status from a guess, timer or anything Robert did not tap.

### FR-3: Money is exact
**Must:** follow R2 and R5; snapshot prices on every sent quote; centavo precision.
**Must not:** show ₱0 for anything not recorded; show travel math to the customer.

### FR-4: Reminders inside the app
**Must:** follow R4; all timings editable in Settings.
**Must not:** send push notifications, SMS, email or any message to customers.

### FR-5: Robert sends, the app drafts
**Must:** use one shared "Send kit" for every customer message: Copy → Open Inbox → "Did you send it?" (30 min window) → Undo 10 s.
**Must not:** send anything to customers by itself.

### FR-6: Growth numbers are honest
**Must:** follow R6; show the source of every number; manual + CSV entry; ads connection present but OFF.
**Must not:** guess an inquiry's ad; name a best ad with fewer than 3 paid jobs.

### FR-7: Only adds to the current app
**Must:** live in its own area with its own data; reuse the existing login unchanged except the approved lockout (AC-1.5); existing app tests keep passing.
**Must not:** change, move or delete existing screens, login behaviour, tables or data.

### FR-8: Undo and history
**Must:** Undo for 10 s after status changes, payments, merges and Done; every action in the Activity log with date and time; undo also available from the log.

## Non-Functional Requirements

### Performance
- Search shows results within 300 ms for up to 500 customers.
- Today opens within 2 s on a 4G phone connection.
- Quote total updates on every keystroke.

### Security
- Only the owner account can read or change Growth OS data; every Growth OS page and action checks this on the server (AC-1.2, AC-1.3).
- Every Growth OS input is checked on the server (type, length, allowed values) before saving; invalid input is refused with a message.
- Growth OS refuses to start in production if AUTH_SECRET is missing or equals the repo's dev fallback value, or if the database address is missing.
- No passwords, tokens or secrets in the code repository, chat or docs; customer phone numbers only inside the app's database and never in logs.
- Photos are private: viewable only by the signed-in owner, no public links.
- CSV downloads neutralise cells starting with = + - @, tab or carriage return (ASCII characters).

### Reliability
- Nightly backup at 2:00 AM Asia/Manila, kept 30 days; the app records each backup's result for Settings (AC-12.7).
- All dates and "today" use Asia/Manila time.
- A failed save never loses what was typed.

### Accessibility (WCAG 2.1 AA, from the critique)
- Works at 320px width without sideways scroll; tables become stacked cards on phone; tablet (768–1199px) shows list + overlay panel.
- Touch targets ≥ 44px (Job day buttons 56px).
- Gold only on black; "+ Add inquiry" = black pill with gold text.
- Status never by color alone (text + icon).
- Every sheet: focus first field on open, trap focus, Esc closes with discard check, focus returns to the opener.
- Toasts stay at least 5 s (Copied: 2 s), pause on hover/focus, and are announced; amounts read as "pesos"; dates read in full.

## Error Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| No internet on any save | Nothing saved, typing kept, "No internet. Your typing is kept — tap Save again when you have signal." |
| Server error on save | Typing kept, "Couldn't save. Your typing is kept. Try Save again." |
| Not signed in | Sent to login, no data returned |
| Signed in but not owner | 403, no data returned |
| Clipboard blocked | Text shown selected with "Long-press → Copy" |
| Open Inbox fails | "Couldn't open the inbox. Open Messenger yourself — your reply is copied." |
| Service price not set | "Set price" input on the line; Copy disabled; never ₱0 |
| CSV wrong columns | Whole file refused, column named, template offered |
| CSV non-PHP or duplicate rows | Those rows skipped and listed; the rest imported only after confirm |
| Photo upload fails | Job saves without it; "Photo not uploaded — try again" |
| Backup fails | Red "Backup failed <date>" in Settings |
| Today data fails to load | "Couldn't update. Try again"; never "All caught up" |

## Open Questions

None. Values Robert fills in Settings while using the app (warnings show until set): Cleaning price, Repair labor price, Vehicle cost per km, Home base barangay.

## Decisions Log

- **Login lockout:** Robert chose A (4 Oct): the existing login gets ONE change — lock 15 min after 5 wrong tries (AC-1.5). Nothing else in the old login changes.

## Out of Scope (Future Considerations)

- Ads connection switched ON (needs Robert's Meta steps + his OK).
- Push notifications, offline mode (Robert: no).
- Other changes to the existing login (longer sessions, sign out all devices, new-device email alert, password reset screen) — would change the old app; Later list, Robert's call. Forgot password = reset by Robert's Assistant.
- Old repo demo login password (Later list, Robert's call).
- Assistant's scope cuts to save build time: "Save image" quote card, drag-to-reschedule on desktop (Reschedule button is used instead), single-key shortcuts except "/" for search, Monday 5-line weekly card.
- Fill the gap, price suggestions, import past customers (P1).
- Staff account, Google Calendar sync, in-app Messenger (P2).
- Monthly restore test of the backup = operations checklist, not an app feature.
