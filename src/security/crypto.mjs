import crypto from "node:crypto";
export const newId = (prefix) => prefix + "_" + crypto.randomUUID();
export const hash = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
export const secretToken = () => crypto.randomBytes(32).toString("base64url");
export function cryptoBox(master) {
  const key = crypto.createHash("sha256").update(master).digest();
  return {
    encrypt(value) {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv),
        body = Buffer.concat([c.update(value), c.final()]);
      return [
        "v1",
        iv.toString("base64url"),
        c.getAuthTag().toString("base64url"),
        body.toString("base64url"),
      ].join(".");
    },
    decrypt(value) {
      const [version, iv, tag, body] = value.split(".");
      if (version !== "v1") throw new Error("Unsupported ciphertext");
      const c = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      c.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        c.update(Buffer.from(body, "base64url")),
        c.final(),
      ]).toString();
    },
  };
}
