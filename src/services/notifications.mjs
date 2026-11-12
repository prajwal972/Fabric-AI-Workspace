import nodemailer from "nodemailer";
import { AppError } from "../server/errors.mjs";
export class NotificationService {
  constructor({ env, box }) {
    this.env = env;
    this.box = box;
    this.transport = env.FABRIC_SMTP_URL
      ? nodemailer.createTransport(env.FABRIC_SMTP_URL)
      : null;
  }
  configured() {
    return !!this.transport;
  }
  async send(actor, { ciphertext }, { signal }) {
    signal.throwIfAborted();
    if (!this.transport)
      throw new AppError(
        "EMAIL_NOT_CONFIGURED",
        "Transactional email is not configured.",
        503,
      );
    const data = JSON.parse(this.box.decrypt(ciphertext));
    if (!["verify_email", "reset_password"].includes(data.purpose))
      throw new Error("Unknown notification template");
    const url = new URL("/account/" + data.purpose, this.env.FABRIC_PUBLIC_URL);
    url.hash=new URLSearchParams({token:data.token}).toString();
    await this.transport.sendMail({
      from: this.env.FABRIC_EMAIL_FROM,
      to: actor.user.email,
      subject:
        data.purpose === "verify_email"
          ? "Verify your Fabric account"
          : "Reset your Fabric password",
      text: "Use this single-use link within 30 minutes: " + url.toString(),
    });
    return { sent: true };
  }
}
