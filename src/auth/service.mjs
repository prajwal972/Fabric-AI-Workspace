import { assertRegistrationAllowed } from "../security/public-policy.mjs";
import argon2 from "argon2";
import crypto from "node:crypto";
import { z } from "zod";
import { withTransaction } from "../database/transaction.mjs";
import { newId, hash, secretToken } from "../security/crypto.mjs";
import { AppError } from "../server/errors.mjs";
const passwordSchema = z.string().min(10).max(256);
const registerSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((s) => s.toLowerCase().trim()),
  name: z.string().trim().min(1).max(80),
  password: passwordSchema,
});
export class AuthService {
  constructor({ pool, box, repo, production = false, env = process.env }) {
    Object.assign(this, { pool, box, repo, production, env });
  }
  async password(password) {
    return argon2.hash(passwordSchema.parse(password), {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  async register(input, device) {
    assertRegistrationAllowed({
      ...this.env,
      NODE_ENV: this.production ? "production" : this.env.NODE_ENV,
    });
    const b = registerSchema.parse(input),
      passwordHash = await this.password(b.password),
      uid = newId("usr"),
      wid = newId("wor");
    try {
      return await withTransaction(this.pool, async (client) => {
        await client.query(
          "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)",
          [uid, b.email, b.name, passwordHash],
        );
        await client.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
          wid,
          b.name + "'s Workspace",
        ]);
        await client.query(
          "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
          [wid, uid],
        );
        return this.session(
          client,
          { id: uid, email: b.email, name: b.name },
          wid,
          "owner",
          device,
        );
      });
    } catch (e) {
      if (e.code === "23505")
        throw new AppError("ACCOUNT_EXISTS", "Account exists.", 409);
      throw e;
    }
  }
  async session(client, user, wid, role, device) {
    const raw = secretToken(),
      csrf = secretToken(),
      sid = newId("ses");
    await client.query(
      "INSERT INTO sessions(id,user_id,workspace_id,token_hash,csrf_hash,csrf_ciphertext,user_agent,expires_at) VALUES($1,$2,$3,decode($4,'hex'),decode($5,'hex'),$6,$7,now()+interval '7 days')",
      [
        sid,
        user.id,
        wid,
        hash(raw),
        hash(csrf),
        this.box.encrypt(csrf),
        String(device || "").slice(0, 300),
      ],
    );
    return {
      user,
      workspace: (
        await client.query(
          'SELECT id,name,memory_enabled AS "memoryEnabled" FROM workspaces WHERE id=$1',
          [wid],
        )
      ).rows[0],
      role,
      csrf,
      token: raw,
      sessionId: sid,
    };
  }
  async login(input, device) {
    const email = z.email().parse(input.email).toLowerCase(),
      password = z.string().max(256).parse(input.password),
      user = (
        await this.pool.query(
          "SELECT * FROM users WHERE lower(email)=$1 AND deleted_at IS NULL",
          [email],
        )
      ).rows[0];
    let valid = false;
    if (user && (!user.locked_until || user.locked_until < Date.now())) {
      try {
        if (user.password_hash.startsWith("$argon2"))
          valid = await argon2.verify(user.password_hash, password);
        else {
          const [, salt, h] = user.password_hash.split("$"),
            a = crypto.scryptSync(password, salt, 64),
            b = Buffer.from(h, "hex");
          valid = a.length === b.length && crypto.timingSafeEqual(a, b);
        }
      } catch {}
    }
    if (!valid) {
      if (user)
        await this.pool.query(
          "UPDATE users SET failed_login_count=failed_login_count+1,locked_until=CASE WHEN failed_login_count+1>=10 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1",
          [user.id],
        );
      throw new AppError("UNAUTHORIZED", "Invalid email or password.", 401);
    }
    return withTransaction(this.pool, async (client) => {
      await client.query(
        "UPDATE users SET failed_login_count=0,locked_until=NULL,password_hash=$2 WHERE id=$1",
        [
          user.id,
          user.password_hash.startsWith("$argon2id$")
            ? user.password_hash
            : await this.password(password),
        ],
      );
      const member = (
        await client.query(
          "SELECT * FROM memberships WHERE user_id=$1 ORDER BY created_at LIMIT 1",
          [user.id],
        )
      ).rows[0];
      if (!member)
        throw new AppError("FORBIDDEN", "Workspace membership required.", 403);
      return this.session(
        client,
        { id: user.id, email: user.email, name: user.name },
        member.workspace_id,
        member.role,
        device,
      );
    });
  }
  async authenticate(raw) {
    if (!raw) return null;
    const { rows } = await this.pool.query(
      "SELECT s.id,s.workspace_id,s.csrf_hash,s.csrf_ciphertext,m.role,u.id AS user_id,u.email,u.name,u.memory_enabled,u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id AND u.deleted_at IS NULL JOIN memberships m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id WHERE s.token_hash=decode($1,'hex') AND s.expires_at>now() AND s.revoked_at IS NULL",
      [hash(raw)],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.id,
      workspaceId: row.workspace_id,
      role: row.role,
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        memoryEnabled: row.memory_enabled,
        emailVerified: !!row.email_verified_at,
      },
      csrfHash: row.csrf_hash.toString("hex"),
      csrf: row.csrf_ciphertext ? this.box.decrypt(row.csrf_ciphertext) : null,
    };
  }
  checkCSRF(actor, value) {
    const a = Buffer.from(actor.csrfHash, "hex"),
      b = Buffer.from(hash(String(value || "")), "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      throw new AppError("CSRF", "Invalid CSRF token.", 403);
  }
  async revoke(actor, id = actor.sessionId) {
    await this.pool.query(
      "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND id=$2",
      [actor.user.id, id],
    );
  }
  async sessions(actor) {
    return (
      await this.pool.query(
        'SELECT id,user_agent AS device,created_at AS "createdAt",last_seen_at AS "lastSeenAt",expires_at AS "expiresAt" FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 50',
        [actor.user.id],
      )
    ).rows;
  }
  async selectWorkspace(actor, workspaceId) {
    const member = (
      await this.pool.query(
        "SELECT role FROM memberships WHERE user_id=$1 AND workspace_id=$2",
        [actor.user.id, workspaceId],
      )
    ).rows[0];
    if (!member)
      throw new AppError("FORBIDDEN", "Workspace membership required.", 403);
    await this.pool.query(
      "UPDATE sessions SET workspace_id=$1 WHERE id=$2 AND user_id=$3",
      [workspaceId, actor.sessionId, actor.user.id],
    );
    return this.repo.workspace(workspaceId);
  }
  async challenge(userId, purpose) {
    const token = secretToken();
    await this.pool.query(
      "INSERT INTO auth_challenges(id,user_id,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",
      [newId("cha"), userId, purpose, hash(token)],
    );
    return token;
  }
  async consumeChallenge(raw, purpose, newPassword) {
    return withTransaction(this.pool, async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM auth_challenges WHERE token_hash=$1 AND purpose=$2 AND expires_at>now() AND consumed_at IS NULL FOR UPDATE",
          [hash(raw), purpose],
        )
      ).rows[0];
      if (!row)
        throw new AppError(
          "INVALID_TOKEN",
          "The verification link expired or is invalid.",
          400,
        );
      if (purpose === "reset_password") {
        await c.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
          row.user_id,
          await this.password(newPassword),
        ]);
        await c.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1", [
          row.user_id,
        ]);
      } else
        await c.query("UPDATE users SET email_verified_at=now() WHERE id=$1", [
          row.user_id,
        ]);
      await c.query(
        "UPDATE auth_challenges SET consumed_at=now() WHERE id=$1",
        [row.id],
      );
    });
  }
  cookie(token) {
    return `flux_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 604800 : 0}${this.production ? "; Secure" : ""}`;
  }
}
