import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Test saved settings (D240): `verifyMailServer` connects to the configured SMTP server and sends
 * nothing. The server here is a socket that speaks just enough SMTP for a connection check.
 */

process.env.APP_KEK ??= Buffer.alloc(32, 7).toString("base64");

const { verifyMailServer, MailFailure } = await import("@/lib/mailer");
type Settings = Parameters<typeof verifyMailServer>[0];

const SETTINGS = { enabled: true, host: "127.0.0.1", port: 0, security: "none", username: "", passwordCipher: null, fromAddress: "platform@example.test", fromName: "" } as unknown as Settings;

let server: Server | undefined;
afterEach(() => void server?.close());

/** Listens on a free port, answering the greeting, EHLO and QUIT like an SMTP server. */
async function smtpOnFreePort(): Promise<{ port: number; commands: string[] }> {
  const commands: string[] = [];
  server = createServer((socket) => {
    socket.write("220 sink ESMTP\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.toString().split("\r\n").filter(Boolean)) {
        commands.push(line.split(" ")[0].toUpperCase());
        if (line.toUpperCase().startsWith("EHLO")) socket.write("250 sink\r\n");
        else if (line.toUpperCase().startsWith("QUIT")) socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { port: (server!.address() as { port: number }).port, commands };
}

describe("verifyMailServer", () => {
  it("connects and greets without sending a message", async () => {
    const { port, commands } = await smtpOnFreePort();
    await expect(verifyMailServer({ ...SETTINGS, port })).resolves.toBeUndefined();
    expect(commands).toContain("EHLO");
    expect(commands).not.toContain("DATA");
    expect(commands).not.toContain("MAIL");
  });

  it("fails with a transient MailFailure when nothing listens on the port", async () => {
    const { port } = await smtpOnFreePort();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    const failure = await verifyMailServer({ ...SETTINGS, port }).catch((problem: unknown) => problem);
    expect(failure).toBeInstanceOf(MailFailure);
    expect((failure as InstanceType<typeof MailFailure>).transient).toBe(true);
  });
});
