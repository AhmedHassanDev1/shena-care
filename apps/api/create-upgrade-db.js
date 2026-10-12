const { Client } = require('pg');

async function createDb() {
  const client = new Client({
    connectionString: "postgresql://shenacare:shenacare@127.0.0.1:5434/postgres"
  });
  await client.connect();
  await client.query("DROP DATABASE IF EXISTS shenacare_upgrade_test");
  await client.query("CREATE DATABASE shenacare_upgrade_test");
  await client.end();
  console.log("Database shenacare_upgrade_test created successfully.");
}

createDb().catch(console.error);
