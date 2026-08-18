import { getPlatformValueAsync } from "@/lib/platformConfig";

export async function metaapiToken(): Promise<string | undefined> {
  const fromConfig = (await getPlatformValueAsync("METAAPI_TOKEN"))?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.METAAPI_TOKEN?.trim();
  return fromEnv || undefined;
}

export async function metaapiRegion(): Promise<string | undefined> {
  const fromConfig = (await getPlatformValueAsync("METAAPI_REGION"))?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = process.env.METAAPI_REGION?.trim();
  return fromEnv || undefined;
}

export async function metaapiConfigured(): Promise<boolean> {
  return Boolean(await metaapiToken());
}
