/**
 * fetch that cannot occupy a browser socket forever.
 *
 * A hung /api/market/klines or /api/me used to sit in the HTTP/2 pool until
 * the tab looked alive (open/close still worked) but every new request
 * queued behind the dead ones — the platform "lost the server".
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 8_000, signal: userSignal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const onUserAbort = () => controller.abort();
  userSignal?.addEventListener("abort", onUserAbort);
  if (userSignal?.aborted) controller.abort();
  try {
    return await fetch(input, {
      ...rest,
      cache: rest.cache ?? "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    userSignal?.removeEventListener("abort", onUserAbort);
  }
}
