import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AuthForm from "@/components/AuthForm";
import { getTelegramLoginConfig } from "@/lib/telegram";
import { isSingleUserMode } from "@/lib/agentAuth";
import { detectCountryFromHeaders } from "@/lib/geoCountry";
import { googleAuthConfig } from "@/lib/auth/googleOidc";
import { initDb } from "@/lib/db";

export default async function SignupPage() {
  if (isSingleUserMode()) redirect("/login");

  const h = await headers();
  const defaultCountry = detectCountryFromHeaders(h);
  await initDb();
  const [{ telegramConfigured, botUsername }, google] = await Promise.all([
    getTelegramLoginConfig(),
    googleAuthConfig(),
  ]);

  return (
    <AuthForm
      mode="register"
      botUsername={botUsername}
      telegramConfigured={telegramConfigured}
      googleConfigured={google != null}
      defaultCountry={defaultCountry}
    />
  );
}
