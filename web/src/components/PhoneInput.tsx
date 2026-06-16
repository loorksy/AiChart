"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CountryCode } from "libphonenumber-js";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import { detectCountryFromBrowser } from "@/lib/geoCountry";
import { cn } from "@/lib/utils";

const PRIORITY: CountryCode[] = [
  "SY",
  "SA",
  "AE",
  "EG",
  "KW",
  "QA",
  "BH",
  "OM",
  "JO",
  "LB",
  "IQ",
];

const LABELS: Partial<Record<CountryCode, string>> = {
  SY: "سوريا",
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
  className,
}: {
  value: string;
  onChange: (full: string) => void;
  disabled?: boolean;
  defaultCountry?: CountryCode;
  className?: string;
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

  const dialCode = getCountryCallingCode(country);

  return (
    <div className={cn("space-y-2", className)} dir="ltr">
      <div
        className={cn(
          "flex overflow-hidden rounded-xl border border-border bg-card",
          "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
          disabled && "opacity-60",
        )}
      >
        <div className="relative shrink-0 border-e border-border sm:w-[10.5rem]">
          <select
            className={cn(
              "h-11 w-full appearance-none bg-transparent py-2 pl-3 pr-8 text-sm",
              "text-foreground outline-none",
              "max-w-[9.5rem] sm:max-w-none",
            )}
            value={country}
            disabled={disabled}
            aria-label="رمز الدولة"
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
          <ChevronDown
            className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            +{dialCode}
          </span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="9xxxxxxxx"
            value={local}
            disabled={disabled}
            aria-label="رقم الهاتف"
            onChange={(e) => {
              const v = e.target.value;
              setLocal(v);
              emit(country, v);
            }}
          />
        </div>
      </div>

      {value ? (
        <p className="text-end text-xs tabular-nums text-muted-foreground">{value}</p>
      ) : (
        <p className="text-end text-xs text-muted-foreground">
          أدخل رقم واتساب بدون صفر في البداية
        </p>
      )}
    </div>
  );
}
