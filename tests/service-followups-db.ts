/**
 * DB-backed scenario for the one follow-up queue. LOCAL POSTGRES ONLY. NOT part of `npm test`.
 * Same pattern as tests/service-waitlist-convert-db.ts: a throw-away database `herrero_followups_test` is created on the same
 * local server (schema copied with pg_dump -s from the base database), the real read functions run there, then it is dropped.
 *
 * Run: DATABASE_URL=postgres://postgres@127.0.0.1:5433/herrero DATABASE_SSL=false npx tsx tests/service-followups-db.ts
 * Refuses to run unless the host is 127.0.0.1 / localhost.
 */
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const base = process.env.DATABASE_URL;
if (!base) { console.error("Set DATABASE_URL to the LOCAL database (postgres://postgres@127.0.0.1:5433/herrero)."); process.exit(2); }
const u = new URL(base);
if (!["127.0.0.1", "localhost", "::1"].includes(u.hostname)) { console.error(`Refusing to run against ${u.hostname}: local databases only.`); process.exit(2); }
const SCRATCH = "herrero_followups_test";
const adminUrl = new URL(base); adminUrl.pathname = "/postgres";
const scratchUrl = new URL(base); scratchUrl.pathname = `/${SCRATCH}`;
const baseDb = u.pathname.slice(1);
if (baseDb === SCRATCH) { console.error("Point DATABASE_URL at the base database, not the scratch one."); process.exit(2); }

let failures = 0, passes = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) { passes++; console.log(`  PASS ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ""}`); }
}

