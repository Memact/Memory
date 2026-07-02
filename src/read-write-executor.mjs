async function defaultCreatePool(connectionString) {
  let pg;
  try {
    pg = await import("pg");
  } catch {
    throw new Error("PostgreSQL support requires the optional `pg` package.");
  }
  return new pg.default.Pool({ connectionString });
}

export async function createReadWritePgExecutor({ env = process.env, createPool = defaultCreatePool } = {}) {
  const writeUrl =
    env.DATABASE_WRITE_URL ||
    env.MEMACT_MEMORY_DATABASE_URL ||
    env.DATABASE_URL;

  if (!writeUrl) {
    throw new TypeError(
      "PostgreSQL write connection string is required. Set DATABASE_WRITE_URL, MEMACT_MEMORY_DATABASE_URL, or DATABASE_URL.",
    );
  }

  const readUrl = env.DATABASE_READ_URL || writeUrl;

  const writePool = await createPool(writeUrl);
  const readPool = readUrl === writeUrl ? writePool : await createPool(readUrl);

  return {
    async query(text, params = []) {
      return writePool.query(text, params);
    },

    async queryRead(text, params = []) {
      try {
        return await readPool.query(text, params);
      } catch {
        // Failover: retry the read against the write pool
        return writePool.query(text, params);
      }
    },

    async close() {
      await writePool.end();
      if (readPool !== writePool) {
        await readPool.end();
      }
    },
  };
}
