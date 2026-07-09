import { NextResponse } from "next/server";
import { requirePlatformAccess, handleError } from "@/lib/api";
import {
  featureFlagSnapshot,
  FEATURES,
} from "@/lib/agent/featureFlags";
import { isLLMConfigured } from "@/lib/llm";
import { newsProviderConfigured } from "@/lib/agent/news/newsProvider";

export const runtime = "nodejs";

/**
 * Runtime feature-flag visibility. Lets the UI/operator confirm which parts of
 * the Smart Chart Agent are actually live instead of silently falling back.
 * Access-gated like the rest of the platform; returns only booleans (no secrets).
 */
export async function GET() {
  try {
    await requirePlatformAccess();
    return NextResponse.json({
      features: featureFlagSnapshot(),
      runtime: {
        llmConfigured: isLLMConfigured(),
        newsProviderConfigured: newsProviderConfigured(),
        smartChartAgent: FEATURES.smartChartAgent(),
        nodeEnv: process.env.NODE_ENV ?? "production",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
