import { protectPrivatePath } from "../src/security/private-path.mjs";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
const MAGIC = Buffer.from("FABBAK01"),
  HEADER_LENGTH = MAGIC.length + 16 + 12;
async function main() {
  const [mode, input, output, keyFile] = process.argv.slice(2);
  if (!["encrypt", "decrypt"].includes(mode) || !input || !output || !keyFile)
    throw new Error(
      "Usage: crypt-backup.mjs encrypt|decrypt INPUT OUTPUT KEY_FILE",
    );
  if (
    path.resolve(output) === path.resolve(input) ||
    path.resolve(output) === path.resolve(keyFile)
  )
    throw new Error("Backup output must not overwrite the source or key file.");
  const keyStat = await fsp.stat(keyFile);
  if (!keyStat.isFile() || keyStat.size < 32 || keyStat.size > 1024 * 1024)
    throw new Error(
      "Backup encryption key must be a bounded regular file containing at least 32 bytes.",
    );
  const keyMaterial = await fsp.readFile(keyFile);
  const privateDirectory = await fsp.mkdtemp(
    path.join(path.dirname(path.resolve(output)), ".fabric-crypto-"),
  );
  const temporary = path.join(privateDirectory, "payload");
  try {
    // Protect the empty staging directory before writing any plaintext.
    await protectPrivatePath(privateDirectory);
    if (mode === "encrypt") {
      const salt = crypto.randomBytes(16),
        iv = crypto.randomBytes(12),
        key = crypto.scryptSync(keyMaterial, salt, 32),
        cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      await fsp.writeFile(temporary, Buffer.concat([MAGIC, salt, iv]), {
        mode: 0o600,
        flag: "wx",
      });
      await pipeline(
        fs.createReadStream(input),
        cipher,
        fs.createWriteStream(temporary, { flags: "a" }),
      );
      await fsp.appendFile(temporary, cipher.getAuthTag());
    } else {
      const handle = await fsp.open(input, "r");
      let header = Buffer.alloc(HEADER_LENGTH),
        tag = Buffer.alloc(16),
        size;
      try {
        size = (await handle.stat()).size;
        if (size < HEADER_LENGTH + 16)
          throw new Error("Invalid encrypted backup format.");
        if (
          (await handle.read(header, 0, header.length, 0)).bytesRead !==
            header.length ||
          !header.subarray(0, MAGIC.length).equals(MAGIC) ||
          (await handle.read(tag, 0, 16, size - 16)).bytesRead !== 16
        )
          throw new Error("Invalid encrypted backup format.");
      } finally {
        await handle.close();
      }
      const key = crypto.scryptSync(
          keyMaterial,
          header.subarray(MAGIC.length, MAGIC.length + 16),
          32,
        ),
        decipher = crypto.createDecipheriv(
          "aes-256-gcm",
          key,
          header.subarray(MAGIC.length + 16),
        );
      decipher.setAuthTag(tag);
      // Plaintext stays in a private directory until GCM authentication succeeds.
      await pipeline(
        fs.createReadStream(input, { start: HEADER_LENGTH, end: size - 17 }),
        decipher,
        fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
    }
    // Protect/verify the file itself so a same-volume rename retains its privacy.
    await protectPrivatePath(temporary);
    await fsp.rename(temporary, output);
  } finally {
    keyMaterial.fill(0);
    await fsp.rm(privateDirectory, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error(
    "Backup encryption/decryption failed. Verify the inputs, encryption key, authentication and filesystem permissions.",
  );
  process.exitCode = 1;
});
