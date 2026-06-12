import { NextResponse } from "next/server";
import { getActiveModel, getActiveProvider, isLLMConfigured } from "@/lib/llm";

export async function GET() {
  const configured = isLLMConfigured();
  return NextResponse.json({
    ready: configured,
    provider: getActiveProvider(),
    model: configured ? getActiveModel() : null,
  });
}
