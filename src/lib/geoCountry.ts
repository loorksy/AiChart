import type { CountryCode } from "libphonenumber-js";
import { getCountries } from "libphonenumber-js";

const VALID = new Set(getCountries());

const TIMEZONE_COUNTRY: Record<string, CountryCode> = {
  "Asia/Riyadh": "SA",
  "Asia/Dubai": "AE",
  "Asia/Kuwait": "KW",
  "Asia/Qatar": "QA",
  "Asia/Bahrain": "BH",
  "Asia/Muscat": "OM",
  "Asia/Amman": "JO",
  "Asia/Beirut": "LB",
  "Asia/Baghdad": "IQ",
  "Asia/Damascus": "SY",
  "Asia/Gaza": "PS",
  "Asia/Hebron": "PS",
  "Asia/Aden": "YE",
  "Asia/Khartoum": "SD",
  "Africa/Cairo": "EG",
  "Africa/Tripoli": "LY",
  "Africa/Algiers": "DZ",
  "Africa/Casablanca": "MA",
  "Africa/Tunis": "TN",
  "Europe/London": "GB",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Rome": "IT",
  "Europe/Madrid": "ES",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Zurich": "CH",
  "Europe/Vienna": "AT",
  "Europe/Istanbul": "TR",
  "Europe/Moscow": "RU",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Toronto": "CA",
  "Asia/Kolkata": "IN",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Jakarta": "ID",
  "Asia/Singapore": "SG",
  "Asia/Tokyo": "JP",
  "Asia/Seoul": "KR",
  "Asia/Shanghai": "CN",
  "Asia/Hong_Kong": "HK",
  "Australia/Sydney": "AU",
};

function isValidCountry(code: string | null | undefined): code is CountryCode {
  return Boolean(code && VALID.has(code as CountryCode));
}

function countryFromAcceptLanguage(raw: string | null): CountryCode | null {
  if (!raw) return null;
  for (const part of raw.split(",")) {
    const tag = part.split(";")[0]?.trim();
    const region = tag?.split("-")[1]?.toUpperCase();
    if (isValidCountry(region)) return region;
  }
  return null;
}

function countryFromTimezone(tz: string | null | undefined): CountryCode | null {
  if (!tz) return null;
  return TIMEZONE_COUNTRY[tz] ?? null;
}

/** Unified detection: IP headers → client timezone → Accept-Language → SA. */
export function detectCountryFromRequest(
  headers: Headers,
  clientTz?: string | null,
): CountryCode {
  const ipCountry =
    headers.get("cf-ipcountry") ??
    headers.get("CF-IPCountry") ??
    headers.get("x-vercel-ip-country");
  if (ipCountry && ipCountry !== "XX" && isValidCountry(ipCountry.toUpperCase())) {
    return ipCountry.toUpperCase() as CountryCode;
  }

  const tz =
    clientTz?.trim() ||
    headers.get("x-timezone") ||
    headers.get("X-Timezone");
  const fromTz = countryFromTimezone(tz);
  if (fromTz) return fromTz;

  const fromLang = countryFromAcceptLanguage(headers.get("accept-language"));
  if (fromLang) return fromLang;

  return "SA";
}

/** Detect ISO country from request headers (SSR / API). Falls back to SA. */
export function detectCountryFromHeaders(headers: Headers): CountryCode {
  return detectCountryFromRequest(headers);
}

/** Client-side fallback when headers are unavailable. */
export function detectCountryFromBrowser(): CountryCode {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fromTz = countryFromTimezone(tz);
    if (fromTz) return fromTz;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined") {
    const fromLang = countryFromAcceptLanguage(navigator.language);
    if (fromLang) return fromLang;
    const region = navigator.language?.split("-")[1]?.toUpperCase();
    if (isValidCountry(region)) return region;
  }
  return "SA";
}
