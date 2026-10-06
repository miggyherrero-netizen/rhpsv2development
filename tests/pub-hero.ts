/** Hero shade from photo brightness. No DOM. Run: npx tsx tests/pub-hero.ts */
import { relLuminance, percentile, scrimStrength, MAX_BG_LUMINANCE, SHADE_PEAK, FALLBACK_SHADE, READ_MARGIN } from "../src/lib/pub-hero";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}
const near = (x: number, y: number, tol = 0.01) => Math.abs(x - y) <= tol;

console.log("luminance");
check("black / white", [relLuminance(0, 0, 0), Math.round(relLuminance(255, 255, 255) * 1000) / 1000], [0, 1]);
check("a mid warm brown is dark", relLuminance(120, 80, 50) < 0.12, true);

console.log("\npercentile");
check("90th of 1..10", percentile([5, 1, 3, 2, 4, 6, 7, 8, 9, 10], 0.9), 10);
check("median-ish and empty", [percentile([1, 2, 3], 0.5), percentile([], 0.9)], [2, 0]);

console.log("\nshade strength");
check("a dark photo gets NO shade", [scrimStrength(0), scrimStrength(0.05), scrimStrength(MAX_BG_LUMINANCE)], [0, 0, 0]);
check("a very bright photo gets the full shade", scrimStrength(0.9) > 0.95, true);
check("it rises with brightness and never exceeds 1", [scrimStrength(0.25) < scrimStrength(0.4), scrimStrength(0.4) < scrimStrength(0.8), scrimStrength(1) <= 1], [true, true, true]);
check("bad input is treated as no shade, not NaN", [scrimStrength(NaN), scrimStrength(-1)], [0, 0]);
// The promise: with the shade applied, white text still gets 4.5:1 against the photo.
const worstCase = [0.2, 0.3, 0.5, 0.7, 0.9, 1].every((lum) => {
  const a = SHADE_PEAK * scrimStrength(lum);
  const bg = lum * (1 - a) + 0.027 * a;
  return 1.05 / (bg + 0.05) >= 4.5 - 0.02;
});
check("white text stays at 4.5:1 for every photo brightness", worstCase, true);
check("a dark photo still gets no shade once the safety margin is applied", scrimStrength(0.12 * READ_MARGIN), 0);
check("fallback is a middle setting", near(FALLBACK_SHADE, 0.6, 0.2), true);

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall hero-shade checks passed");
