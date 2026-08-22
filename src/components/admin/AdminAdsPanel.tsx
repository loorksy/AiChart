"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";

import { useLocale } from "@/hooks/useLocale";
import { Badge } from "@/components/squareui/badge";
import { Button } from "@/components/squareui/button";
import { Input } from "@/components/squareui/input";
import { CardSkeleton } from "@/components/ui/skeletons/page-skeletons";
import {
  AdminCard,
  AdminCardBody,
  AdminCardHeader,
  AdminPage,
  Field,
  InlineAlert,
  SectionHeader,
  Td,
  Th,
  THead,
  TableEmptyRow,
  TableWrap,
  Tr,
} from "@/components/admin/ui/AdminKit";

interface AdRow {
  id: number;
  slides_json: string;
  audience: string;
  active: number;
  starts_at: number | null;
  ends_at: number | null;
}

const AUDIENCES = ["all", "subscribers", "non_subscribers", "trial"] as const;

/** Ads authoring: slides of plain text + validated images, targeted by
 *  account state, window-bounded, instantly toggleable. */
export function AdminAdsPanel() {
  const { t } = useLocale();
  const [ads, setAds] = useState<AdRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]>("all");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/admin/ads");
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as { ads: AdRow[] };
      setAds(d.ads);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(method: string, body: unknown): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ads", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !out?.ok) {
        setMessage(out?.error ?? t("admin.billing.request_failed", { status: String(res.status) }));
        return;
      }
      setMessage(t("admin.billing.saved"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function uploadImage(file: File): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const res = await fetch("/api/admin/ads/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: btoa(binary) }),
      });
      const out = (await res.json().catch(() => null)) as
        | { ok?: boolean; image_path?: string; error?: string }
        | null;
      if (!res.ok || !out?.ok || !out.image_path) {
        setMessage(out?.error ?? t("admin.ads.upload_failed"));
        return;
      }
      setImagePath(out.image_path);
      setMessage(t("admin.billing.saved"));
    } finally {
      setBusy(false);
    }
  }

  if (!ads) {
    return failed ? (
      <AdminPage>
        <InlineAlert tone="error">{t("admin.billing.load_failed")}</InlineAlert>
        <Button onClick={() => void load()}>{t("billing.retry")}</Button>
      </AdminPage>
    ) : (
      <AdminPage>
        <CardSkeleton lines={5} />
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <SectionHeader
        title={t("admin.ads.title")}
        description={t("admin.ads.subtitle")}
        icon={Megaphone}
      />
      {message && <InlineAlert tone="info">{message}</InlineAlert>}

      <AdminCard>
        <AdminCardHeader title={t("admin.ads.list")} />
        <AdminCardBody>
          <TableWrap>
            <table className="w-full text-sm">
              <THead>
                <Tr>
                  <Th>#</Th>
                  <Th>{t("admin.ads.audience")}</Th>
                  <Th>{t("admin.billing.from")}</Th>
                  <Th>{t("admin.billing.to")}</Th>
                  <Th>{t("admin.billing.state")}</Th>
                  <Th>{t("admin.billing.action")}</Th>
                </Tr>
              </THead>
              <tbody>
                {ads.length === 0 && (
                  <TableEmptyRow colSpan={6} title={t("admin.ads.none")} />
                )}
                {ads.map((ad) => {
                  const now = Date.now();
                  const live =
                    ad.active === 1 &&
                    (ad.starts_at == null || ad.starts_at <= now) &&
                    (ad.ends_at == null || ad.ends_at > now);
                  return (
                    <Tr key={ad.id}>
                      <Td numeric dir="ltr">{ad.id}</Td>
                      <Td>{t(`admin.ads.audience_${ad.audience}`)}</Td>
                      <Td dir="ltr">
                        {ad.starts_at ? new Date(ad.starts_at).toLocaleDateString() : "—"}
                      </Td>
                      <Td dir="ltr">
                        {ad.ends_at ? new Date(ad.ends_at).toLocaleDateString() : "—"}
                      </Td>
                      <Td>
                        <Badge variant={live ? "default" : "outline"}>
                          {live
                            ? t("admin.billing.live")
                            : ad.active
                              ? t("admin.billing.out_of_window")
                              : t("admin.billing.disabled")}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void call("PATCH", { id: ad.id, active: !ad.active })
                            }
                          >
                            {ad.active
                              ? t("admin.billing.disable_now")
                              : t("admin.billing.enable")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void call("PATCH", { id: ad.id, remove: true })}
                          >
                            {t("admin.ads.delete")}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </AdminCardBody>
      </AdminCard>

      <AdminCard>
        <AdminCardHeader title={t("admin.ads.create")} />
        <AdminCardBody>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field htmlFor="ad-text" label={t("admin.ads.text")}>
              <Input
                id="ad-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("admin.ads.text_placeholder")}
              />
            </Field>
            <Field htmlFor="ad-image" label={t("admin.ads.image")}>
              <input
                id="ad-image"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="block w-full text-sm text-muted-foreground file:me-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadImage(file);
                }}
              />
            </Field>
            <Field htmlFor="ad-audience" label={t("admin.ads.audience")}>
              <select
                id="ad-audience"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={audience}
                onChange={(e) => setAudience(e.target.value as (typeof AUDIENCES)[number])}
              >
                {AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {t(`admin.ads.audience_${a}`)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field htmlFor="ad-starts" label={t("admin.billing.starts")}>
                <Input
                  id="ad-starts"
                  type="date"
                  value={starts}
                  onChange={(e) => setStarts(e.target.value)}
                />
              </Field>
              <Field htmlFor="ad-ends" label={t("admin.billing.ends")}>
                <Input
                  id="ad-ends"
                  type="date"
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
                />
              </Field>
            </div>
          </div>
          {imagePath && (
            <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
              {imagePath}
            </p>
          )}
          <Button
            className="mt-3"
            disabled={busy || (!text.trim() && !imagePath)}
            onClick={() => {
              void call("POST", {
                slides: [
                  {
                    ...(text.trim() ? { text: text.trim() } : {}),
                    ...(imagePath ? { image_path: imagePath } : {}),
                  },
                ],
                audience,
                ...(starts ? { starts_at: new Date(starts).getTime() } : {}),
                ...(ends ? { ends_at: new Date(ends).getTime() } : {}),
              }).then(() => {
                setText("");
                setImagePath(null);
              });
            }}
          >
            {t("admin.ads.publish")}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">{t("admin.ads.note")}</p>
        </AdminCardBody>
      </AdminCard>
    </AdminPage>
  );
}
