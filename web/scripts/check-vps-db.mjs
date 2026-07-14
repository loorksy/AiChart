import pg from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  const res = await client.query("SELECT * FROM platform_config");
  console.log("=== VPS PostgreSQL Platform Config ===");
  for (const row of res.rows) {
    if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(row.key)) {
      console.log(`${row.key}: [SET]`);
    } else {
      console.log(`${row.key}: ${row.value}`);
    }
  }
  await client.end();
}

main().catch(console.error);
