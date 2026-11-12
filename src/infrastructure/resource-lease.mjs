import { setTimeout as delay } from "node:timers/promises";
import { AppError } from "../server/errors.mjs";
// Serialize object-producing workers and deletion across API/worker processes.
// A reserved session owns the lock; PostgreSQL releases it on process death.
export async function withResourceLease(pool, key, signal, work) {
  const client = await pool.connect();
  let locked = false,
    broken = false;
  try {
    const deadline = Date.now() + 300000;
    while (!locked) {
      signal?.throwIfAborted();
      if (Date.now() >= deadline)
        throw new AppError(
          "RESOURCE_BUSY",
          "The resource is still processing. Retry later.",
          503,
        );
      locked = (
        await client.query(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
          [key],
        )
      ).rows[0].locked;
      if (!locked) await delay(100, undefined, { signal });
    }
    signal?.throwIfAborted();
    return await work();
  } finally {
    if (locked)
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [key])
        .catch(() => {
          broken = true;
        });
    client.release(broken);
  }
}
