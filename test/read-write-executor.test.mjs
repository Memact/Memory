import test from "node:test";
import assert from "node:assert/strict";
import { createReadWritePgExecutor } from "../src/read-write-executor.mjs";

function makeMockPool(label) {
  const calls = [];
  return {
    label,
    calls,
    ended: false,
    async query(text, params) {
      calls.push({ text, params });
      return { rows: [{ pool: label }] };
    },
    async end() {
      this.ended = true;
    },
  };
}

function makeFailingPool(label) {
  const calls = [];
  return {
    label,
    calls,
    ended: false,
    async query(text, params) {
      calls.push({ text, params });
      throw new Error(`${label} connection refused`);
    },
    async end() {
      this.ended = true;
    },
  };
}

test("throws TypeError when no write URL is provided", async () => {
  await assert.rejects(
    () => createReadWritePgExecutor({ env: {} }),
    TypeError,
  );
});

test("reads route to READ pool, writes route to WRITE pool", async () => {
  const writePool = makeMockPool("write");
  const readPool = makeMockPool("read");

  const pools = { write: writePool, read: readPool };
  const executor = await createReadWritePgExecutor({
    env: {
      DATABASE_WRITE_URL: "postgres://write-host/db",
      DATABASE_READ_URL: "postgres://read-host/db",
    },
    createPool(url) {
      if (url.includes("write-host")) return pools.write;
      return pools.read;
    },
  });

  await executor.query("INSERT INTO t VALUES ($1)", [1]);
  await executor.queryRead("SELECT 1");

  assert.equal(writePool.calls.length, 1);
  assert.equal(writePool.calls[0].text, "INSERT INTO t VALUES ($1)");
  assert.equal(readPool.calls.length, 1);
  assert.equal(readPool.calls[0].text, "SELECT 1");

  await executor.close();
});

test("single pool handles both reads and writes when only write URL is set", async () => {
  const pool = makeMockPool("single");
  const callCount = () => pool.calls.length;

  const executor = await createReadWritePgExecutor({
    env: { DATABASE_WRITE_URL: "postgres://single-host/db" },
    createPool() {
      return pool;
    },
  });

  await executor.query("INSERT INTO t VALUES ($1)", [42]);
  await executor.queryRead("SELECT 1");

  assert.equal(callCount(), 2, "single pool should receive both read and write calls");

  await executor.close();
  assert.equal(pool.ended, true);
});

test("failover: read pool error causes queryRead to retry against write pool", async () => {
  const writePool = makeMockPool("write");
  const readPool = makeFailingPool("read");

  const executor = await createReadWritePgExecutor({
    env: {
      DATABASE_WRITE_URL: "postgres://write-host/db",
      DATABASE_READ_URL: "postgres://read-host/db",
    },
    createPool(url) {
      if (url.includes("write-host")) return writePool;
      return readPool;
    },
  });

  const result = await executor.queryRead("SELECT 1");

  assert.equal(readPool.calls.length, 1, "read pool should have been attempted");
  assert.equal(writePool.calls.length, 1, "write pool should have received the failover query");
  assert.equal(writePool.calls[0].text, "SELECT 1");
  assert.deepEqual(result.rows, [{ pool: "write" }]);

  await executor.close();
});

test("close() ends all distinct pools", async () => {
  const writePool = makeMockPool("write");
  const readPool = makeMockPool("read");

  const executor = await createReadWritePgExecutor({
    env: {
      DATABASE_WRITE_URL: "postgres://write-host/db",
      DATABASE_READ_URL: "postgres://read-host/db",
    },
    createPool(url) {
      if (url.includes("write-host")) return writePool;
      return readPool;
    },
  });

  await executor.close();

  assert.equal(writePool.ended, true, "write pool should be ended");
  assert.equal(readPool.ended, true, "read pool should be ended");
});
