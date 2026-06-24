import { BotsClient } from "@/components/bots/BotsClient";

export const metadata = {
  title: "AiChart — بوت الشبكة",
  description: "إدارة بوتات الشبكة الآلية على السيرفر",
};

export default function ConsoleBotsPage() {
  return <BotsClient />;
}
