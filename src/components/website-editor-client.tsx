"use client";

import { useState } from "react";
import { BadgeCheck, Contact, FileText, ListChecks, Quote, Save, Sparkles } from "lucide-react";
import type { WebsiteContent } from "@/lib/website-content";
import { saveWebsiteContent } from "@/server/admin";
import { Spinner } from "@/components/ui";

type Step = WebsiteContent["process"]["steps"][number];
type Testimonial = WebsiteContent["testimonials"][number];

const input = "input-dark";
const label = "block text-[10.5px] uppercase tracking-[0.18em] text-mist mb-1.5";

function TextInput({
  title,
  value,
  onChange,
  placeholder,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={label}>{title}</span>
      <input className={input} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function TextArea({
  title,
  value,
  onChange,
  rows = 3,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className={label}>{title}</span>
      <textarea className={`${input} resize-y`} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Section({
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card-dark p-5">
      <div className="flex items-center gap-2.5 mb-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] border border-white/10 text-sky-200">
          <Icon size={16} />
        </span>
        <div>
          <p className="text-[9.5px] uppercase tracking-[0.24em] text-mist/70">{eyebrow}</p>
          <h2 className="font-serif text-xl text-white">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function WebsiteEditorClient({ initialContent }: { initialContent: WebsiteContent }) {
  const [content, setContent] = useState(initialContent);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const setHero = (patch: Partial<WebsiteContent["hero"]>) =>
    setContent((cur) => ({ ...cur, hero: { ...cur.hero, ...patch } }));
  const setContact = (patch: Partial<WebsiteContent["contact"]>) =>
    setContent((cur) => ({ ...cur, contact: { ...cur.contact, ...patch } }));
  const setProcess = (patch: Partial<WebsiteContent["process"]>) =>
    setContent((cur) => ({ ...cur, process: { ...cur.process, ...patch } }));
  const updateStep = (index: number, patch: Partial<Step>) =>
    setContent((cur) => ({
      ...cur,
      process: {
        ...cur.process,
        steps: cur.process.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
      },
    }));
  const updateTestimonial = (index: number, patch: Partial<Testimonial>) =>
    setContent((cur) => ({
      ...cur,
      testimonials: cur.testimonials.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));

  async function save() {
    setBusy(true);
    await saveWebsiteContent(content);
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
      <div className="space-y-5">
        <Section icon={Sparkles} eyebrow="Public homepage" title="Hero and calls to action">
          <div className="grid sm:grid-cols-2 gap-4">
            <TextInput title="Eyebrow" value={content.hero.eyebrow} onChange={(eyebrow) => setHero({ eyebrow })} />
            <TextInput title="Primary CTA" value={content.hero.primaryCta} onChange={(primaryCta) => setHero({ primaryCta })} />
            <div className="sm:col-span-2">
              <TextArea title="Headline" value={content.hero.title} onChange={(title) => setHero({ title })} rows={2} />
            </div>
            <div className="sm:col-span-2">
              <TextArea title="Supporting copy" value={content.hero.body} onChange={(body) => setHero({ body })} />
            </div>
            <TextInput title="Secondary CTA" value={content.hero.secondaryCta} onChange={(secondaryCta) => setHero({ secondaryCta })} />
          </div>
        </Section>

        <Section icon={Contact} eyebrow="Assessment section" title="Contact details">
          <div className="grid sm:grid-cols-2 gap-4">
            <TextInput title="Phone" value={content.contact.phone} onChange={(phone) => setContact({ phone })} />
            <TextInput title="Email" value={content.contact.email} onChange={(email) => setContact({ email })} />
            <div className="sm:col-span-2">
              <TextInput title="Address" value={content.contact.address} onChange={(address) => setContact({ address })} />
            </div>
            <TextInput title="Hours" value={content.contact.hours} onChange={(hours) => setContact({ hours })} />
          </div>
        </Section>

        <Section icon={ListChecks} eyebrow="Homepage process" title="Assessment workflow">
          <div className="grid sm:grid-cols-2 gap-4 mb-5">
            <TextInput title="Eyebrow" value={content.process.eyebrow} onChange={(eyebrow) => setProcess({ eyebrow })} />
            <TextInput title="Section title" value={content.process.title} onChange={(title) => setProcess({ title })} />
          </div>
          <div className="grid lg:grid-cols-3 gap-3">
            {content.process.steps.map((step, index) => (
              <div key={index} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 space-y-3">
                <TextInput title="Step label" value={step.label} onChange={(value) => updateStep(index, { label: value })} />
                <TextInput title="Title" value={step.title} onChange={(value) => updateStep(index, { title: value })} />
                <TextArea title="Body" value={step.body} onChange={(value) => updateStep(index, { body: value })} rows={4} />
              </div>
            ))}
          </div>
        </Section>

        <Section icon={BadgeCheck} eyebrow="Assessment chips" title="What we check">
          <TextArea
            title="One item per line"
            value={content.process.checks.join("\n")}
            rows={6}
            onChange={(value) => setProcess({ checks: value.split("\n").map((item) => item.trim()).filter(Boolean) })}
          />
        </Section>

        <Section icon={Quote} eyebrow="Social proof" title="Testimonials">
          <div className="grid lg:grid-cols-3 gap-3">
            {content.testimonials.map((item, index) => (
              <div key={index} className="rounded-xl border border-white/10 bg-white/[0.025] p-4 space-y-3">
                <TextArea title="Quote" value={item.quote} onChange={(quote) => updateTestimonial(index, { quote })} rows={5} />
                <TextInput title="Name" value={item.name} onChange={(name) => updateTestimonial(index, { name })} />
                <TextInput title="Role" value={item.role} onChange={(role) => updateTestimonial(index, { role })} />
                <TextInput title="Photo URL (optional)" value={item.photo ?? ""} onChange={(photo) => updateTestimonial(index, { photo })} />
                <div className="grid grid-cols-2 gap-3">
                  <TextInput title="Location (optional)" value={item.location ?? ""} onChange={(location) => updateTestimonial(index, { location })} />
                  <TextInput title="Year (optional)" value={item.year ?? ""} onChange={(year) => updateTestimonial(index, { year })} />
                </div>
                <TextInput title="Facebook review link (optional)" value={item.reviewUrl ?? ""} onChange={(reviewUrl) => updateTestimonial(index, { reviewUrl })} />
              </div>
            ))}
          </div>
        </Section>
      </div>

      <aside className="xl:sticky xl:top-7 self-start space-y-4">
        <section className="card-dark p-5">
          <p className="text-[10px] uppercase tracking-[0.22em] text-mist mb-2">Publishing</p>
          <p className="text-[12.5px] text-chrome/80 leading-relaxed">
            Changes update the public homepage immediately after saving. The showroom list still comes from piano records.
          </p>
          <button
            onClick={save}
            disabled={busy}
            className="mt-4 w-full bg-white text-black text-[13px] font-medium rounded-xl py-3 hover:bg-chrome transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy ? <Spinner className="text-black" /> : <Save size={14} />} {saved ? "Saved" : "Save website"}
          </button>
        </section>

        <section className="card-dark p-5">
          <p className="text-[10px] uppercase tracking-[0.22em] text-mist mb-2">Editor scope</p>
          <ul className="space-y-2 text-[12.5px] text-chrome/80">
            <li className="flex gap-2"><FileText size={14} className="text-mist mt-0.5 shrink-0" /> Homepage copy is editable here.</li>
            <li className="flex gap-2"><ListChecks size={14} className="text-mist mt-0.5 shrink-0" /> Pianos remain database-driven showroom records.</li>
            <li className="flex gap-2"><Quote size={14} className="text-mist mt-0.5 shrink-0" /> Testimonials are fixed to the current three-card layout.</li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
