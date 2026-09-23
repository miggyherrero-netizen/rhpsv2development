export const WEBSITE_CONTENT_KEY = "publicWebsiteContent";

export type WebsiteContent = {
  hero: {
    eyebrow: string;
    title: string;
    body: string;
    primaryCta: string;
    secondaryCta: string;
  };
  contact: {
    address: string;
    phone: string;
    email: string;
    hours: string;
  };
  process: {
    eyebrow: string;
    title: string;
    steps: { label: string; title: string; body: string }[];
    checks: string[];
  };
  testimonials: { quote: string; name: string; role: string }[];
};

export const defaultWebsiteContent: WebsiteContent = {
  hero: {
    eyebrow: "Davao-based piano sales & service",
    title: "Quiet hands.\nExtraordinary instruments.",
    body: "Herrero Pianos helps families, musicians, schools, churches, studios, and organizations understand, care for, move, and choose acoustic pianos.",
    primaryCta: "Book an assessment",
    secondaryCta: "The showroom",
  },
  contact: {
    address: "Davao City, Philippines",
    phone: "Robert: 0946 299 2247 · Roberto: 0919 657 3154",
    email: "Facebook: Herrero Pianos",
    hours: "Call or message to arrange a piano assessment",
  },
  process: {
    eyebrow: "04 — How We Work",
    title: "Assessment before opinion",
    steps: [
      {
        label: "Step 01",
        title: "Share your piano or situation",
        body: "A few photographs and details — brand, model, age, history — are enough to begin.",
      },
      {
        label: "Step 02",
        title: "We review the actual instrument",
        body: "A technician studies the pinblock, soundboard, action, and environment — not a generic checklist.",
      },
      {
        label: "Step 03",
        title: "Receive an honest next step",
        body: "Tune, regulate, restore, replace — or leave it alone. We tell you which, and why.",
      },
    ],
    checks: ["Pinblock & tuning torque", "Soundboard & crown", "Bridges & strings", "Action geometry", "Keyboard & bushings", "Pedal system", "Cabinet & hinges", "Room environment"],
  },
  testimonials: [
    {
      quote: "They didn't sell me a piano. They assessed what we had, told us honestly what it was worth, and restored my mother's Steinway into the instrument she remembered.",
      name: "Maria Santos",
      role: "Family client — 1911 Steinway O restoration",
    },
    {
      quote: "Our conservatory owns fourteen pianos. Herrero maintains each one on a schedule, documents everything, and the faculty can feel the difference in the action.",
      name: "Dr. James Reyes",
      role: "Institutional piano care",
    },
    {
      quote: "The weekly photographs of the restoration were almost as valuable as the work itself. We watched our piano come back to life from overseas.",
      name: "Atty. Sofia Dela Cruz",
      role: "Fazioli F156 client, Singapore",
    },
  ],
};

const asString = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim() ? value : fallback;

function normalizeSteps(value: unknown): WebsiteContent["process"]["steps"] {
  const source = Array.isArray(value) ? value : [];
  return defaultWebsiteContent.process.steps.map((fallback, index) => {
    const item = source[index] as Partial<WebsiteContent["process"]["steps"][number]> | undefined;
    return {
      label: asString(item?.label, fallback.label),
      title: asString(item?.title, fallback.title),
      body: asString(item?.body, fallback.body),
    };
  });
}

function normalizeTestimonials(value: unknown): WebsiteContent["testimonials"] {
  const source = Array.isArray(value) ? value : [];
  const rows = source
    .slice(0, 6)
    .map((item) => item as Partial<WebsiteContent["testimonials"][number]>)
    .filter((item) => item.quote || item.name || item.role)
    .map((item) => ({
      quote: asString(item.quote, ""),
      name: asString(item.name, "Client"),
      role: asString(item.role, "Herrero Pianos client"),
    }))
    .filter((item) => item.quote);
  return rows.length ? rows : defaultWebsiteContent.testimonials;
}

export function normalizeWebsiteContent(input: unknown): WebsiteContent {
  const raw = (input ?? {}) as Partial<WebsiteContent>;
  return {
    hero: {
      eyebrow: asString(raw.hero?.eyebrow, defaultWebsiteContent.hero.eyebrow),
      title: asString(raw.hero?.title, defaultWebsiteContent.hero.title),
      body: asString(raw.hero?.body, defaultWebsiteContent.hero.body),
      primaryCta: asString(raw.hero?.primaryCta, defaultWebsiteContent.hero.primaryCta),
      secondaryCta: asString(raw.hero?.secondaryCta, defaultWebsiteContent.hero.secondaryCta),
    },
    contact: {
      address: asString(raw.contact?.address, defaultWebsiteContent.contact.address),
      phone: asString(raw.contact?.phone, defaultWebsiteContent.contact.phone),
      email: asString(raw.contact?.email, defaultWebsiteContent.contact.email),
      hours: asString(raw.contact?.hours, defaultWebsiteContent.contact.hours),
    },
    process: {
      eyebrow: asString(raw.process?.eyebrow, defaultWebsiteContent.process.eyebrow),
      title: asString(raw.process?.title, defaultWebsiteContent.process.title),
      steps: normalizeSteps(raw.process?.steps),
      checks: Array.isArray(raw.process?.checks) && raw.process.checks.length
        ? raw.process.checks.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
        : defaultWebsiteContent.process.checks,
    },
    testimonials: normalizeTestimonials(raw.testimonials),
  };
}

export function parseWebsiteContent(value?: string | null): WebsiteContent {
  if (!value) return defaultWebsiteContent;
  try {
    return normalizeWebsiteContent(JSON.parse(value));
  } catch {
    return defaultWebsiteContent;
  }
}
