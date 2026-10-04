export default function GosEmpty({ title, text }: { title: string; text: string }) {
  return (
    <section className="gos-card mt-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-[var(--gos-ink-dim)]">{text}</p>
    </section>
  );
}
