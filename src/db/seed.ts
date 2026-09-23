import "dotenv/config";
import { db } from "./index";
import {
  users, workers, projects, tasks, timeEntries, updates, inventoryItems,
  pianos, inquiries, ownerCategories, ownerPreferences, ownerEvents,
  ownerTasks, ownerInbox, settings, sessions,
  serviceTechnicians, serviceCustomers, serviceLocations, servicePianos, serviceCatalog,
  serviceJobs, serviceJobItems, serviceJobEvents, serviceTimeLogs, serviceInvoices,
  serviceInvoiceItems, servicePayments, serviceExpenses, serviceSettings,
} from "./schema";
import { hashPassword, hashPin } from "../lib/security";
import type { Recurrence } from "../lib/dates";

const px = (id: number, w = 1200, h = 800) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=${w}&h=${h}`;

const IMG = {
  grandSunlit: px(12214094),
  concertHall: px(19541583),
  castle: px(34673904),
  antique: px(37085934),
  livingGrand: px(9852888),
  modernGrand: px(36028904, 900, 1200),
  interiorCottonbro: px(4088808),
  stringsPins: px(31335120, 900, 1200),
  bwMechanism: px(18415049, 900, 1200),
  interiorDetail: px(29460727, 900, 1200),
  stringsFrame: px(11377317, 900, 1200),
  keysBW: px(29704590),
  moodyKeys: px(36090132, 900, 1200),
  chickering: px(2176119),
  woodConcert: px(6647810, 900, 1200),
  cozyUpright: px(32218646, 900, 1200),
  stringsWood: px(6647431, 900, 1200),
  keysLow: px(37210759),
  ivoryKeys: px(10222172, 900, 1200),
  stringsRed: px(6647422, 900, 1200),
};

function at(offsetDays: number, h = 9, min = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(h, min, 0, 0);
  return d;
}
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

async function main() {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) {
    console.log("Database already has data — skipping seed (data is preserved across restarts).");
    process.exit(0);
  }

  console.log("No existing data found — seeding for the first time…");
  console.log("Clearing existing rows…");
  await db.delete(ownerInbox);
  await db.delete(ownerTasks);
  await db.delete(ownerEvents);
  await db.delete(ownerPreferences);
  await db.delete(ownerCategories);
  // Home service (child tables first — payments/items hang off invoices and jobs)
  await db.delete(servicePayments);
  await db.delete(serviceInvoiceItems);
  await db.delete(serviceInvoices);
  await db.delete(serviceExpenses);
  await db.delete(serviceTimeLogs);
  await db.delete(serviceJobEvents);
  await db.delete(serviceJobItems);
  await db.delete(serviceJobs);
  await db.delete(servicePianos);
  await db.delete(serviceLocations);
  await db.delete(serviceCustomers);
  await db.delete(serviceCatalog);
  await db.delete(serviceTechnicians);
  await db.delete(serviceSettings);
  await db.delete(inquiries);
  await db.delete(pianos);
  await db.delete(updates);
  await db.delete(timeEntries);
  await db.delete(tasks);
  await db.delete(projects);
  await db.delete(workers);
  await db.delete(inventoryItems);
  await db.delete(sessions);
  await db.delete(users);
  await db.delete(settings);

  console.log("Seeding users & settings…");
  const [owner] = await db
    .insert(users)
    .values({
      email: "owner@herrero.ph",
      passwordHash: hashPassword("atelier2026"),
      name: "Rafael Herrero",
      role: "owner",
    })
    .returning();
  await db.insert(settings).values({ key: "staleUpdateDays", value: "10" });
  await db.insert(settings).values({ key: "loginGatePinHash", value: hashPin("0000") });

  console.log("Seeding workers…");
  const [marco, daniel, paolo, jerome, anna] = await db
    .insert(workers)
    .values([
      { name: "Marco Villanueva", title: "Master Technician", hourlyRateCents: 48000, pinHash: hashPin("2468") },
      { name: "Daniel Reyes", title: "Action & Regulation", hourlyRateCents: 42000, pinHash: hashPin("1357") },
      { name: "Paolo Santos", title: "Cabinet & Finish", hourlyRateCents: 38000, pinHash: hashPin("7777") },
      { name: "Jerome Aquino", title: "Stringing & Soundboard", hourlyRateCents: 36000, pinHash: hashPin("4321") },
      { name: "Anna Cruz", title: "Apprentice · QC", hourlyRateCents: 25000, pinHash: hashPin("9000") },
    ])
    .returning();

  console.log("Seeding projects…");
  const projectRows = [
    { clientName: "Maria Santos", clientEmail: "maria.santos@gmail.com", clientPhone: "+63 917 555 0142", pianoBrand: "Steinway & Sons", pianoModel: "Model O", pianoYear: 1911, serialNumber: "S-148902", serviceType: "Full Restoration", status: "restoration", progress: 55, dueDate: at(38), assignedWorkerId: marco.id, imageUrl: IMG.grandSunlit, lastClientUpdateAt: at(-3), notes: "Original ivory keytops retained where legal; soundboard shimmed 1920s style." },
    { clientName: "Dr. James Reyes", clientEmail: "j.reyes@makatimed.ph", clientPhone: "+63 918 555 9921", pianoBrand: "Bösendorfer", pianoModel: "170VC", pianoYear: 1998, serialNumber: "BV-44710", serviceType: "Action Regulation & Voicing", status: "quality", progress: 86, dueDate: at(5), assignedWorkerId: daniel.id, imageUrl: IMG.concertHall, lastClientUpdateAt: at(-1) },
    { clientName: "Atty. Sofia Dela Cruz", clientEmail: "sofia.dc@delacruzlaw.ph", clientPhone: "+63 917 555 3308", pianoBrand: "Fazioli", pianoModel: "F156", pianoYear: 2005, serialNumber: "F-2219", serviceType: "Full Restoration", status: "finishing", progress: 78, dueDate: at(14), assignedWorkerId: paolo.id, imageUrl: IMG.modernGrand, lastClientUpdateAt: at(-6) },
    { clientName: "Makati Christian School", clientEmail: "facilities@mcs.edu.ph", clientPhone: "+63 2 8555 1187", pianoBrand: "Yamaha", pianoModel: "U1", pianoYear: 1982, serialNumber: "U-3381047", serviceType: "Reconditioning", status: "intake", progress: 8, dueDate: at(30), assignedWorkerId: jerome.id, imageUrl: IMG.cozyUpright, lastClientUpdateAt: at(-12) },
    { clientName: "Ramon & Liza Gomez", clientEmail: "gomez.family@yahoo.com", clientPhone: "+63 920 555 7714", pianoBrand: "Kawai", pianoModel: "K-300", pianoYear: 2019, serialNumber: "K-2773955", serviceType: "Tuning & Voicing", status: "disassembly", progress: 22, dueDate: at(9), assignedWorkerId: daniel.id, imageUrl: IMG.keysLow, lastClientUpdateAt: at(-2) },
    { clientName: "The Manila Conservatory", clientEmail: "director@manilaconservatory.ph", clientPhone: "+63 2 8555 4409", pianoBrand: "Blüthner", pianoModel: "Model 11", pianoYear: 1924, serialNumber: "B-98435", serviceType: "Full Restoration", status: "restoration", progress: 41, dueDate: at(52), assignedWorkerId: jerome.id, imageUrl: IMG.castle, lastClientUpdateAt: at(-8) },
    { clientName: "Engr. Paolo Lim", clientEmail: "p.lim@limbuilders.ph", clientPhone: "+63 917 555 6203", pianoBrand: "Seiler", pianoModel: "122 Konsole", pianoYear: 2001, serialNumber: "SL-58204", serviceType: "Cabinet Refinish", status: "intake", progress: 12, dueDate: at(26), assignedWorkerId: paolo.id, imageUrl: IMG.antique, lastClientUpdateAt: at(-4) },
    { clientName: "St. Scholastica Chapel", clientEmail: "music@ssc.edu.ph", clientPhone: "+63 2 8555 9032", pianoBrand: "Yamaha", pianoModel: "C3", pianoYear: 1999, serialNumber: "C-5538961", serviceType: "Action Rebuild", status: "finishing", progress: 70, dueDate: at(11), assignedWorkerId: marco.id, imageUrl: IMG.woodConcert, lastClientUpdateAt: at(-5) },
    { clientName: "Isabella Navarro", clientEmail: "isa.navarro@gmail.com", clientPhone: "+63 918 555 2750", pianoBrand: "Steinway & Sons", pianoModel: "Model M", pianoYear: 1957, serialNumber: "M-339882", serviceType: "Full Restoration", status: "delivery", progress: 96, dueDate: at(2), assignedWorkerId: marco.id, imageUrl: IMG.livingGrand, lastClientUpdateAt: at(-1) },
    { clientName: "Katrina Uy", clientEmail: "kat.uy@gmail.com", clientPhone: "+63 917 555 8846", pianoBrand: "Boston", pianoModel: "GP-178", pianoYear: 2010, serialNumber: "BP-174455", serviceType: "Regulation", status: "quality", progress: 90, dueDate: at(4), assignedWorkerId: anna.id, imageUrl: IMG.chickering, lastClientUpdateAt: at(-2) },
  ] as const;
  const proj = await db.insert(projects).values(projectRows.map((p) => ({ ...p }))).returning();
  const P = (i: number) => proj[i].id;

  console.log("Seeding tasks…");
  const taskSeed = [
    // Steinway O — restoration
    { projectId: P(0), title: "Fit new pinblock and verify torque", status: "in_progress", priority: "high", assignedWorkerId: marco.id, claimedByWorkerId: marco.id, estimatedMinutes: 240, dueDate: at(0, 17), position: 1 },
    { projectId: P(0), title: "Map plate screw pattern", status: "done", priority: "normal", assignedWorkerId: jerome.id, claimedByWorkerId: jerome.id, estimatedMinutes: 90, dueDate: at(-6), completedAt: at(-6, 15), position: 2 },
    { projectId: P(0), title: "Soundboard shim and crown check", status: "done", priority: "normal", assignedWorkerId: jerome.id, claimedByWorkerId: jerome.id, estimatedMinutes: 300, dueDate: at(-3), completedAt: at(-3, 16), position: 3 },
    { projectId: P(0), title: "Hang bass strings (J. Röslau set)", status: "available", priority: "high", estimatedMinutes: 360, dueDate: at(2), position: 4 },
    { projectId: P(0), title: "Order agraffe replacements", status: "claimed", priority: "urgent", assignedWorkerId: jerome.id, claimedByWorkerId: jerome.id, estimatedMinutes: 45, dueDate: at(-1), waitingParts: true, position: 5 },
    { projectId: P(0), title: "Keybed leveling", status: "backlog", priority: "normal", estimatedMinutes: 180, dueDate: at(12), position: 6 },
    // Bösendorfer — quality
    { projectId: P(1), title: "Final voicing pass — treble section", status: "in_progress", priority: "high", assignedWorkerId: daniel.id, claimedByWorkerId: daniel.id, estimatedMinutes: 150, dueDate: at(1), position: 1 },
    { projectId: P(1), title: "Wait on Abel hammer set (shipment)", status: "claimed", priority: "high", assignedWorkerId: daniel.id, claimedByWorkerId: daniel.id, estimatedMinutes: 20, dueDate: at(0), waitingParts: true, position: 2 },
    { projectId: P(1), title: "Pedal lyre regulation", status: "done", priority: "normal", assignedWorkerId: daniel.id, claimedByWorkerId: daniel.id, estimatedMinutes: 60, dueDate: at(-2), completedAt: at(-2, 14), position: 3 },
    // Fazioli — finishing
    { projectId: P(2), title: "Polyester sanding — 1200 grit", status: "in_progress", priority: "normal", assignedWorkerId: paolo.id, claimedByWorkerId: paolo.id, estimatedMinutes: 240, dueDate: at(1), position: 1 },
    { projectId: P(2), title: "Buff lid to final gloss", status: "available", priority: "normal", estimatedMinutes: 180, dueDate: at(4), position: 2 },
    { projectId: P(2), title: "Fallboard decal placement", status: "backlog", priority: "low", estimatedMinutes: 45, dueDate: at(8), position: 3 },
    // Yamaha U1 school — intake
    { projectId: P(3), title: "Full intake assessment & photo log", status: "claimed", priority: "high", assignedWorkerId: jerome.id, claimedByWorkerId: jerome.id, estimatedMinutes: 120, dueDate: at(0, 12), position: 1 },
    { projectId: P(3), title: "Check pinblock for cracks", status: "available", priority: "normal", estimatedMinutes: 60, dueDate: at(3), position: 2 },
    { projectId: P(3), title: "Estimate parts list for quote", status: "backlog", priority: "normal", estimatedMinutes: 90, dueDate: at(5), position: 3 },
    // Kawai K300 — disassembly
    { projectId: P(4), title: "Remove action and label keys", status: "done", priority: "normal", assignedWorkerId: daniel.id, claimedByWorkerId: daniel.id, estimatedMinutes: 90, dueDate: at(-1), completedAt: at(-1, 11), position: 1 },
    { projectId: P(4), title: "Clean keyframe & rebush balance rail", status: "available", priority: "normal", estimatedMinutes: 210, dueDate: at(3), position: 2 },
    // Blüthner — restoration (waiting parts)
    { projectId: P(5), title: "Measure aliquot string lengths", status: "backlog", priority: "normal", estimatedMinutes: 120, dueDate: at(10), position: 1 },
    { projectId: P(5), title: "Await pinblock blank from Germany", status: "claimed", priority: "urgent", assignedWorkerId: jerome.id, claimedByWorkerId: jerome.id, estimatedMinutes: 30, dueDate: at(-4), waitingParts: true, position: 2 },
    { projectId: P(5), title: "Strip old finish from rim", status: "available", priority: "normal", assignedWorkerId: paolo.id, estimatedMinutes: 420, dueDate: at(6), position: 3 },
    { projectId: P(5), title: "Photograph plate before rebronze", status: "available", priority: "low", estimatedMinutes: 45, dueDate: at(6), position: 4 },
    // Seiler — intake
    { projectId: P(6), title: "Strip and sand top panels", status: "available", priority: "normal", assignedWorkerId: paolo.id, estimatedMinutes: 300, dueDate: at(7), position: 1 },
    { projectId: P(6), title: "Match veneer for cheek blocks", status: "backlog", priority: "low", estimatedMinutes: 120, dueDate: at(14), position: 2 },
    // Yamaha C3 chapel — finishing
    { projectId: P(7), title: "Install new Renner wippens", status: "done", priority: "high", assignedWorkerId: marco.id, claimedByWorkerId: marco.id, estimatedMinutes: 360, dueDate: at(-4), completedAt: at(-4, 17), position: 1 },
    { projectId: P(7), title: "Regulate let-off and drop", status: "in_progress", priority: "high", assignedWorkerId: marco.id, claimedByWorkerId: marco.id, estimatedMinutes: 240, dueDate: at(2), position: 2 },
    { projectId: P(7), title: "Damp proof the pedal action", status: "backlog", priority: "normal", estimatedMinutes: 90, dueDate: at(9), position: 3 },
    // Steinway M — delivery
    { projectId: P(8), title: "Final tuning at pitch A=442", status: "done", priority: "high", assignedWorkerId: marco.id, claimedByWorkerId: marco.id, estimatedMinutes: 120, dueDate: at(-1), completedAt: at(-1, 16), position: 1 },
    { projectId: P(8), title: "Schedule delivery truck & crew", status: "available", priority: "urgent", estimatedMinutes: 30, dueDate: at(0, 15), position: 2 },
    { projectId: P(8), title: "Prepare care kit & warranty card", status: "available", priority: "normal", estimatedMinutes: 30, dueDate: at(1), position: 3 },
    // Boston — quality
    { projectId: P(9), title: "QC play-through checklist", status: "claimed", priority: "normal", assignedWorkerId: anna.id, claimedByWorkerId: anna.id, estimatedMinutes: 90, dueDate: at(1), position: 1 },
    { projectId: P(9), title: "Touch-up key slip felt", status: "backlog", priority: "low", estimatedMinutes: 30, dueDate: at(3), position: 2 },
    // shop-wide
    { projectId: null, title: "Sharpen chisels & scraper set", status: "available", priority: "low", estimatedMinutes: 60, dueDate: at(5), position: 90 },
    { projectId: null, title: "Inventory count: felts & cloth", status: "backlog", priority: "normal", estimatedMinutes: 90, dueDate: at(8), position: 91 },
    { projectId: null, title: "Deep clean spray booth filters", status: "backlog", priority: "normal", estimatedMinutes: 120, dueDate: at(12), position: 92 },
  ] as const;
  const insertedTasks = await db
    .insert(tasks)
    .values(taskSeed.map((t) => ({ ...t })))
    .returning();
  const findTask = (title: string) => insertedTasks.find((t) => t.title.includes(title))!;

  console.log("Seeding time entries…");
  const historical: {
    workerId: string; inH: number; outH: number; rate: number; taskId?: string;
  }[] = [];
  const rates: Record<string, number> = {
    [marco.id]: 48000, [daniel.id]: 42000, [paolo.id]: 38000, [jerome.id]: 36000, [anna.id]: 25000,
  };
  const ids = [marco.id, daniel.id, paolo.id, jerome.id, anna.id];
  for (let d = 9; d >= 1; d--) {
    const n = 1 + ((d * 7) % 3);
    for (let k = 0; k < n; k++) {
      const w = ids[(d + k) % ids.length];
      const start = 8 + ((d + k * 2) % 4);
      const len = 2 + ((d + k) % 5);
      historical.push({ workerId: w, inH: d * 24 - start, outH: d * 24 - start - len, rate: rates[w] });
    }
  }
  await db.insert(timeEntries).values([
    ...historical.map((h) => ({
      workerId: h.workerId,
      clockIn: hoursAgo(h.inH),
      clockOut: hoursAgo(h.outH),
      rateAtClockInCents: h.rate,
    })),
    { workerId: marco.id, clockIn: hoursAgo(1.65), clockOut: null, rateAtClockInCents: 48000, taskId: findTask("pinblock")?.id },
    { workerId: daniel.id, clockIn: hoursAgo(2.4), clockOut: null, rateAtClockInCents: 42000, taskId: findTask("voicing")?.id },
  ]);

  console.log("Seeding story updates…");
  const u: {
    p: number; title: string; body: string; img: string; day: number; vis: boolean;
  }[] = [
    { p: 0, title: "Arrival at the atelier", body: "Your Steinway O arrived safely from Quezon City. First inspection documented — the original case is remarkably honest beneath a century of dust.", img: IMG.grandSunlit, day: -34, vis: true },
    { p: 0, title: "Full disassembly complete", body: "Action, keys, plate and strings carefully removed and catalogued. Every screw is bagged and labelled.", img: IMG.interiorCottonbro, day: -30, vis: true },
    { p: 0, title: "Plate assessment", body: "The cast-iron plate shows no fractures. It will be stripped and re-bronzed to its original lustre.", img: IMG.bwMechanism, day: -27, vis: true },
    { p: 0, title: "Workshop note — pinblock", body: "Internal note: pinblock delamination worse than expected. Sourced 5-ply Delignit blank.", img: IMG.stringsPins, day: -24, vis: false },
    { p: 0, title: "Soundboard restored", body: "Shims set and crown re-established. The board responds beautifully across the tenor break.", img: IMG.interiorDetail, day: -12, vis: true },
    { p: 0, title: "New pinblock fitted", body: "Torque tested across all 226 pins. This piano will hold tune for a generation.", img: IMG.stringsPins, day: -3, vis: true },
    { p: 1, title: "Regulation benchmarks", body: "Key dip measured at 10.2mm, aftertouch balanced. The Vienna action is nearly singing again.", img: IMG.keysBW, day: -4, vis: true },
    { p: 1, title: "Voicing in progress", body: "Needle work on the treble hammers — three passes so far. Waiting on the final Abel set.", img: IMG.moodyKeys, day: -1, vis: true },
    { p: 2, title: "Finish stripped to bare wood", body: "Forty hours of hand work. The mahogany grain underneath is extraordinary.", img: IMG.stringsWood, day: -16, vis: true },
    { p: 2, title: "First polyester coats", body: "Six coats laid, curing between each. The depth is beginning to build.", img: IMG.stringsRed, day: -9, vis: true },
    { p: 2, title: "Internal — color match", body: "Supplier swatch arrived slightly warm; reordered.", img: IMG.antique, day: -7, vis: false },
    { p: 2, title: "Sanding to final gloss", body: "Wet-sanded through 1200 grit. Buffing begins this week.", img: IMG.interiorDetail, day: -6, vis: true },
    { p: 3, title: "Intake photographs", body: "Initial assessment documented. Action wear consistent with a school instrument of this age.", img: IMG.cozyUpright, day: -12, vis: true },
    { p: 4, title: "Action removed", body: "Keys labelled and racked. Balance rail rebushing scheduled next.", img: IMG.ivoryKeys, day: -2, vis: true },
    { p: 5, title: "Rim assessment", body: "The 1924 rim is solid beech — a remarkable survivor. Finish stripping begins once the pinblock blank lands.", img: IMG.castle, day: -8, vis: true },
    { p: 5, title: "Internal — supplier delay", body: "German freight delayed two weeks; reorder schedule affected.", img: IMG.stringsFrame, day: -5, vis: false },
    { p: 7, title: "New wippens installed", body: "Renner wippens fitted and bedding verified across all 88 notes.", img: IMG.woodConcert, day: -5, vis: true },
    { p: 7, title: "Let-off regulation", body: "Regulating to 2mm let-off for the chapel's acoustic. Half the keyboard done.", img: IMG.keysLow, day: -1, vis: false },
    { p: 8, title: "Final tuning complete", body: "Settled beautifully at A=442. Ready to come home.", img: IMG.livingGrand, day: -1, vis: true },
    { p: 8, title: "Delivery scheduled", body: "Skid, ramps and three-person crew booked for Friday morning.", img: IMG.grandSunlit, day: 0, vis: true },
    { p: 9, title: "Regulation complete", body: "Even touch across the compass. Final play-through checklist underway.", img: IMG.chickering, day: -2, vis: true },
  ];
  let pos = 0;
  await db.insert(updates).values(
    u.map((x) => ({
      projectId: P(x.p), title: x.title, body: x.body, imageUrl: x.img,
      updateDate: at(x.day, 10), isVisibleToClient: x.vis, position: ++pos,
    })),
  );

  console.log("Seeding inventory…");
  const inv: [string, string, number, number, number, string, string?][] = [
    ["Bass strings — Röslau custom set", "Strings", 4, 1480000, 2, "Aisle A · Bin 03"],
    ["Plain steel wire 13 gauge (1kg)", "Strings", 12, 42000, 5, "Aisle A · Bin 05"],
    ["Plain steel wire 16 gauge (1kg)", "Strings", 9, 40000, 5, "Aisle A · Bin 06"],
    ["Abel natural felt hammers — grand set", "Hammers & Shanks", 3, 3850000, 1, "Aisle B · Shelf 1"],
    ["Renner wippens — grand (set of 88)", "Action Parts", 1, 5200000, 1, "Aisle B · Shelf 2"],
    ["Wippen flange bushings (pk 100)", "Action Parts", 15, 18500, 6, "Aisle B · Bin 12"],
    ["Jack springs (pk 100)", "Action Parts", 22, 9800, 8, "Aisle B · Bin 14"],
    ["Center pins — nickel 1.30mm (pk 100)", "Action Parts", 30, 12000, 10, "Aisle B · Bin 15"],
    ["Delignit pinblock blank 6×36\"", "Pinblock & Pins", 2, 640000, 1, "Aisle C · Rack 1"],
    ["Blued tuning pins 2/0 (pk 250)", "Pinblock & Pins", 8, 89500, 3, "Aisle C · Bin 02"],
    ["Agraffes — Steinway pattern (ea)", "Plate Hardware", 40, 4200, 12, "Aisle C · Bin 07"],
    ["Keytops — simulated ivory (set 52)", "Key Parts", 5, 240000, 2, "Aisle D · Shelf 3"],
    ["Key bushing cloth — white (meter)", "Felts & Cloth", 14, 5600, 6, "Aisle D · Bin 04"],
    ["Balance rail punchings (pk 500)", "Felts & Cloth", 7, 15400, 4, "Aisle D · Bin 06"],
    ["Damper felt — trichord set", "Felts & Cloth", 6, 96000, 3, "Aisle D · Bin 09"],
    ["Nameboard felt — burgundy (meter)", "Felts & Cloth", 3, 7800, 2, "Aisle D · Bin 11"],
    ["Polyester resin — high build (5L)", "Finishing", 4, 185000, 2, "Finishing Room · Shelf 1"],
    ["Buffing compound — fine (bar)", "Finishing", 11, 6800, 5, "Finishing Room · Shelf 2"],
    ["Wet sandpaper 1200 grit (pk 50)", "Finishing", 18, 5400, 8, "Finishing Room · Bin 3"],
    ["Ebony touch-up dye 250ml", "Finishing", 6, 9200, 3, "Finishing Room · Bin 5"],
    ["Hide glue — pearl (1kg)", "Adhesives", 5, 32000, 2, "Aisle E · Bin 01"],
    ["PVC-E glue (4L)", "Adhesives", 7, 26000, 3, "Aisle E · Bin 02"],
    ["Brass casters — grand (set 3)", "Hardware", 4, 118000, 2, "Aisle F · Bin 01"],
    ["Fallboard decal — gold (custom)", "Hardware", 9, 15500, 4, "Aisle F · Bin 04"],
    ["Felt tempering oil 500ml", "Consumables", 2, 48000, 2, "Aisle E · Bin 08"],
    ["Tuning lever tips — #2 star (pk 5)", "Tools & Consumables", 3, 22000, 2, "Bench Drawer 2"],
  ];
  await db.insert(inventoryItems).values(
    inv.map(([name, category, qty, cost, reorder, location], i) => ({
      name, category, qtyOnHand: qty, unitCostCents: cost, reorderPoint: reorder,
      location, sku: `HP-${String(1000 + i)}`, supplier: i % 3 === 0 ? "Jahn Musik" : i % 3 === 1 ? "Piano Disc Asia" : "Abel / Renner",
    })),
  );

  console.log("Seeding showroom pianos…");
  await db.insert(pianos).values([
    { brand: "Steinway & Sons", model: "Model M", year: 1957, type: "Baby Grand", condition: "Fully Restored", description: "A golden-era Steinway rebuilt by Herrero Pianos — new pinblock, strings, and a hand-voiced Abel hammer set.", technicianNotes: "Board crown excellent after shimming. Tuned and settled at A=442 over four weeks. Even, singing tenor.", dimensions: "170 cm × 146 cm · 290 kg", recommendedUse: "Serious Study", priceCents: 245000000, status: "available", imageUrl: IMG.livingGrand, sortOrder: 1 },
    { brand: "Bösendorfer", model: "170VC", year: 1998, type: "Grand", condition: "Excellent", description: "Vienna Conservatory series with the characteristic warm, dark Bösendorfer voice. Recently regulated and voiced in-house.", technicianNotes: "Action geometry verified to factory spec. New strings in the bass. Remarkably even sustain.", dimensions: "170 cm × 151 cm · 310 kg", recommendedUse: "Performance", priceCents: 480000000, status: "available", imageUrl: IMG.concertHall, sortOrder: 2 },
    { brand: "Fazioli", model: "F156", year: 2005, type: "Grand", condition: "Restored", description: "The smallest Fazioli, and arguably the most jewel-like. Finish and action fully renewed by our shop.", technicianNotes: "Polyester finish re-buffed to showroom gloss. Original action retained — it was exemplary.", dimensions: "156 cm × 149 cm · 300 kg", recommendedUse: "Performance", priceCents: null, status: "available", imageUrl: IMG.modernGrand, sortOrder: 3 },
    { brand: "Yamaha", model: "C3", year: 1999, type: "Grand", condition: "Rebuilt Action", description: "A conservatory favorite with a brand-new Renner action assembly fitted and regulated by our master technician.", technicianNotes: "Wippens and hammers replaced. Let-off at 2.0mm. Very even touch across the compass.", dimensions: "186 cm × 149 cm · 320 kg", recommendedUse: "Institution", priceCents: 165000000, status: "available", imageUrl: IMG.woodConcert, sortOrder: 4 },
    { brand: "Kawai", model: "K-500", year: 2018, type: "Upright", condition: "Like New", description: "Tall Japanese upright with Millennium III action. Light home use only; nearly indistinguishable from new.", technicianNotes: "One-family instrument. Voiced once, holds tune superbly.", dimensions: "130 cm × 62 cm × 149 cm · 240 kg", recommendedUse: "Home", priceCents: 52000000, status: "reserved", imageUrl: IMG.cozyUpright, sortOrder: 5 },
    { brand: "Yamaha", model: "U3", year: 1985, type: "Upright", condition: "Reconditioned", description: "The workhorse of studios and schools worldwide, reconditioned with new strings, hammers, and key bushings.", technicianNotes: "Torque tested. Powerful bass for an upright. Ideal daily driver.", dimensions: "153 cm × 65 cm × 131 cm · 235 kg", recommendedUse: "Studio", priceCents: 38000000, status: "available", imageUrl: IMG.keysLow, sortOrder: 6 },
    { brand: "Blüthner", model: "Model 6", year: 1972, type: "Grand", condition: "Restored", description: "Warm, romantic German voice with Blüthner's patented aliquot stringing in the treble.", technicianNotes: "Cabinet refinished in ebony. Aliquot section intonated carefully — shimmer intact.", dimensions: "190 cm × 152 cm · 330 kg", recommendedUse: "Serious Study", priceCents: 290000000, status: "sold", imageUrl: IMG.castle, sortOrder: 7 },
    { brand: "Boston", model: "GP-156", year: 2012, type: "Grand", condition: "Excellent", description: "Steinway-designed, Kawai-built. Wide-tail design gives it a soundboard area rivaling larger grands.", technicianNotes: "Minimal wear. Regulated and voiced to a warmer American target.", dimensions: "156 cm × 151 cm · 289 kg", recommendedUse: "Home", priceCents: 89000000, status: "available", imageUrl: IMG.chickering, sortOrder: 8 },
  ]);

  console.log("Seeding inquiries…");
  await db.insert(inquiries).values([
    { name: "Lourdes Tan", email: "lourdes.tan@gmail.com", phone: "+63 917 555 2290", pianoContext: "Yamaha U1 (1980-ish)", message: "We inherited my mother-in-law's U1. It hasn't been tuned in years — is reconditioning worth it?", source: "assessment" },
    { name: "Fr. Miguel Ortega", email: "mortega@parish.ph", phone: "+63 2 8555 6621", pianoContext: "Chapel grand — brand unknown", message: "The chapel piano sounds muffled after the flood. Can someone assess whether it can be saved?", source: "assessment" },
    { name: "Hannah Ko", email: "hannahko.music@gmail.com", pianoContext: "Looking for a practice grand", message: "I teach at home and need a small grand under ₱1M. What would you recommend from the showroom?", source: "showroom" },
  ]);

  console.log("Seeding owner workspace…");
  const cats = await db
    .insert(ownerCategories)
    .values([
      { name: "Personal", color: "#1e293b", position: 0 },
      { name: "Client Appointment", color: "#6b93c9", position: 1 },
      { name: "Piano Service", color: "#0f766e", position: 2 },
      { name: "Administration", color: "#64748b", position: 3 },
      { name: "Finance", color: "#5b8fa8", position: 4 },
      { name: "Errand", color: "#4fb8ab", position: 5 },
      { name: "Family", color: "#c97fa8", position: 6 },
      { name: "Focus", color: "#9b8ad1", position: 7 },
      { name: "Supplier", color: "#10b981", position: 8 },
    ])
    .returning();
  const C = (name: string) => cats.find((c) => c.name === name)!.id;

  await db.insert(ownerPreferences).values({
    ownerId: owner.id,
    workingHours: { 0: null, 1: [480, 1080], 2: [480, 1080], 3: [540, 1020], 4: [480, 1080], 5: [480, 1080], 6: [540, 840] },
  });

  const weeklyShopCheck: Recurrence = { freq: "weekly", interval: 1, byDay: [1, 3, 5] };
  const monthlyPayroll: Recurrence = { freq: "monthly", interval: 1 };
  const dailyFocus: Recurrence = { freq: "weekdays", interval: 1 };

  await db.insert(ownerEvents).values([
    { ownerId: owner.id, title: "Shop floor inspection", kind: "event", categoryId: C("Piano Service"), startAt: at(0, 8), endAt: at(0, 8, 45), recurrence: weeklyShopCheck, location: "Atelier" },
    { ownerId: owner.id, title: "Piano tuning — Santos residence", kind: "event", categoryId: C("Client Appointment"), person: "Maria Santos", startAt: at(0, 9, 30), endAt: at(0, 11), location: "Ayala Alabang", reminderMinutes: 60 },
    { ownerId: owner.id, title: "Call Jahn Musik re: Blüthner pinblock", kind: "reminder", categoryId: C("Supplier"), startAt: at(0, 11, 30), endAt: at(0, 11, 45) },
    { ownerId: owner.id, title: "Lunch with Daniel — QC review", kind: "event", categoryId: C("Personal"), startAt: at(0, 13), endAt: at(0, 14) },
    { ownerId: owner.id, title: "FOCUS — Fazioli final buffing oversight", kind: "focus", categoryId: C("Focus"), startAt: at(0, 14), endAt: at(0, 16), recurrence: dailyFocus },
    { ownerId: owner.id, title: "Pickup felt order — courier depot", kind: "event", categoryId: C("Errand"), startAt: at(0, 16, 30), endAt: at(0, 17, 15), location: "LBC Arnaiz" },
    { ownerId: owner.id, title: "Deliver Steinway M — Navarro", kind: "event", categoryId: C("Client Appointment"), person: "Isabella Navarro", startAt: at(2, 9), endAt: at(2, 12), location: "Bonifacio Global City", reminderMinutes: 1440 },
    { ownerId: owner.id, title: "Staff payroll", kind: "event", categoryId: C("Finance"), startAt: at(0, 17), endAt: at(0, 17, 30), recurrence: monthlyPayroll },
    { ownerId: owner.id, title: "Site survey — Cervantes upright", kind: "event", categoryId: C("Client Appointment"), person: "Lourdes Tan", startAt: at(1, 14), endAt: at(1, 15, 30), location: "San Juan" },
    { ownerId: owner.id, title: "Family dinner — Mama's birthday", kind: "event", categoryId: C("Family"), startAt: at(3, 19), endAt: at(3, 21, 30) },
    { ownerId: owner.id, title: "Chapel piano flood assessment", kind: "event", categoryId: C("Piano Service"), person: "Fr. Miguel Ortega", startAt: at(4, 10), endAt: at(4, 11, 30), location: "Sta. Mesa Parish" },
    { ownerId: owner.id, title: "Quarterly tax filing prep", kind: "event", categoryId: C("Finance"), startAt: at(6, 9), endAt: at(6, 11) },
    { ownerId: owner.id, title: "Workshop safety walkthrough", kind: "event", categoryId: C("Administration"), startAt: at(-2, 10), endAt: at(-2, 11), status: "done", completedAt: at(-2, 11) },
  ]);

  await db.insert(ownerTasks).values([
    { ownerId: owner.id, title: "Approve Blüthner restoration quote", priority: "urgent", dueDate: at(-2, 18), categoryId: C("Piano Service"), status: "pending" },
    { ownerId: owner.id, title: "Reply to Mrs. Tan — U1 assessment", priority: "high", dueDate: at(-1, 12), categoryId: C("Client Appointment"), status: "pending" },
    { ownerId: owner.id, title: "Review September payroll", priority: "normal", dueDate: at(0, 18), categoryId: C("Finance"), onToday: true, estimatedMinutes: 45 },
    { ownerId: owner.id, title: "Order Renner hammer felt", priority: "high", dueDate: at(0, 17), categoryId: C("Supplier"), onToday: true, estimatedMinutes: 20, scheduledStart: at(0, 16), scheduledEnd: at(0, 16, 30) },
    { ownerId: owner.id, title: "Post Bösendorfer voicing update to client portal", priority: "normal", dueDate: at(0, 19), categoryId: C("Piano Service"), onToday: true },
    { ownerId: owner.id, title: "Book flight — Manila piano expo", priority: "low", dueDate: at(2, 20), categoryId: C("Personal") },
    { ownerId: owner.id, title: "Renew shop insurance", priority: "normal", dueDate: at(5, 12), categoryId: C("Administration") },
    { ownerId: owner.id, title: "Photograph Seiler intake for file", priority: "normal", dueDate: at(1, 11), categoryId: C("Piano Service"), onToday: true },
    { ownerId: owner.id, title: "Draft conservatory maintenance contract", priority: "high", dueDate: at(3, 17), categoryId: C("Administration"), estimatedMinutes: 90, scheduledStart: at(1, 9), scheduledEnd: at(1, 10, 30) },
    { ownerId: owner.id, title: "Dentist appointment booking", priority: "low", dueDate: at(7, 18), categoryId: C("Personal") },
    { ownerId: owner.id, title: "QC sign-off — Boston GP-178", priority: "high", dueDate: at(1, 16), categoryId: C("Piano Service") },
    { ownerId: owner.id, title: "Send quote — Makati Christian School", priority: "high", dueDate: at(0, 13), categoryId: C("Client Appointment"), status: "done", completedAt: at(0, 11, 20), onToday: true },
    { ownerId: owner.id, title: "Clear spray booth drainage", priority: "normal", categoryId: C("Administration"), status: "done", completedAt: at(-3, 15) },
  ]);

  await db.insert(ownerInbox).values([
    { ownerId: owner.id, title: "Mrs. Santos called about her Yamaha — restore or replace?", priority: "high" },
    { ownerId: owner.id, title: "Check hammer felt pricing with new German supplier", priority: "normal" },
    { ownerId: owner.id, title: "Idea: before/after reel for the Steinway O", priority: "low" },
    { ownerId: owner.id, title: "Jerome asked about Saturday rate", priority: "normal" },
    { ownerId: owner.id, title: "Someone on Facebook asked if we buy old pianos", priority: "low" },
    { ownerId: owner.id, title: "Buy new PO boxes for serial plates", priority: "normal" },
    { ownerId: owner.id, title: "Conservatory wants term tuning contract — draft scope", priority: "high", processedAt: at(-1), convertedType: "task" },
  ]);


  /* ---- Home service workspace ---- */
  console.log("Seeding home service…");
  await db.insert(serviceSettings).values({
    ownerId: owner.id,
    businessName: "Herrero Pianos",
    workingHours: { 0: null, 1: [480, 1080], 2: [480, 1080], 3: [480, 1080], 4: [480, 1080], 5: [480, 1080], 6: [540, 840] },
  });

  const [svcTechA, svcTechB] = await db.insert(serviceTechnicians).values([
    { name: "Jerome Villanueva", title: "Senior Piano Technician", phone: "0917 555 0142", color: "#4d8df0", hourlyRateCents: 32000, billableRateCents: 85000 },
    { name: "Ariel Mendoza", title: "Field Technician", phone: "0917 555 0188", color: "#3fb984", hourlyRateCents: 22000, billableRateCents: 60000 },
  ]).returning();

  const svcCustomers = await db.insert(serviceCustomers).values([
    { name: "Maria Santos", phone: "0917 222 3344", email: "maria.santos@example.com", source: "referral", tags: ["residential"], notes: "Prefers morning appointments." },
    { name: "Isabella Navarro", phone: "0918 888 1122", email: "isa.navarro@example.com", source: "repeat", tags: ["grand", "vip"] },
    { name: "Sta. Mesa Parish", company: "Sta. Mesa Parish", phone: "(082) 221 4477", source: "referral", tags: ["institution", "chapel"] },
    { name: "Lourdes Tan", phone: "0920 334 5566", source: "facebook", tags: ["upright"] },
  ]).returning();

  const svcLocations = await db.insert(serviceLocations).values([
    { customerId: svcCustomers[0].id, label: "Residence", addressLine: "14 Palm Drive, Juna Subdivision", city: "Davao City", area: "Matina", accessNotes: "Gate code 2214", travelMinutes: 25, travelFeeCents: 50000 },
    { customerId: svcCustomers[1].id, label: "Residence", addressLine: "B3 L9 Camella Northpoint", city: "Davao City", area: "Buhangin", accessNotes: "Grand piano on 2nd floor", travelMinutes: 35, travelFeeCents: 70000 },
    { customerId: svcCustomers[2].id, label: "Parish Hall", addressLine: "12 Sta. Mesa Ave.", city: "Davao City", area: "Sta. Mesa", accessNotes: "Ask for Fr. Miguel", travelMinutes: 20, travelFeeCents: 40000 },
    { customerId: svcCustomers[3].id, label: "Condo", addressLine: "Unit 1204 Avida Towers", city: "Davao City", area: "Claro M. Recto", accessNotes: "Service elevator only", travelMinutes: 15, travelFeeCents: 30000 },
  ]).returning();

  const svcPianos = await db.insert(servicePianos).values([
    { customerId: svcCustomers[0].id, locationId: svcLocations[0].id, brand: "Yamaha", model: "U1", type: "Upright", year: 1998, tuningIntervalMonths: 6, lastServiceAt: at(-190), nextServiceDueAt: at(-10) },
    { customerId: svcCustomers[1].id, locationId: svcLocations[1].id, brand: "Kawai", model: "GX-2", type: "Grand", year: 2011, tuningIntervalMonths: 4, lastServiceAt: at(-60), nextServiceDueAt: at(60) },
    { customerId: svcCustomers[2].id, locationId: svcLocations[2].id, brand: "Steinway", model: "Model O", type: "Grand", year: 1926, tuningIntervalMonths: 3, lastServiceAt: at(-95), nextServiceDueAt: at(-5) },
    { customerId: svcCustomers[3].id, locationId: svcLocations[3].id, brand: "Casio", model: "GP-510", type: "Digital", year: 2020, tuningIntervalMonths: 12 },
  ]).returning();

  await db.insert(serviceCatalog).values([
    { name: "Concert tuning", description: "Pitch raise + fine tuning", kind: "service", unitPriceCents: 350000, estimatedMinutes: 90, position: 1 },
    { name: "Standard tuning", description: "Single-pass tuning", kind: "service", unitPriceCents: 250000, estimatedMinutes: 75, position: 2 },
    { name: "Action regulation", description: "Touch and escapement adjustment", kind: "service", unitPriceCents: 650000, estimatedMinutes: 180, position: 3 },
    { name: "Hammer voicing", description: "Tone shaping across the scale", kind: "service", unitPriceCents: 300000, estimatedMinutes: 120, position: 4 },
    { name: "Damper felts (set)", kind: "part", unitPriceCents: 120000, estimatedMinutes: 60, position: 5 },
    { name: "Travel / service call", kind: "fee", unitPriceCents: 50000, estimatedMinutes: 0, position: 6 },
    { name: "Repeat client discount", kind: "discount", unitPriceCents: -25000, estimatedMinutes: 0, position: 7 },
  ]);

  const svcJobs = await db.insert(serviceJobs).values([
    { customerId: svcCustomers[0].id, locationId: svcLocations[0].id, pianoId: svcPianos[0].id, technicianId: svcTechA.id,
      title: "Standard tuning — Yamaha U1", serviceType: "tuning", status: "scheduled", priority: "normal",
      scheduledStart: at(0, 9), scheduledEnd: at(0, 10, 30), estimatedMinutes: 90, travelMinutes: 25, travelFeeCents: 50000 },
    { customerId: svcCustomers[1].id, locationId: svcLocations[1].id, pianoId: svcPianos[1].id, technicianId: svcTechB.id,
      title: "Concert tuning + voicing — Kawai GX-2", serviceType: "tuning", status: "in_progress", priority: "high",
      scheduledStart: at(0, 13), scheduledEnd: at(0, 16), estimatedMinutes: 180, travelMinutes: 35, travelFeeCents: 70000 },
    { customerId: svcCustomers[2].id, locationId: svcLocations[2].id, pianoId: svcPianos[2].id, technicianId: svcTechA.id,
      title: "Chapel piano maintenance visit", serviceType: "maintenance", status: "scheduled", priority: "normal",
      scheduledStart: at(1, 10), scheduledEnd: at(1, 12), estimatedMinutes: 120, travelMinutes: 20, travelFeeCents: 40000 },
    { customerId: svcCustomers[3].id, locationId: svcLocations[3].id, pianoId: svcPianos[3].id,
      title: "Digital piano assessment", serviceType: "assessment", status: "quoted", priority: "low",
      estimatedMinutes: 60, travelFeeCents: 30000 },
  ]).returning();

  const jobA = svcJobs[0], jobB = svcJobs[1], jobC = svcJobs[2], jobD = svcJobs[3];

  await db.insert(serviceJobItems).values([
    { jobId: jobA.id, kind: "service", description: "Standard tuning", qty: 1, unitPriceCents: 250000, taxable: true, minutes: 75, position: 1 },
    { jobId: jobA.id, kind: "fee", description: "Travel / service call", qty: 1, unitPriceCents: 50000, taxable: true, position: 2 },
    { jobId: jobB.id, kind: "service", description: "Concert tuning", qty: 1, unitPriceCents: 350000, taxable: true, minutes: 90, position: 1 },
    { jobId: jobB.id, kind: "service", description: "Hammer voicing", qty: 1, unitPriceCents: 300000, taxable: true, minutes: 120, position: 2 },
    { jobId: jobB.id, kind: "discount", description: "Repeat client discount", qty: 1, unitPriceCents: -25000, taxable: true, position: 3 },
    { jobId: jobC.id, kind: "service", description: "Action regulation", qty: 1, unitPriceCents: 650000, taxable: true, minutes: 180, position: 1 },
    { jobId: jobC.id, kind: "part", description: "Damper felts (set)", qty: 1, unitPriceCents: 120000, taxable: true, position: 2 },
    { jobId: jobD.id, kind: "service", description: "Assessment visit", qty: 1, unitPriceCents: 120000, taxable: true, minutes: 60, position: 1 },
  ]);

  await db.insert(serviceTimeLogs).values([
    { jobId: jobB.id, technicianId: svcTechB.id, kind: "travel", startedAt: at(-1, 12, 30), endedAt: at(-1, 13, 5), minutes: 35, hourlyRateCents: 22000, billable: false },
    { jobId: jobB.id, technicianId: svcTechB.id, kind: "work", startedAt: at(-1, 13, 5), endedAt: at(-1, 16, 20), minutes: 195, hourlyRateCents: 22000 },
  ]);

  await db.insert(serviceJobEvents).values([
    { jobId: jobB.id, type: "created", message: "Job created from repeat booking", actorName: "Owner", at: at(-3, 9) },
    { jobId: jobB.id, type: "started", message: "On site", actorName: "Owner", at: at(-1, 13) },
  ]);

  await db.insert(serviceExpenses).values([
    { category: "fuel", description: "Diesel — Buhangin run", amountCents: 65000, spentAt: at(0, 8), jobId: jobB.id },
    { category: "materials", description: "Damper felt stock", amountCents: 240000, spentAt: at(-4, 11), vendor: "Jahn Musik" },
    { category: "meals", description: "Crew lunch — Sta. Mesa", amountCents: 45000, spentAt: at(1, 12) },
  ]);

  console.log("Seed complete ✔");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
