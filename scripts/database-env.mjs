// Loaded by NODE_OPTIONS in Docker, before Next.js, Prisma CLI, and maintenance
// scripts. Outside Docker, DATABASE_URL from the local .env remains in use.
if (process.env.POSTGRES_HOST) {
  for (const key of ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"]) {
    if (!process.env[key]) {
      throw new Error(`${key} must be set for the Docker database`);
    }
  }

  const user = encodeURIComponent(process.env.POSTGRES_USER);
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
  const database = encodeURIComponent(process.env.POSTGRES_DB);
  process.env.DATABASE_URL =
    `postgresql://${user}:${password}@${process.env.POSTGRES_HOST}:5432/${database}` +
    "?schema=public&connect_timeout=3&pool_timeout=3";
}
