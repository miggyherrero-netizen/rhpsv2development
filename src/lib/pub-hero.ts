/**
 * Hero photo shade. The page measures how bright the photo is behind the words and shades only as much as the words need:
 * a dark photo (like a grand piano in low light) gets no shade at all, a bright one gets enough for white text to stay readable.
 * Pure — no React, no DOM.
 */

/** WCAG relative luminance of an sRGB colour (0–255 per channel): 0 = black, 1 = white. */
export function relLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The value at fraction `p` (0–1) of the list; 0 for an empty list. Used with 0.9 so a few bright spots still count. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]!;
}

const COAL_LUMINANCE = 0.027;
/** White text needs a background no brighter than this for 4.5:1 (1.05 / 4.5 − 0.05). */
export const MAX_BG_LUMINANCE = 0.183;
/** Opacity of the strongest part of the shade gradient (what `shade = 1` means). */
export const SHADE_PEAK = 0.85;

/**
 * 0 … 1 — how much of the full shade to show for a photo whose brightest-90% luminance behind the words is `lum`.
 * Derived from: lum·(1−a) + coal·a ≤ MAX_BG_LUMINANCE, with a = SHADE_PEAK·shade.
 */
export function scrimStrength(lum: number): number {
  if (!Number.isFinite(lum) || lum <= MAX_BG_LUMINANCE) return 0;
  const alpha = (lum - MAX_BG_LUMINANCE) / (lum - COAL_LUMINANCE);
  return Math.min(1, Math.max(0, alpha / SHADE_PEAK));
}

/**
 * The words sit on the brightest 10% of the area plus a few spots a coarse sample misses, so measure with some margin.
 * A photo whose bright areas are darker than MAX_BG_LUMINANCE / READ_MARGIN still gets no shade at all.
 */
export const READ_MARGIN = 1.25;

/** Used until the photo has been measured, or when it cannot be read (blocked by the browser): a middle setting that keeps text readable. */
export const FALLBACK_SHADE = 0.6;
