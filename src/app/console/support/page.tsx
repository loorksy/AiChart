import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { SupportChat } from "@/components/support/SupportChat";

// Read from the string table rather than written here: a title typed into a
// page is a string the translator never sees.
//
// "ar" and not DEFAULT_LOCALE, which is "en": the server-rendered shell is
// `lang="ar" dir="rtl"`, and every sibling console page carries an Arabic
// title. An English tab label beside those is the drift.
export const metadata = { title: t("ar", "support.title") };

/**
 * Item 12: support is a live two-way conversation, not a ticket form.
 *
 * There was no user-facing support surface in the web app at all — the only
 * way to reach a human was Telegram, and the admin console's inbox had nothing
 * on this side to talk to.
 *
 * The page is the agent chat's shape: the shell gives this route the same
 * chrome-free, non-scrolling main as /chat (see workspaceNoPadding), and the
 * chat component owns its own scroll region and docked composer — no page
 * header, no boxed column.
 */
export default async function SupportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console/support");
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <SupportChat />
    </div>
  );
}
