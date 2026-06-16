import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SurfaceCard } from "@/components/ui/shell";
import { McpUrlGuide } from "@/components/user/McpUrlGuide";
import { needsMcpCredentials } from "@/lib/userCredentials";

export default async function ConsoleMcpPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/console/platform?tab=system");

  const mcpUrl =
    process.env.MCP_PUBLIC_URL?.trim() || "https://aichart.lork.cloud/mcp";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">ربط Claude MCP</h1>
      <SurfaceCard>
        <McpUrlGuide
          mcpUrl={mcpUrl}
          needsCredentials={needsMcpCredentials(user)}
        />
      </SurfaceCard>
    </div>
  );
}
