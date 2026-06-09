import AuthForm from "@/components/AuthForm";
import { getTelegramLoginConfig } from "@/lib/telegram";

export default async function RegisterPage() {
  const { telegramConfigured, botUsername } = await getTelegramLoginConfig();

  return (
    <AuthForm
      mode="register"
      botUsername={botUsername}
      telegramConfigured={telegramConfigured}
    />
  );
}
