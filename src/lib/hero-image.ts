/** Uploaded hero photo: stored as a data URL in `settings`, served by /hero-image. */
export const HERO_IMAGE_KEY = "publicHeroImage";
/** ~3MB of binary once base64-encoded (the client downsizes well below this). */
export const HERO_IMAGE_MAX_CHARS = 4_200_000;
export const HERO_IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
