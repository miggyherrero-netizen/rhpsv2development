import { z } from "zod";

const positiveCentavos = z.number().int().positive();
const optionalCentavos = positiveCentavos.nullable();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const template = z.string().min(1).max(1000);

export const TEMPLATE_KEYS = [
  "newInquiry", "general", "noQuoteFollowUp", "quoteFollowUp", "confirmation",
  "onMyWay", "thankYou", "paymentReminder", "tuningInvite",
] as const;

export const ALLOWED_PLACEHOLDERS = [
  "{name}", "{area}", "{total}", "{date}", "{time}", "{balance}", "{piano}", "{minutes}",
] as const;

export const gosSettingsSchema = z.object({
  prices: z.object({
    tuningCentavos: positiveCentavos,
    cleaningCentavos: optionalCentavos,
    repairLaborCentavos: optionalCentavos,
  }),
  travel: z.object({
    dieselPerLiterCentavos: positiveCentavos,
    kmPerLiter: z.number().positive(),
    vehicleCostPerKmCentavos: optionalCentavos,
    roundTripDefault: z.boolean(),
    homeBase: z.string().trim().min(1).max(60).nullable(),
    roundUpTo10: z.boolean(),
    mealsDefaultCentavos: positiveCentavos,
  }),
  reminders: z.object({
    noReplyMinutes: z.number().int().positive(),
    quoteFollowUpDays: z.number().int().positive(),
    noQuoteDays: z.number().int().positive(),
    visitSameDayTime: hhmm,
    dayBeforeTime: hhmm,
    unpaidDays: z.number().int().positive(),
    unpaidRepeatDays: z.number().int().positive(),
    tuningLeadDays: z.number().int().positive(),
  }),
  replyLanguage: z.enum(["mix", "cebuano", "english"]),
  templates: z.object(Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, template])) as Record<(typeof TEMPLATE_KEYS)[number], typeof template>),
  lostReasons: z.array(z.string().trim().min(1).max(60)).min(1),
  business: z.object({
    name: z.string().trim().min(1).max(80),
    quoteFooter: z.string().max(300),
  }),
  allowance: z.object({
    amountCentavos: positiveCentavos,
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dailyRateCentavos: positiveCentavos,
  }),
});

export type GosSettings = z.infer<typeof gosSettingsSchema>;

export function defaultGosSettings(): GosSettings {
  return {
    prices: { tuningCentavos: 300000, cleaningCentavos: null, repairLaborCentavos: null },
    travel: {
      dieselPerLiterCentavos: 11000, kmPerLiter: 10, vehicleCostPerKmCentavos: null,
      roundTripDefault: true, homeBase: null, roundUpTo10: true, mealsDefaultCentavos: 15000,
    },
    reminders: {
      noReplyMinutes: 60, quoteFollowUpDays: 1, noQuoteDays: 1, visitSameDayTime: "07:00",
      dayBeforeTime: "18:00", unpaidDays: 3, unpaidRepeatDays: 7, tuningLeadDays: 14,
    },
    replyLanguage: "mix",
    templates: {
      newInquiry: "Hi {name}! Salamat sa message. Tuning starts at ₱3,000 depending on location — I'll confirm the final price. Asa dapit imong piano sa {area}?",
      general: "Hi {name}! Salamat sa message. I'll get back to you shortly. — Robert",
      noQuoteFollowUp: "Hi {name}! Following up lang — gusto pa ba nimo ipa-tune imong piano? I can send a quote today.",
      quoteFollowUp: "Hi {name}! Following up on your quote ({total}). Kung OK na, I can set your schedule.",
      confirmation: "Hi {name}! Confirmed: {date}, {time}. Total {total}. See you! — Robert",
      onMyWay: "Hi {name}, on the way na ko, mga {minutes} mins 🙂",
      thankYou: "Salamat kaayo {name}! Your piano is done. Next tuning around {date}.",
      paymentReminder: "Hi {name}! Friendly reminder lang sa balance nga {balance}. Any method OK (cash, GCash, Maya, bank). Salamat!",
      tuningInvite: "Hi {name}! Mga panahon na para sa next tuning sa imong {piano}. Gusto ka ma-schedule?",
    },
    lostReasons: ["Too expensive", "No reply from customer", "Went with someone else", "Just asking", "Other"],
    business: {
      name: "R. Herrero Piano Sales & Services",
      quoteFooter: "Valid 7 days. Any payment method OK (cash, GCash, Maya, bank).",
    },
    allowance: { amountCentavos: 500000, startDate: "2026-10-05", dailyRateCentavos: 50000 },
  };
}

/** "3,000" → 300000 · "110.50" → 11050 · "" → null · "abc" → NaN */
export function pesosToCentavos(text: string): number | null {
  const clean = text.replace(/[₱,\s]/g, "");
  if (clean === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function centavosToPesos(centavos: number | null): string {
  if (centavos === null) return "";
  const whole = Math.floor(centavos / 100).toLocaleString("en-PH");
  const frac = centavos % 100;
  return frac === 0 ? whole : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** Fuel cost per km in centavos, e.g. ₱110/L ÷ 10 km/L = 1100. */
export function fuelPerKmCentavos(s: GosSettings): number {
  return Math.round(s.travel.dieselPerLiterCentavos / s.travel.kmPerLiter);
}

export function unknownPlaceholders(text: string): string[] {
  const found = text.match(/\{[^{}]*\}/g) ?? [];
  const allowed: readonly string[] = ALLOWED_PLACEHOLDERS;
  return [...new Set(found.filter((p) => !allowed.includes(p)))];
}
