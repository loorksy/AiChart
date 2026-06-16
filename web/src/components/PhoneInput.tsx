"use client";

import { useEffect, useMemo, useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import { detectCountryFromBrowser } from "@/lib/geoCountry";

const PRIORITY: CountryCode[] = ["SA", "AE", "EG", "KW", "QA", "BH", "OM", "JO", "LB", "IQ"];

const LABELS: Partial<Record<CountryCode, string>> = {
  SA: "السعودية",
  AE: "الإمارات",
  EG: "مصر",
  KW: "الكويت",
  QA: "قطر",
  BH: "البحرين",
  OM: "عُمان",
  JO: "الأردن",
  LB: "لبنان",
  IQ: "العراق",
};

function countryLabel(c: CountryCode, displayNames: Intl.DisplayNames | null): string {
  return LABELS[c] ?? displayNames?.of(c) ?? c;
}

function initialCountry(defaultCountry?: CountryCode): CountryCode {
  if (defaultCountry) return defaultCountry;
  return detectCountryFromBrowser();
}

export function PhoneInput({
  value,
  onChange,
  disabled,
  defaultCountry,
}: {
  value: string;
  onChange: (full: string) => void;
  disabled?: boolean;
  defaultCountry?: CountryCode;
}) {
  const [country, setCountry] = useState<CountryCode>(() => initialCountry(defaultCountry));
  const [local, setLocal] = useState("");

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames(["ar"], { type: "region" });
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (defaultCountry) setCountry(defaultCountry);
  }, [defaultCountry]);

  useEffect(() => {
    const browserCountry = detectCountryFromBrowser();
    if (!defaultCountry) setCountry(browserCountry);

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void fetch("/api/geo/country", {
      cache: "no-store",
      headers: { "X-Timezone": tz },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.country && !defaultCountry) {
          setCountry(d.country as CountryCode);
        }
      })
      .catch(() => {});
  }, [defaultCountry]);

  useEffect(() => {
    if (!value || local) return;
    const parsed = parsePhoneNumberFromString(value);
    if (parsed?.country && parsed.nationalNumber) {
      setCountry(parsed.country);
      setLocal(parsed.nationalNumber);
    }
  }, [value, local]);

  const countries = useMemo(() => {
    const all = getCountries();
    const ordered = [
      ...PRIORITY.filter((c) => all.includes(c)),
      ...all.filter((c) => !PRIORITY.includes(c)).sort(),
    ];
    return ordered;
  }, []);

  function emit(nextCountry: CountryCode, nextLocal: string) {
    const digits = nextLocal.replace(/\D/g, "");
    const code = getCountryCallingCode(nextCountry);
    onChange(digits ? `+${code}${digits}` : "");
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch" dir="ltr">
      <select
        className="input w-full shrink-0 py-2.5 text-sm sm:min-w-[12rem] sm:w-auto"
        value={country}
        disabled={disabled}
        onChange={(e) => {
          const c = e.target.value as CountryCode;
          setCountry(c);
          emit(c, local);
        }}
      >
        {countries.map((c) => {
          const dial = getCountryCallingCode(c);
          const label = countryLabel(c, displayNames);
          return (
            <option key={c} value={c}>
              {label} +{dial}
            </option>
          );
        })}
      </select>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        className="input min-w-0 w-full flex-1 py-2.5"
        placeholder="5xxxxxxxx"
        value={local}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          emit(country, v);
        }}
      />
      {value ? (
        <span className="hidden text-xs text-muted-foreground sm:flex sm:items-center">
          {value}
        </span>
      ) : null}
    </div>
  );
}
