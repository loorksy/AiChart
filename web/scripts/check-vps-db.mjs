import pg from 'pg';

async function main() {
  const client = new pg.Client({
    connectionString: "postgresql://aichart:589e6a3c7f11cbe0b1ec6cd9c79be93849f178bad04fcd56@127.0.0.1:5432/aichart"
  });
  await client.connect();
  const res = await client.query("SELECT * FROM platform_config");
  console.log("=== VPS PostgreSQL Platform Config ===");
  for (const row of res.rows) {
    if (row.key.includes("KEY")) {
      console.log(`${row.key}: [SET]`);
    } else {
      console.log(`${row.key}: ${row.value}`);
    }
  }
  await client.end();
}

main().catch(console.error);
