import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { initDb } from "@/lib/db";
import { getMtAccountMeta } from "@/lib/store";
import { metaapiUxEnabled } from "@/lib/metaapi/lifecycle";
import { Mt5ConnectWizard } from "@/components/mt5/Mt5ConnectWizard";

export const metadata = { title: "ربط حساب MetaTrader 5" };

/** V2-B (#96): the transparent MT5 linking wizard. */
export default async function Mt5ConnectPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/console/mt5");
  await initDb();
  const [account, enabled] = await Promise.all([
    getMtAccountMeta(user.id),
    metaapiUxEnabled(),
  ]);

  return (
    <main className="page-shell max-w-2xl space-y-6">
      <Mt5ConnectWizard
        enabled={enabled}
        existing={
          account
            ? {
                platform: account.platform,
                server: account.server,
                login: account.login,
                state: account.state,
              }
            : null
        }
      />
    </main>
  );
}
