"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { SurfaceCard } from "@/components/ui/shell";
import { PhoneInput } from "@/components/PhoneInput";
import { formatWhatsAppDisplay } from "@/lib/phone";
import { formatAccessExpiryLabel } from "@/lib/platformAccess";
import type { PublicUser } from "@/lib/types";
import { displayNameForUser } from "@/lib/displayName";
import { needsMcpCredentials } from "@/lib/userCredentials";

export function UserAccountClient({ user }: { user: PublicUser }) {
  const [whatsapp, setWhatsapp] = useState(user.whatsapp_e164 ?? "");
  const [savedWhatsapp, setSavedWhatsapp] = useState(user.whatsapp_e164);
  const [editingWhatsapp, setEditingWhatsapp] = useState(!user.whatsapp_e164);
  const [defaultCountry, setDefaultCountry] = useState<CountryCode | undefined>(() => {
    if (user.whatsapp_e164) {
      return parsePhoneNumberFromString(user.whatsapp_e164)?.country;
    }
    return undefined;
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsCredentials = needsMcpCredentials(user);

  useEffect(() => {
    if (user.whatsapp_e164) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void fetch("/api/geo/country", {
      cache: "no-store",
      headers: { "X-Timezone": tz },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.country) setDefaultCountry(d.country as CountryCode);
      })
      .catch(() => {});
  }, [user.whatsapp_e164]);

  async function saveWhatsapp() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatsapp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "فشل الحفظ.");
        return;
      }
      setMsg("تم الحفظ.");
      setSavedWhatsapp(data.user?.whatsapp_e164 ?? whatsapp);
      setEditingWhatsapp(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">حسابي</h1>
      <SurfaceCard className="space-y-4 text-sm">
        <div>
          <p className="text-muted-foreground">اسم المستخدم</p>
          <p dir="ltr">{user.username ?? "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">البريد</p>
          {needsCredentials ? (
            <div className="mt-1 space-y-2">
              <p className="text-muted-foreground">لم يُضبط بعد — مطلوب لـ MCP</p>
              <Link href="/complete-profile" className="text-link text-sm">
                إكمال بريد وكلمة المرور
              </Link>
            </div>
          ) : (
            <p dir="ltr">{user.email}</p>
          )}
        </div>
        <div>
          <p className="text-muted-foreground">صلاحية الحساب</p>
          <p>{formatAccessExpiryLabel(user.access_expires_at)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Telegram</p>
          <p>{user.telegram_id ? "مرتبط" : "—"}</p>
        </div>
        <div>
          <p className="mb-2 text-muted-foreground">واتساب</p>
          {savedWhatsapp && !editingWhatsapp ? (
            <div className="flex flex-wrap items-center gap-2">
              <p dir="ltr">{formatWhatsAppDisplay(savedWhatsapp)}</p>
              <button
                type="button"
                className="text-xs text-link"
                onClick={() => {
                  setWhatsapp(savedWhatsapp);
                  setEditingWhatsapp(true);
                }}
              >
                تعديل
              </button>
            </div>
          ) : (
            <>
              <PhoneInput
                value={whatsapp}
                onChange={setWhatsapp}
                disabled={busy}
                defaultCountry={defaultCountry}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary text-sm"
                  disabled={busy}
                  onClick={() => void saveWhatsapp()}
                >
                  {busy ? "…" : "حفظ واتساب"}
                </button>
                {savedWhatsapp && (
                  <button
                    type="button"
                    className="btn btn-secondary text-sm"
                    disabled={busy}
                    onClick={() => {
                      setWhatsapp(savedWhatsapp);
                      setEditingWhatsapp(false);
                    }}
                  >
                    إلغاء
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {msg && <p className="text-primary">{msg}</p>}
        <p className="text-xs text-muted-foreground">
          {displayNameForUser(user)} · AiChart
        </p>
      </SurfaceCard>
    </div>
  );
}
