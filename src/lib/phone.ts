import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

const DEFAULT_COUNTRY = (process.env.DEFAULT_PHONE_COUNTRY ?? "SA") as CountryCode;

export function normalizeWhatsApp(
  raw: string,
  defaultCountry: CountryCode = DEFAULT_COUNTRY,
): { ok: true; e164: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "رقم واتساب مطلوب." };
  }
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    return { ok: false, error: "رقم واتساب غير صالح. تأكد من النداء والرقم." };
  }
  return { ok: true, e164: parsed.format("E.164") };
}

export function formatWhatsAppDisplay(e164: string | null | undefined): string {
  if (!e164) return "—";
  const parsed = parsePhoneNumberFromString(e164);
  return parsed?.formatInternational() ?? e164;
}
