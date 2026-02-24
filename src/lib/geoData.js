import { Country, State } from "country-state-city";

function normalizeText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const COUNTRY_ALIASES = {
  us: "US",
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  uk: "GB",
  "united kingdom": "GB",
  uae: "AE",
  "united arab emirates": "AE"
};

const ALL_COUNTRIES = Country.getAllCountries()
  .map((country) => ({
    name: country.name,
    isoCode: country.isoCode
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const COUNTRIES_BY_ISO = new Map(ALL_COUNTRIES.map((country) => [country.isoCode, country]));
const COUNTRY_ISO_BY_NAME = new Map(
  ALL_COUNTRIES.map((country) => [normalizeText(country.name), country.isoCode])
);

export function listAllCountries() {
  return ALL_COUNTRIES;
}

export function resolveCountryIsoCode(countryValue = "") {
  const normalized = normalizeText(countryValue);
  if (!normalized) return "";

  const aliasHit = COUNTRY_ALIASES[normalized];
  if (aliasHit) return aliasHit;

  const namedHit = COUNTRY_ISO_BY_NAME.get(normalized);
  if (namedHit) return namedHit;

  const maybeIso = String(countryValue || "")
    .trim()
    .toUpperCase();
  if (COUNTRIES_BY_ISO.has(maybeIso)) return maybeIso;

  return "";
}

export function getCanonicalCountryName(countryValue = "") {
  const isoCode = resolveCountryIsoCode(countryValue);
  if (!isoCode) return String(countryValue || "").trim();
  return COUNTRIES_BY_ISO.get(isoCode)?.name || String(countryValue || "").trim();
}

export function listStatesByCountry(countryValue = "") {
  const isoCode = resolveCountryIsoCode(countryValue);
  if (!isoCode) return [];

  return State.getStatesOfCountry(isoCode)
    .map((state) => ({
      name: state.name,
      isoCode: state.isoCode
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
