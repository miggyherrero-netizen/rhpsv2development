/**
 * Public-site typefaces: Fraunces (warm, soft serif for headings and prices) and Instrument Sans (body).
 * Loaded here, not in the root layout, so admin / owner / service pages never download them.
 * `PUB_FONT_VARS` goes on the public wrapper; `.pub-theme` in globals.css points --font-serif / --font-sans at them.
 */
import { Fraunces, Instrument_Sans } from "next/font/google";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", axes: ["opsz"], display: "swap" });
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });

export const PUB_FONT_VARS = `${fraunces.variable} ${instrument.variable}`;
/** Everything a public page root needs: palette scope + font variables. */
export const PUB_ROOT = `pub-theme ${PUB_FONT_VARS}`;
