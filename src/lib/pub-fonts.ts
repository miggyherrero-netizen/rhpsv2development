/**
 * Public-site typefaces: Cormorant Garamond (display serif, headings and prices, used at >= 28px only) and
 * Montserrat (body, UI). Loaded here, not in the root layout, so admin / owner / service pages never download them.
 * `PUB_FONT_VARS` goes on the public wrapper; `.pub-theme` in globals.css points --font-serif / --font-sans at them.
 */
import { Cormorant_Garamond, Montserrat } from "next/font/google";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  weight: ["500", "600", "700"],
  display: "swap",
});
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap" });

export const PUB_FONT_VARS = `${cormorant.variable} ${montserrat.variable}`;
/** Everything a public page root needs: palette scope + font variables. */
export const PUB_ROOT = `pub-theme ${PUB_FONT_VARS}`;
