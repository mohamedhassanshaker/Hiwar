import { Pool } from "pg";

import { hashPassword } from "../lib/password.js";

/**
 * D387: sets the built-in password of existing people, for an operator. People normally choose
 * their own (invitation, Forgot password); this is for an installation that has none yet, such
 * as the seeded demo people and the people the live tests sign in as.
 *
 *   NEW_PASSWORD=… node apps/web/db-migrate/db/set-password.js <email> [<email>…]
 *   NEW_PASSWORD=… npm run db:set-password -- <email> [<email>…]
 *
 * The password comes from the environment, not the command line, so it stays out of the
 * process list and the shell history. It is not checked against the sign-in rules: an operator
 * may set a temporary one, and the person changes it with Forgot password.
 */
async function main(): Promise<void> {
  const password = process.env.NEW_PASSWORD;
  const emails = process.argv.slice(2);
  const connectionString = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL;
  if (!password || emails.length === 0 || !connectionString) {
    throw new Error("Set NEW_PASSWORD and DATABASE_URL, and name at least one email address.");
  }
  const pool = new Pool({ connectionString, max: 1, application_name: "awp-set-password" });
  try {
    for (const email of emails) {
      const { rowCount } = await pool.query(
        `insert into core.person_credential (person_id, password_hash)
         select id, $2 from core.person where lower(email) = lower($1)
         on conflict (person_id) do update set password_hash = excluded.password_hash, changed_at = now()`,
        [email, await hashPassword(password)],
      );
      process.stdout.write(rowCount ? `password set: ${email}\n` : `no such person: ${email}\n`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((problem: unknown) => {
  process.stderr.write(`${problem instanceof Error ? problem.message : String(problem)}\n`);
  process.exit(1);
});
