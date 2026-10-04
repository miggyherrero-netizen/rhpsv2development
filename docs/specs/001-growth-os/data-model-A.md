# Data Model: Herrero Growth OS — Step A (Base)

Only the tables Step A needs. Steps B–E add their own tables (customers, jobs, quotes, visits, payments, pianos, ad spend) in their own plans.
All Growth OS tables live in `src/db/gos-schema.ts` and start with `gos_`. No existing table is changed.

## Entities

### gos_settings

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | integer | PK, default 1, CHECK id = 1 | Single settings row |
| data | jsonb | not null | All settings, validated by `gosSettingsSchema` (prices in centavos, travel, reminders, templates, lost reasons, business, allowance) |
| updated_at | timestamptz | not null, default now() | Last save |

**Indexes:** PK only (one row).
**Relationships:** none.
**Spec requirement:** Story 12 (AC-12.1–12.6), FR-3 (prices in centavos), FR-4 (reminder timings).

---

### gos_ads

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | uuid | PK, default random | Ad identifier used later by inquiries |
| name | text | not null, unique | "Photo 01", "Creative 02 Grand", "Creative 03 Upright" |
| retired | boolean | not null, default false | Hidden on new inquiries when true (AC-12.6) |
| sort_order | integer | not null, default 0 | Display order |
| created_at | timestamptz | not null, default now() | |

**Indexes:** unique(name).
**Relationships:** referenced by `gos_customers.ad_id` (Step B).
**Spec requirement:** AC-2.5, AC-12.6, FR-6.

---

### gos_login_attempts

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| email | text | PK | Lower-cased, trimmed email typed at login (known or unknown) |
| failed_count | integer | not null, default 0 | Wrong tries in the current 15-min window |
| first_failed_at | timestamptz | null | Start of the current window |
| locked_until | timestamptz | null | Login refused until this time |

**Indexes:** PK only.
**Relationships:** none (deliberately not linked to `users`, so unknown emails behave the same).
**Spec requirement:** AC-1.5 (Robert approved, 4 Oct).
