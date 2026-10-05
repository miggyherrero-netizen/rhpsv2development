/** Title Case for short public-site labels, buttons and headings (never for paragraphs or quotes). Pure — no React. */

const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "nor", "of", "on", "or", "the", "to", "vs", "via", "with"]);

function capWord(w: string): string {
  // Keep tokens that carry their own capitalisation: WiFi, SMS. (Numbers and ₱60k have no leading letter, so they pass through below.)
  if (/[A-Z].*[A-Z]/.test(w.slice(1)) || /^[A-Z]{2,}$/.test(w)) return w;
  // Hyphenated words: capitalise each part ("Davao-based" -> "Davao-Based")
  if (w.includes("-")) return w.split("-").map(capWord).join("-");
  const m = /^([^A-Za-z0-9]*)([A-Za-z])(.*)$/.exec(w);
  return m ? m[1] + m[2].toUpperCase() + m[3] : w;
}

export function titleCase(text: string | null | undefined): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const words = t.split(/(\s+)/);
  const real = words.map((w, i) => ({ w, i })).filter((x) => x.w.trim());
  const first = real[0]?.i, last = real[real.length - 1]?.i;
  return words
    .map((w, i) => {
      if (!w.trim()) return w;
      const bare = w.toLowerCase().replace(/[^a-z]/g, "");
      // Small words stay lower-case, except first, last, and right after a dash, colon or middle dot.
      const prev = real.findIndex((x) => x.i === i) > 0 ? real[real.findIndex((x) => x.i === i) - 1].w : "";
      const afterBreak = /^[—–:·|/]$|[:]$/.test(prev);
      if (SMALL.has(bare) && i !== first && i !== last && !afterBreak) return w.toLowerCase();
      return capWord(w);
    })
    .join("");
}
