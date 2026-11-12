import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const transientStoreError = (error) =>
  ["EPERM", "EACCES", "EBUSY", "EEXIST"].includes(error?.code);

function parseStore(raw, source, blankFactory) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw Object.assign(new Error(`Workspace store is invalid JSON: ${source}`), {
      code: "DATA_STORE_CORRUPT",
      cause,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`Workspace store has an invalid root object: ${source}`), {
      code: "DATA_STORE_CORRUPT",
    });
  }
  const expected = blankFactory();
  for (const [key, defaultValue] of Object.entries(expected)) {
    if (Array.isArray(defaultValue) && value[key] !== undefined && !Array.isArray(value[key])) {
      throw Object.assign(new Error(`Workspace store collection "${key}" is invalid`), {
        code: "DATA_STORE_CORRUPT",
      });
    }
    if (value[key] === undefined) value[key] = structuredClone(defaultValue);
  }
  return value;
}

export async function loadJsonStore(file, blankFactory, ops = fs.promises) {
  try {
    return {
      data: parseStore(await ops.readFile(file, "utf8"), file, blankFactory),
      source: "primary",
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { data: blankFactory(), source: "new" };
    const backup = `${file}.bak`;
    try {
      const data = parseStore(await ops.readFile(backup, "utf8"), backup, blankFactory);
      const preserved = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      await ops.copyFile?.(file, preserved).catch?.(() => {});
      return { data, source: "backup", preserved };
    } catch {
      throw Object.assign(
        new Error(
          `Fabric refused to start because both the workspace store and its backup are unreadable. ` +
            `The original files were left untouched: ${file}`,
        ),
        { code: "DATA_STORE_CORRUPT", cause: error },
      );
    }
  }
}

async function durableWrite(file, payload, ops) {
  if (typeof ops.open !== "function") {
    await ops.writeFile(file, payload, { mode: 0o600 });
    return;
  }
  const handle = await ops.open(file, "w", 0o600);
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function persistSnapshotSafe(file, snapshot, ops = fs.promises) {
  const directory = path.dirname(file);
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const backup = `${file}.bak`;
  const backupTemp = `${backup}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await ops.mkdir?.(directory, { recursive: true, mode: 0o700 });
  await durableWrite(temp, snapshot, ops);
  let last;
  try {
    if (typeof ops.copyFile === "function") {
      try {
        await ops.copyFile(file, backupTemp);
        await ops.rename(backupTemp, backup);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await ops.rename(temp, file);
        return { mode: "atomic", backup };
      } catch (error) {
        last = error;
        if (!transientStoreError(error)) throw error;
        await sleep(25 * (attempt + 1));
      }
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await durableWrite(file, snapshot, ops);
        return { mode: "direct-with-backup", backup };
      } catch (error) {
        last = error;
        if (!transientStoreError(error)) throw error;
        await sleep(40 * (attempt + 1));
      }
    }
    throw Object.assign(
      new Error(
        "Fabric could not save workspace data. The last-known-good backup was preserved.",
      ),
      { code: "DATA_STORE_LOCKED", cause: last },
    );
  } finally {
    await ops.rm?.(temp, { force: true }).catch?.(() => {});
    await ops.rm?.(backupTemp, { force: true }).catch?.(() => {});
  }
}