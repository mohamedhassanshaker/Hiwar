import nodemailer, { type Transporter } from "nodemailer";

import { env } from "./env";

let transport: Transporter | null = null;

/** Sends a plain-text email. Failures are logged and not thrown: mail never blocks a user action. */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  transport ??= nodemailer.createTransport(env().SMTP_URL);
  try {
    await transport.sendMail({ from: env().MAIL_FROM, to, subject, text });
  } catch (problem) {
    console.error("mail failed", { to, subject, problem: String(problem) });
  }
}
