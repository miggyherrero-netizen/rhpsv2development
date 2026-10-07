/**
 * Home Service typefaces: Outfit (headings) + Work Sans (body, tabular numerals for money/time).
 * Loaded here, not in the root layout, so other areas never download them. `SVC_FONT_VARS` goes on the
 * service wrapper; `.svc-shell` in globals.css points --font-sans / --font-serif at them.
 */
import { Outfit, Work_Sans } from "next/font/google";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-svc-head", display: "swap" });
const workSans = Work_Sans({ subsets: ["latin"], variable: "--font-svc-body", display: "swap" });

export const SVC_FONT_VARS = `${outfit.variable} ${workSans.variable}`;
