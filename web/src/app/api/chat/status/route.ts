import { NextResponse } from "next/server";
import { isAnthropicConfigured, getAnthropicModel } from "@/lib/anthropic";

export async function GET() {
  const configured = isAnthropicConfigured();
  return NextResponse.json({
    ready: configured,
    model: configured ? getAnthropicModel() : null,
  });
}
