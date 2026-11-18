import nodemailer from "nodemailer";

import type { MailSettings } from "@/db/queries/mail";
import { decrypt } from "./crypto";

/**
 * D240: one email through the platform's mail server. The agent's email tool and the
 * system notifications are two callers of this; neither builds a transport of its own.
 */

/** Why a send failed, and whether trying again later can help. */
export class MailFailure extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "MailFailure";
  }
}

/** Connection errors and a 4xx reply are the server's to recover from; a 5xx is final. */
const TRANSIENT_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN"]);

/** A transport to the configured SMTP server, opened for one use. The stored password is decrypted only here. */
function openTransport(settings: MailSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    auth: settings.username ? { user: settings.username, pass: settings.passwordCipher ? decrypt(Buffer.from(settings.passwordCipher, "base64")) : "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** The failure a transport error is: transient for a connection error or a 4xx reply and final otherwise. */
function failureOf(problem: unknown): MailFailure {
  const failure = problem as { code?: string; responseCode?: number; message?: string };
  const transient = TRANSIENT_CODES.has(failure.code ?? "") || (failure.responseCode !== undefined && failure.responseCode >= 400 && failure.responseCode < 500);
  return new MailFailure(failure.message ?? String(problem), transient);
}

/**
 * Sends one message through the configured SMTP server on a transport opened for this send and
 * closed after it. A failure is thrown as `MailFailure`.
 */
export async function sendMail(settings: MailSettings, message: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const transport = openTransport(settings);
  try {
    await transport.sendMail({
      from: settings.fromName ? { name: settings.fromName, address: settings.fromAddress } : settings.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
  } catch (problem) {
    throw failureOf(problem);
  } finally {
    transport.close();
  }
}

/** Connects to the configured SMTP server and signs in, sending nothing. Throws `MailFailure` when it cannot. */
export async function verifyMailServer(settings: MailSettings): Promise<void> {
  const transport = openTransport(settings);
  try {
    await transport.verify();
  } catch (problem) {
    throw failureOf(problem);
  } finally {
    transport.close();
  }
}
