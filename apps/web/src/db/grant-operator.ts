/**
 * Gives a Hiwar staff account a platform role (OPS-001): npm run ops:grant -- <email> <platform_admin|support_operator|none>
 * Run by an engineer with database access; there is no screen for it, so the roles cannot be self-assigned.
 */
import { eq } from "drizzle-orm";

import { db, pool, schema } from "./index";

const [email, role] = process.argv.slice(2);
if (!email || !["platform_admin", "support_operator", "none"].includes(role ?? "")) {
  console.error("usage: npm run ops:grant -- <email> <platform_admin|support_operator|none>");
  process.exit(1);
}
const [user] = await db
  .update(schema.users)
  .set({ platformRole: role === "none" ? null : (role as "platform_admin" | "support_operator") })
  .where(eq(schema.users.email, email.toLowerCase()))
  .returning({ id: schema.users.id });
console.log(user ? `${email}: ${role}` : `no account for ${email}`);
await pool.end();
