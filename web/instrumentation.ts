export async function register() {
  const { initDb } = await import("./src/lib/db");
  await initDb();
}
