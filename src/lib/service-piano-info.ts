/**
 * A customer saved from the type-to-search field gets a first piano right away, even when nobody typed one. The brand is
 * the placeholder "N/A" (the column is NOT NULL) and the model stays empty, until the owner fills in the real piano.
 * Pure helpers, no database.
 */

export const PIANO_PLACEHOLDER = "N/A";

const isBlankOrPlaceholder = (v: string | null | undefined): boolean => {
  const s = (v ?? "").trim().toLowerCase();
  return s === "" || s === PIANO_PLACEHOLDER.toLowerCase();
};

/** True while the brand or the model is still empty or the "N/A" placeholder: the piano shows a "Needs piano info" badge. */
export function isPianoInfoMissing(p: { brand?: string | null; model?: string | null }): boolean {
  return isBlankOrPlaceholder(p.brand) || isBlankOrPlaceholder(p.model);
}

/** The brand to show as a real brand: empty when it is only the placeholder. */
export const realBrand = (brand: string | null | undefined): string => (isBlankOrPlaceholder(brand) ? "" : (brand ?? "").trim());
export const realModel = (model: string | null | undefined): string => (isBlankOrPlaceholder(model) ? "" : (model ?? "").trim());

/** The piano part of a waitlist row on the owner's screens: the label, "Piano (info needed)", or the empty-state text. */
export function waitlistPianoText(i: { pianoLabel: string | null; pianoInfoMissing: boolean }, none = "No piano chosen"): string {
  return i.pianoLabel ?? (i.pianoInfoMissing ? "Piano (info needed)" : none);
}

/** "Yamaha U1", or "Piano (info needed)" when the brand is still the placeholder. */
export function pianoLabel(p: { brand?: string | null; model?: string | null }): string {
  const brand = realBrand(p.brand);
  if (!brand) return "Piano (info needed)";
  return [brand, realModel(p.model)].filter(Boolean).join(" ");
}
