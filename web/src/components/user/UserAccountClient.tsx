"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CountryCode } from "libphonenumber-js";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { Mail, MessageCircle, Shield, User } from "lucide-react";
import { PageLayout, SurfaceCard } from "@/components/ui/shell";
import { PhoneInput } from "@/components/PhoneInput";
import { formatWhatsAppDisplay } from "@/lib/phone";
import { formatAccessExpiryLabel } from "@/lib/platformAccess";
import type { PublicUser } from "@/lib/types";
import { displayNameForUser } from "@/lib/displayName";
import { needsMcpCredentials } from "@/lib/userCredentials";
import { cn } from "@/lib/utils";

function ProfileField({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="py-3.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div
        className={cn(
          "mt-1.5 text-sm font-medium leading-relaxed text-foreground",
          mono && "font-mono text-[0.8125rem] break-all",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function LtrValue({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <span
      dir="ltr"
      className={cn("inline-block w-full text-end", mono && "font-mono text-[0.8125rem] break-all")}
    >
      {children}
    </span>
  );
}

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
  const displayName = displayNameForUser(user);
  const usernameLabel = user.username?.trim() || displayName;

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
    <PageLayout
      title="حسابي"
      subtitle="بياناتك الشخصية ووسائل التواصل"
      maxWidth="2xl"
    >
      <SurfaceCard padding="lg" className="overflow-visible">
        <div className="mb-4 flex items-center gap-3 border-b border-border/70 pb-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/15 text-primary">
            <User className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {needsCredentials ? "يلزم إكمال بيانات الدخول للموصل" : user.email}
            </p>
          </div>
        </div>

        <div className="divide-y divide-border">
          <ProfileField label="اسم المستخدم">
            <LtrValue>{usernameLabel}</LtrValue>
            {!user.username?.trim() && (
              <p className="mt-1 text-xs font-normal text-muted-foreground">
                لم يُضبط اسم مستخدم — يُعرض اسم العرض.
              </p>
            )}
          </ProfileField>

          <ProfileField label="البريد">
            {needsCredentials ? (
              <div className="space-y-2">
                <p className="font-normal text-muted-foreground">لم يُضبط بعد — مطلوب لربط Claude</p>
                <Link href="/complete-profile" className="text-link text-sm font-medium">
                  إكمال بريد وكلمة المرور ←
                </Link>
              </div>
            ) : (
              <LtrValue mono>{user.email}</LtrValue>
            )}
          </ProfileField>

          <ProfileField label="صلاحية الحساب">
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-primary" />
              {formatAccessExpiryLabel(user.access_expires_at)}
            </span>
          </ProfileField>

          <ProfileField label="Telegram">
            <span className="inline-flex items-center gap-1.5">
              <MessageCircle className="h-3.5 w-3.5 text-primary" />
              {user.telegram_id ? "مرتبط" : "غير مرتبط"}
            </span>
          </ProfileField>
        </div>
      </SurfaceCard>

      <SurfaceCard padding="lg" className="overflow-visible">
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">واتساب</h2>
        </div>

        {savedWhatsapp && !editingWhatsapp ? (
          <div className="space-y-3">
            <p className="text-sm">
              <LtrValue mono>{formatWhatsAppDisplay(savedWhatsapp)}</LtrValue>
            </p>
            <button
              type="button"
              className="btn btn-secondary text-sm"
              onClick={() => {
                setWhatsapp(savedWhatsapp);
                setEditingWhatsapp(true);
              }}
            >
              تعديل الرقم
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <PhoneInput
              value={whatsapp}
              onChange={setWhatsapp}
              disabled={busy}
              defaultCountry={defaultCountry}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary text-sm"
                disabled={busy}
                onClick={() => void saveWhatsapp()}
              >
                {busy ? "جاري الحفظ…" : "حفظ واتساب"}
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
          </div>
        )}

        {msg && (
          <p className={cn("mt-3 text-sm", msg.includes("فشل") ? "text-destructive" : "text-primary")}>
            {msg}
          </p>
        )}
      </SurfaceCard>

      <p className="text-center text-xs text-muted-foreground">
        {displayName} · AiChart
      </p>
    </PageLayout>
  );
}
