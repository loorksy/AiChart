import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { requireEaConnection } from "@/lib/eaAuth";
import { fetchPendingEaCommands } from "@/lib/eaStore";

/** EA polls pending commands (alternative to receiving them in heartbeat). */
export async function GET(req: NextRequest) {
  try {
    const conn = await requireEaConnection(req);
    const commands = await fetchPendingEaCommands(conn.user_id);
    return NextResponse.json({
      commands: commands.map((c) => ({
        id: c.id,
        type: c.command_type,
        payload: JSON.parse(c.payload_json) as unknown,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
