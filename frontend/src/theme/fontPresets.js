export const APP_FONT_OPTIONS = [
  "Inter",
  "Roboto",
  "Poppins",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Nunito",
  "Raleway",
  "Ubuntu",
  "Source Sans Pro",
  "DM Sans",
  "Work Sans",
  "Mulish",
  "Quicksand",
  "Manrope",
  "Outfit",
  "Rubik",
  "Josefin Sans",
  "Playfair Display",
  "Merriweather"
];

export const DEFAULT_APP_FONT = APP_FONT_OPTIONS[0];

const FALLBACK_FONT_STACK = '"Helvetica Neue", Arial, sans-serif';

export function resolveAppFont(fontName) {
  const normalized = String(fontName || "").trim().toLowerCase();
  const matched = APP_FONT_OPTIONS.find((font) => font.toLowerCase() === normalized);
  return matched || DEFAULT_APP_FONT;
}

export function toAppFontStack(fontName) {
  const family = resolveAppFont(fontName);
  return `"${family}", ${FALLBACK_FONT_STACK}`;
}

export function buildGoogleFontHref(fontName) {
  const family = resolveAppFont(fontName);
  const encodedFamily = family.replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@400;500;600;700&display=swap`;
}
