/** Website content normalisation + hero upload validation. No database. Run: npx tsx tests/website-content.ts */
import { normalizeWebsiteContent, defaultWebsiteContent } from "../src/lib/website-content";
import { HERO_IMAGE_RE } from "../src/lib/hero-image";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`  ✗ ${name}\n      expected ${e}\n      actual   ${a}`); }
  else console.log(`  ✓ ${name}`);
}

const t = (o: object) => normalizeWebsiteContent({ testimonials: [{ quote: "q", name: "n", role: "r", ...o }] }).testimonials[0];
check("real details are kept", t({ location: "Davao", year: "2024", reviewUrl: "https://facebook.com/x" }).reviewUrl, "https://facebook.com/x");
check("javascript: link is dropped", t({ reviewUrl: "javascript:alert(1)" }).reviewUrl, undefined);
check("protocol-relative link is dropped", t({ photo: "//evil.test/a.jpg" }).photo, undefined);
check("site-relative photo is kept", t({ photo: "/img/a.jpg" }).photo, "/img/a.jpg");
check("blank optional fields stay undefined (nothing invented)", [t({ location: " " }).location, t({}).year], [undefined, undefined]);
check("default testimonials carry no made-up details", defaultWebsiteContent.testimonials.every((x) => !x.photo && !x.location && !x.year && !x.reviewUrl), true);
check("hero version round-trips", normalizeWebsiteContent({ hero: { imageVersion: "123" } }).hero.imageVersion, "123");
check("jpeg data URL accepted", HERO_IMAGE_RE.test("data:image/jpeg;base64,/9j/4AAQ=="), true);
check("svg data URL rejected", HERO_IMAGE_RE.test("data:image/svg+xml;base64,PHN2Zz4="), false);
check("html data URL rejected", HERO_IMAGE_RE.test("data:text/html;base64,PGI+"), false);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall website-content checks passed");
