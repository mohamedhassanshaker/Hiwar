"use server";

import { z } from "zod";

import { db, schema } from "@/db";
import { act } from "@/server/actions";
import { sendMail } from "@/server/mail";

const input = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  company: z.string().trim().min(1).max(160),
  message: z.string().trim().max(2000),
});

/** WEB-002 FR-012: Enterprise contact form; sales answers within 1 working day. */
export async function salesAction(raw: unknown) {
  return act(async () => {
    const data = input.parse(raw);
    await db.insert(schema.salesRequests).values(data);
    await sendMail("sales@hiwar.local", `Enterprise request from ${data.company}`, `${data.name} <${data.email}>\n\n${data.message}`);
  });
}
