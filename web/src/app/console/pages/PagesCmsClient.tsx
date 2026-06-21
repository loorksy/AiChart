"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  Save,
  X,
  FileText,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DynamicPage {
  slug: string;
  title_ar: string;
  title_en: string;
  content_ar: string;
  content_en: string;
  is_published: boolean;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export default function PagesCmsClient() {
  const [pages, setPages] = useState<DynamicPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingPage, setEditingPage] = useState<Partial<DynamicPage> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchPages();
  }, []);

  async function fetchPages() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pages");
      if (!res.ok) throw new Error("Failed to load pages");
      const data = await res.json();
      setPages(data.pages || []);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  function handleStartCreate() {
    setIsNew(true);
    setEditingPage({
      slug: "",
      title_ar: "",
      title_en: "",
      content_ar: "",
      content_en: "",
      is_published: true,
      metadata_json: "{}",
    });
  }

  function handleStartEdit(page: DynamicPage) {
    setIsNew(false);
    setEditingPage({ ...page });
  }

  async function handleDelete(slug: string) {
    if (!confirm(`هل أنت متأكد من حذف الصفحة (${slug})؟`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/pages/${slug}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete page");
      setPages(pages.filter((p) => p.slug !== slug));
    } catch (err: any) {
      alert(err.message || "Could not delete page");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editingPage || busy) return;
    if (!editingPage.slug || !editingPage.title_ar || !editingPage.title_en) {
      alert("الرجاء ملء جميع الحقول المطلوبة.");
      return;
    }

    setBusy(true);
    try {
      const url = isNew ? "/api/admin/pages" : `/api/admin/pages/${editingPage.slug}`;
      const method = isNew ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingPage),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save page");
      }

      await fetchPages();
      setEditingPage(null);
    } catch (err: any) {
      alert(err.message || "Could not save page");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">إدارة الصفحات الديناميكية</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            أنشئ وعدّل صفحات الخصوصية، الشروط والأحكام، ومن نحن والصفحات المخصصة بالكامل.
          </p>
        </div>
        {!editingPage && (
          <button
            type="button"
            onClick={handleStartCreate}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition"
          >
            <Plus className="h-4 w-4" />
            <span>إضافة صفحة جديدة</span>
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {editingPage ? (
        /* Edit or Create View Form */
        <form onSubmit={handleSave} className="rounded-xl border border-white/8 bg-[#0a0a0a] p-4 sm:p-6 space-y-4 max-w-4xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/8">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {isNew ? "إنشاء صفحة جديدة" : `تعديل الصفحة: ${editingPage.slug}`}
            </h2>
            <button
              type="button"
              onClick={() => setEditingPage(null)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary transition"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Slug Field (Dynamic only on creation) */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">رابط الصفحة (Slug)</label>
              <input
                type="text"
                disabled={!isNew || busy}
                value={editingPage.slug || ""}
                onChange={(e) => setEditingPage({ ...editingPage, slug: e.target.value })}
                placeholder="e.g. privacy-policy"
                required
                className="rounded-lg border border-white/12 bg-[#121212] px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
              />
              {isNew && (
                <p className="text-[10px] text-muted-foreground">
                  سيتم تنسيق الرابط تلقائياً بأحرف صغيرة وعلامات ربط (e.g. /p/privacy-policy)
                </p>
              )}
            </div>

            {/* Arabic Title */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">العنوان (بالعربية)</label>
              <input
                type="text"
                disabled={busy}
                value={editingPage.title_ar || ""}
                onChange={(e) => setEditingPage({ ...editingPage, title_ar: e.target.value })}
                placeholder="سياسة الخصوصية"
                required
                className="rounded-lg border border-white/12 bg-[#121212] px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
              />
            </div>

            {/* English Title */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">العنوان (بالإنجليزية)</label>
              <input
                type="text"
                disabled={busy}
                value={editingPage.title_en || ""}
                onChange={(e) => setEditingPage({ ...editingPage, title_en: e.target.value })}
                placeholder="Privacy Policy"
                required
                className="rounded-lg border border-white/12 bg-[#121212] px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                dir="ltr"
              />
            </div>

            {/* Arabic Markdown Content */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">المحتوى (ماركداون بالعربية)</label>
              <textarea
                rows={12}
                disabled={busy}
                value={editingPage.content_ar || ""}
                onChange={(e) => setEditingPage({ ...editingPage, content_ar: e.target.value })}
                placeholder="# سياسة الخصوصية..."
                className="rounded-lg border border-white/12 bg-[#121212] p-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary"
              />
            </div>

            {/* English Markdown Content */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">المحتوى (ماركداون بالإنجليزية)</label>
              <textarea
                rows={12}
                disabled={busy}
                value={editingPage.content_en || ""}
                onChange={(e) => setEditingPage({ ...editingPage, content_en: e.target.value })}
                placeholder="# Privacy Policy..."
                className="rounded-lg border border-white/12 bg-[#121212] p-3 text-sm font-mono text-foreground focus:outline-none focus:border-primary"
                dir="ltr"
              />
            </div>

            {/* SEO Metadata JSON */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">أوسمة SEO (JSON Object)</label>
              <textarea
                rows={3}
                disabled={busy}
                value={editingPage.metadata_json || "{}"}
                onChange={(e) => setEditingPage({ ...editingPage, metadata_json: e.target.value })}
                placeholder='{"description": "صفحة توضح شروط خصوصية البيانات لمتداولي المنصة"}'
                className="rounded-lg border border-white/12 bg-[#121212] p-2.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                dir="ltr"
              />
            </div>

            {/* Toggle Publication switch */}
            <div className="flex items-center gap-3 sm:col-span-2 py-2">
              <input
                type="checkbox"
                id="is_published"
                disabled={busy}
                checked={editingPage.is_published || false}
                onChange={(e) => setEditingPage({ ...editingPage, is_published: e.target.checked })}
                className="h-4 w-4 rounded border-white/12 bg-[#121212] text-primary focus:ring-primary"
              />
              <label htmlFor="is_published" className="text-xs font-medium text-foreground cursor-pointer select-none">
                نشر الصفحة فوراً (متاحة للعامة عبر الرابط)
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-3 border-t border-white/8 justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditingPage(null)}
              className="rounded-lg px-4 py-2 text-xs font-semibold hover:bg-secondary text-muted-foreground hover:text-foreground transition"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              حفظ وتحديث
            </button>
          </div>
        </form>
      ) : (
        /* List View Pages Table */
        <div className="rounded-xl border border-white/8 bg-[#0a0a0a] overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground animate-pulse">
              جاري تحميل الصفحات...
            </div>
          ) : pages.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              لا توجد صفحات ديناميكية بعد. اضغط على إضافة صفحة جديدة للبدء.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/8 bg-white/2">
                    <th className="p-3 text-xs font-semibold text-muted-foreground">الرابط (Slug)</th>
                    <th className="p-3 text-xs font-semibold text-muted-foreground">العنوان (عربي)</th>
                    <th className="p-3 text-xs font-semibold text-muted-foreground">العنوان (English)</th>
                    <th className="p-3 text-xs font-semibold text-muted-foreground">الحالة</th>
                    <th className="p-3 text-xs font-semibold text-muted-foreground text-left">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/4">
                  {pages.map((page) => (
                    <tr key={page.slug} className="hover:bg-white/1">
                      <td className="p-3 font-mono text-xs text-primary">
                        <Link href={`/p/${page.slug}`} target="_blank" className="hover:underline">
                          /p/{page.slug}
                        </Link>
                      </td>
                      <td className="p-3 font-medium text-foreground">{page.title_ar}</td>
                      <td className="p-3 text-muted-foreground" dir="ltr">{page.title_en}</td>
                      <td className="p-3">
                        <span
                          className={cn(
                             "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                             page.is_published
                               ? "bg-emerald-500/10 text-emerald-500"
                               : "bg-amber-500/10 text-amber-500",
                          )}
                        >
                          {page.is_published ? (
                            <>
                              <Eye className="h-3 w-3" /> منشور
                            </>
                          ) : (
                            <>
                              <EyeOff className="h-3 w-3" /> مسودة
                            </>
                          )}
                        </span>
                      </td>
                      <td className="p-3 text-left">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleStartEdit(page)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition"
                            title="تعديل"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDelete(page.slug)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
                            title="حذف"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
