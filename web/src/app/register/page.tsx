import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getTelegramLoginConfig } from "@/lib/telegram";
import { isSingleUserMode } from "@/lib/agentAuth";

export default async function RegisterPage() {
  // Single-user platform: signup is closed — go to login.
  if (isSingleUserMode()) redirect("/login");

  const { telegramConfigured, botUsername } = await getTelegramLoginConfig();

  return (
    <AuthForm
      mode="register"
      botUsername={botUsername}
      telegramConfigured={telegramConfigured}
    />
  );
}
