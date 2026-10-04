/**
 * Public-site settings that the owner swaps by hand. Everything marked TODO(owner)
 * needs a real value or photo from you — nothing here is invented.
 */

/**
 * TODO(owner): hero photo. Drop a real showroom/workshop photo into /public/img/
 * (e.g. /public/img/hero-showroom.jpg), then change `src` and `alt` below.
 * `position` is the CSS object-position — nudge it (e.g. "60% 40%") so the piano isn't cropped.
 */
export const HERO_IMAGE = {
  src: "/img/hero.jpg",
  alt: "Interior of the Herrero Pianos atelier with a grand piano", // TODO(owner): describe the new photo
  position: "center",
};

/**
 * TODO(owner): the year Herrero Pianos started serving Davao, e.g. 2009.
 * While this is null the stat shows a visible "[YEAR]" placeholder.
 */
export const SERVING_SINCE_YEAR: number | null = null;

/**
 * TODO(owner): your Facebook page username — the part after facebook.com/ (e.g. "herreropianos").
 * Messenger buttons open m.me/<username>. While empty they fall back to a Facebook search for the page.
 */
export const FACEBOOK_PAGE_USERNAME = "";

export const MESSENGER_URL = FACEBOOK_PAGE_USERNAME
  ? `https://m.me/${FACEBOOK_PAGE_USERNAME}`
  : "https://www.facebook.com/search/pages?q=Herrero%20Pianos";

/** Fallback numbers if the editable contact text has none (kept in sync with the website editor default). */
export const FALLBACK_PHONES = ["09462992247", "09196573154"];

/** Showroom: how many model cards the homepage shows before "See all". */
export const FEATURED_COUNT = 6;
