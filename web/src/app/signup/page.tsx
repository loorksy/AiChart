import { redirect } from "next/navigation";
import { headers } from "next/headers";
import AuthForm from "@/components/AuthForm";
import { getTelegramLoginConfig } from "@/lib/telegram";
import { isSingleUserMode } from "@/lib/agentAuth";
import { detectCountryFromHeaders } from "@/lib/geoCountry";

export default async function SignupPage() {
  if (isSingleUserMode()) redirect("/login");

  const h = await headers();
  const defaultCountry = detectCountryFromHeaders(h);
  const { telegramConfigured, botUsername } = await getTelegramLoginConfig();

  return (
    <AuthForm
      mode="register"
      botUsername={botUsername}
      telegramConfigured={telegramConfigured}
      defaultCountry={defaultCountry}
    />
  );
}