async function main() {
  const admin = new Client({ connectionString: adminUrl.toString() });
  admin.on("error", () => {});
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  await admin.query(`CREATE DATABASE ${SCRATCH}`);
  await admin.end();
  const dump = execFileSync("pg_dump", ["-s", "-h", u.hostname, "-p", u.port || "5432", "-U", u.username || "postgres", baseDb], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync("psql", ["-q", "-h", u.hostname, "-p", u.port || "5432", "-U", u.username || "postgres", "-d", SCRATCH, "-v", "ON_ERROR_STOP=0"], { input: dump, stdio: ["pipe", "ignore", "ignore"] });

  process.env.DATABASE_URL = scratchUrl.toString();
  process.env.DATABASE_SSL = "false";
  const { db, pool } = await import("../src/db");
  const S = await import("../src/db/schema");
  const core = await import("../src/server/service-waitlist-core");
  const { getFollowUpQueue, getFollowUpDueCount, getFollowUpDueCountSafe } = await import("../src/server/service-followups-data");
  const { getRemindersDue } = await import("../src/server/service-reminders-data");
  const { getFollowUpsDue } = await import("../src/server/service-waitlist-data");
  const { getRecalls, getUntrackedRecalls } = await import("../src/server/service-data");
  const { followUpCounts } = await import("../src/lib/service-followups");
  const { startOfManilaDayUTC } = await import("../src/lib/dates");

  try {
    const now = new Date();
    const today = startOfManilaDayUTC(now);
    const day = (n: number) => new Date(today.getTime() + n * 86_400_000);
    const at = (n: number, hours = 10) => new Date(today.getTime() + n * 86_400_000 + hours * 3_600_000);

    const mk = async (name: string) => (await db.insert(S.serviceCustomers).values({ name, phone: "0917 000 0000" }).returning())[0]!;
    const [ana, ben, cai, dan] = [await mk("Ana Reminder"), await mk("Ben Waitlist"), await mk("Cai Recall"), await mk("Dan Done")];
    const piano = async (customerId: string, label: string, due: Date | null) =>
      (await db.insert(S.servicePianos).values({ customerId, brand: label, model: "X", type: "Upright", nextServiceDueAt: due } as never).returning())[0]!;
    const pRecall = await piano(cai.id, "Yamaha", day(-2));          // recall due, HAS a waitlist recall entry
    const pPlain = await piano(cai.id, "Kawai", day(-1));            // recall due, NO entry
    const pFuture = await piano(ben.id, "Baldwin", day(10));         // recall in 10 days, has an entry not yet due

    // Manual reminders: overdue, today, upcoming
    const rem = (customerId: string, dueAt: Date, note: string) => db.insert(S.serviceReminders).values({ customerId, dueAt, note });
    await rem(ana.id, day(-3), "Ask about the quote");
    await rem(ana.id, day(0), "Confirm Friday visit");
    await rem(ana.id, day(5), "Check in after the move");
    await db.insert(S.serviceReminders).values({ customerId: ana.id, dueAt: day(-1), note: "Already done", status: "done" });

    // Waitlist entries
    const entry = (customerId: string, o: Record<string, unknown>) => core.insertEntry(db, { customerId, cityCode: null, ...o } as never);
    await entry(ben.id, { status: "waiting", nextFollowUpAt: at(-2), notes: "overdue waiting" });
    await entry(ben.id, { status: "messaged", nextFollowUpAt: at(0, 9), notes: "today messaged" });
    await entry(ben.id, { status: "waiting", nextFollowUpAt: at(4), notes: "upcoming waiting" });
    await entry(dan.id, { status: "done", nextFollowUpAt: at(-1) });
    await entry(dan.id, { status: "scheduled", nextFollowUpAt: at(-1) });
    await entry(dan.id, { status: "confirmed", nextFollowUpAt: at(-1) });
    await entry(dan.id, { status: "not_now", nextFollowUpAt: at(20) });                  // paused: not in the queue
    await entry(cai.id, { pianoId: pRecall.id, source: "recall", status: "waiting", requestedAt: day(-2), nextFollowUpAt: day(-2) });
    await entry(ben.id, { pianoId: pFuture.id, source: "recall", status: "waiting", requestedAt: day(10), nextFollowUpAt: day(10) });

    console.log("1. the queue returns every open item once");
    const queue = await getFollowUpQueue(now);
    const keys = queue.map((q) => q.key);
    check("no duplicate rows", new Set(keys).size === keys.length, keys);
    const counts = followUpCounts(queue, now);
    check("3 reminders (done one excluded)", counts.reminder === 3, counts);
    check("5 waitlist rows: overdue, today, upcoming, recall due, recall in 10 days", counts.waitlist === 5, counts);
    check("done / scheduled / confirmed / paused not_now are absent", !queue.some((q) => q.kind === "waitlist" && ["done", "scheduled", "confirmed", "not_now"].includes(q.entry.status)));
    check("overdue = reminder(-3) + waitlist(-2) + recall(-2); today = reminder + messaged", counts.overdue === 3 && counts.today === 2, counts);
    check("upcoming = reminder(+5) + waitlist(+4) + recall(+10)", counts.upcoming === 3, counts);
    check("sorted by due day", queue.every((q, i) => i === 0 || queue[i - 1]!.dueAt.getTime() <= q.dueAt.getTime()));

    console.log("\n2. sidebar badge = the queue's overdue + today = Today's two lists");
    const badge = await getFollowUpDueCount(now);
    const [remsDue, waitDue] = await Promise.all([getRemindersDue(now), getFollowUpsDue(now)]);
    check(`badge ${badge} === queue due ${counts.due}`, badge === counts.due, { badge, due: counts.due });
    check(`Today's reminders (${remsDue.length}) + Today's follow-ups (${waitDue.length}) === badge`, remsDue.length + waitDue.length === badge, { r: remsDue.length, w: waitDue.length, badge });

    console.log("\n3. the recall with an entry is counted once");
    const allRecalls = await getRecalls(now);
    const untracked = await getUntrackedRecalls(now);
    check("getRecalls (customers page) still lists all three pianos", allRecalls.length === 3, allRecalls.map((r) => r.pianoLabel));
    check("getUntrackedRecalls keeps only the piano with no entry", untracked.length === 1 && untracked[0]!.pianoId === pPlain.id, untracked.map((r) => r.pianoLabel));
    check("the tracked recall is in the queue (as a waitlist row)", queue.some((q) => q.kind === "waitlist" && q.entry.pianoId === pRecall.id));
    const todayTotal = remsDue.length + waitDue.length + untracked.length;
    check(`Today's combined total ${todayTotal} = badge ${badge} + untracked recalls ${untracked.length} (no piano twice)`, todayTotal === badge + 1);

    console.log("\n4. marking messaged moves the row, not duplicates it");
    const overdueEntry = queue.find((q) => q.kind === "waitlist" && q.entry.status === "waiting" && q.dueAt.getTime() < today.getTime() && !q.entry.pianoId);
    if (overdueEntry && overdueEntry.kind === "waitlist") {
      const { eq } = await import("drizzle-orm");
      const { afterMessaged } = await import("../src/lib/service-waitlist");
      const next = afterMessaged({ status: overdueEntry.entry.status, followUpCount: overdueEntry.entry.followUpCount }, now);
      await db.update(S.serviceWaitlistEntries).set({ status: next.status as never, followUpCount: next.followUpCount, nextFollowUpAt: next.nextFollowUpAt }).where(eq(S.serviceWaitlistEntries.id, overdueEntry.entry.id));
      const after = await getFollowUpQueue(now);
      check("same number of rows, one fewer due", after.length === queue.length && followUpCounts(after, now).due === counts.due - 1);
      check("badge follows", (await getFollowUpDueCount(now)) === counts.due - 1);
    } else check("found a plain overdue entry", false);

    console.log("\n5. which entries own a piano's recall (same rule as the queue)");
    const { entryInQueue } = await import("../src/lib/service-followups");
    const eva = await mk("Eva Rules");
    const [job] = await db.insert(S.serviceJobs).values({ customerId: eva.id, title: "Booked tuning" } as never).returning();
    const cases: { label: string; owns: boolean; entry: Record<string, unknown> | null; withPiano?: boolean }[] = [
      { label: "waiting in the queue", owns: true, entry: { status: "waiting", nextFollowUpAt: at(0) } },
      { label: "messaged in the queue", owns: true, entry: { status: "messaged", nextFollowUpAt: at(-1) } },
      { label: "scheduled with a job", owns: true, entry: { status: "scheduled", jobId: job!.id, nextFollowUpAt: at(0) } },
      { label: "confirmed", owns: false, entry: { status: "confirmed", nextFollowUpAt: at(0) } },
      { label: "waiting 45 days ahead (beyond the horizon)", owns: false, entry: { status: "waiting", nextFollowUpAt: at(45) } },
      { label: "paused not_now", owns: false, entry: { status: "not_now", nextFollowUpAt: at(20) } },
      { label: "scheduled but no job", owns: false, entry: { status: "scheduled", nextFollowUpAt: at(0) } },
      { label: "different service type (repair)", owns: false, entry: { status: "waiting", serviceType: "repair", nextFollowUpAt: at(0) } },
      { label: "entry without a piano", owns: false, entry: { status: "waiting", nextFollowUpAt: at(0) }, withPiano: false },
    ];
    const made: { label: string; owns: boolean; pianoId: string }[] = [];
    for (const c of cases) {
      const p = await piano(eva.id, `R-${made.length}`, day(-1));
      const { jobId, ...rest } = c.entry as { jobId?: string };
      const id = await entry(eva.id, { ...rest, pianoId: c.withPiano === false ? null : p.id, source: "recall", requestedAt: day(-1) });
      if (jobId) await db.update(S.serviceWaitlistEntries).set({ jobId }).where((await import("drizzle-orm")).eq(S.serviceWaitlistEntries.id, id));
      made.push({ label: c.label, owns: c.owns, pianoId: p.id });
    }
    const untracked2 = new Set((await getUntrackedRecalls(now)).map((r) => r.pianoId));
    const queue2 = await getFollowUpQueue(now);
    for (const m of made) {
      check(`${m.label}: ${m.owns ? "suppresses the recall (in queue once)" : "recall stays on Today"}`, untracked2.has(m.pianoId) === !m.owns);
    }
    check("every entry the queue shows equals entryInQueue", queue2.filter((q) => q.kind === "waitlist").every((q) => entryInQueue(q.entry, now)));
    const inQueueIds = new Set(queue2.flatMap((q) => (q.kind === "waitlist" && q.entry.pianoId ? [q.entry.pianoId] : [])));
    check("no recall is in neither place (queue or Today's recalls) unless a job owns it", made.every((m) => untracked2.has(m.pianoId) || inQueueIds.has(m.pianoId) || m.label === "scheduled with a job"));
  } finally {
    await pool.end();
    const hard = await getFollowUpDueCount().then(() => "ok", () => "threw");
    check("with the pool closed the raw count throws, the badge version returns 0", hard === "threw" && (await getFollowUpDueCountSafe()) === 0, hard);
    const a2 = new Client({ connectionString: adminUrl.toString() });
    a2.on("error", () => {});
    await a2.connect();
    await a2.query(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    await a2.end();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
