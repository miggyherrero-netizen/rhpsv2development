"use client";

import { useRef, useState } from "react";
import { BadgeCheck, Contact, FileText, ImageIcon, ListChecks, Quote, Save, Sparkles, Trash2, Upload } from "lucide-react";
import type { WebsiteContent } from "@/lib/website-content";
import { removeHeroImage, saveHeroImage, saveWebsiteContent } from "@/server/admin";
import { HERO_IMAGE } from "@/lib/site-config";
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

/** Shrinks any photo to <=2400px JPEG in the browser so phone photos upload fast and stay small. */
function downsize(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 2400 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("read")); };
    img.src = url;
  });
}

function HeroPhoto({ version, alt, onChange }: { version?: string; alt: string; onChange: (v: { version?: string; alt: string }) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(alt);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const current = version ? `/hero-image?v=${version}` : HERO_IMAGE.src;

  async function pick(file?: File) {
    setMsg("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return setMsg("Please choose an image file.");
    setBusy(true);
    try {
      const res = await saveHeroImage(await downsize(file), text);
      if (res.ok) { onChange({ version: res.version, alt: res.alt }); setMsg("Uploaded — the homepage is updated."); }
      else setMsg(res.error);
    } catch {
      setMsg("Couldn't read that file — try a JPG or PNG.");
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function remove() {
    setBusy(true);
    await removeHeroImage();
    onChange({ version: undefined, alt: "" });
    setText("");
    setMsg("Removed — the default image is showing again.");
    setBusy(false);
  }

  return (
    <div className="grid sm:grid-cols-[220px_minmax(0,1fr)] gap-5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={current} alt="Current hero photo" className="w-full aspect-[4/3] object-cover rounded-xl border border-white/10" />
      <div className="space-y-3">
        <p className="text-[12.5px] text-chrome/80 leading-relaxed">
          Upload a real showroom or workshop photo (landscape works best, with the piano toward the centre). It replaces the homepage hero straight away.
        </p>
        <TextInput title="Describe the photo (alt text)" value={text} onChange={setText} placeholder="e.g. Grand piano in the Herrero showroom, Davao" />
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 bg-white text-black text-[13px] font-medium rounded-xl px-4 py-2.5 hover:bg-chrome transition disabled:opacity-60">
            {busy ? <Spinner className="text-black" /> : <Upload size={14} />} {version ? "Replace photo" : "Upload photo"}
          </button>
          {version && (
            <button type="button" disabled={busy} onClick={remove}
              className="inline-flex items-center gap-2 text-[13px] rounded-xl px-4 py-2.5 border border-white/10 text-chrome hover:bg-white/5 transition disabled:opacity-60">
              <Trash2 size={14} /> Use default
            </button>
          )}
        </div>
        {msg && <p role="status" className="text-[12px] text-chrome/80">{msg}</p>}
      </div>
    </div>
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

        <Section icon={ImageIcon} eyebrow="Public homepage" title="Hero photo">
          <HeroPhoto
            version={content.hero.imageVersion}
            alt={content.hero.imageAlt ?? ""}
            onChange={({ version, alt }) => setContent((cur) => ({ ...cur, hero: { ...cur.hero, imageVersion: version, imageAlt: alt || undefined } }))}
          />
          <p className="text-[11.5px] text-mist mt-3">The alt text is saved with the photo. Other website text still needs “Save website”.</p>
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
