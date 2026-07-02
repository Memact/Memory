/**
 * Pure functions for computing in-memory database statistics.
 *
 * Note on TTL: the memact_memory_entries schema has no expiry column.
 * TTL is read from optional `expires_at` (ISO timestamp) or `ttl_seconds`
 * (number of seconds from created_at) fields on the JSON memory record.
 * Records without either field are excluded from the averageTtlRemaining
 * calculation. A record is considered "active" when its status/state field
 * is "active" (or absent) AND it has not passed its expires_at deadline.
 */

/**
 * Return true when the record is active and not expired.
 * @param {object} mem
 * @param {number} now - Unix ms timestamp
 */
function isActive(mem, now) {
  const status = mem.status ?? mem.state ?? "active";
  if (status !== "active") return false;
  if (mem.expires_at) {
    return new Date(mem.expires_at).getTime() > now;
  }
  return true;
}

/**
 * Resolve TTL remaining (seconds) for a single record, or null if no TTL.
 * @param {object} mem
 * @param {number} now - Unix ms timestamp
 * @returns {number|null}
 */
function ttlRemaining(mem, now) {
  if (mem.expires_at) {
    const expiresMs = new Date(mem.expires_at).getTime();
    const remaining = (expiresMs - now) / 1000;
    return remaining > 0 ? remaining : null;
  }
  if (typeof mem.ttl_seconds === "number" && mem.created_at) {
    const createdMs = new Date(mem.created_at).getTime();
    const expiresMs = createdMs + mem.ttl_seconds * 1000;
    const remaining = (expiresMs - now) / 1000;
    return remaining > 0 ? remaining : null;
  }
  return null;
}

/**
 * Compute database statistics from an array of memory records.
 *
 * @param {object[]} memories
 * @param {{ now?: number }} options
 * @returns {{ activeCount: number, averageTtlRemaining: number|null, categoryDistribution: object }}
 */
export function computeMemoryStats(memories = [], { now = Date.now() } = {}) {
  let activeCount = 0;
  let ttlSum = 0;
  let ttlCount = 0;
  const categoryDistribution = {};

  for (const mem of memories) {
    if (!isActive(mem, now)) continue;

    activeCount += 1;

    const category = mem.category ?? "general";
    categoryDistribution[category] = (categoryDistribution[category] ?? 0) + 1;

    const ttl = ttlRemaining(mem, now);
    if (ttl !== null) {
      ttlSum += ttl;
      ttlCount += 1;
    }
  }

  const averageTtlRemaining = ttlCount > 0 ? Math.round(ttlSum / ttlCount) : null;

  return { activeCount, averageTtlRemaining, categoryDistribution };
}
