import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * The server side of My profile and of the permission gate, run for real against the
 * database: the services, the repositories, the audit writes and the version check all
 * execute, and only the three things a Vitest process cannot provide are replaced —
 * the Next.js request (`next/headers`, `next/cache`), the Auth.js session, and the
 * redirect a server component would perform.
 *
 * That is what makes `COM-08`, `COM-10` and `COM-18` testable without a browser: they are
 * all decided on the server, before any screen is involved.
 */

/** Whose session the code under test sees. Each case sets it before it calls anything. */
let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

type Who = { id: string; email: string };

async function personByEmail(email: string): Promise<Who> {
  const { rows } = await testPool().query<Who>("select id, email from core.person where email = $1", [email]);
  return rows[0];
}

/** The newest audit entry, which is what every "it was recorded" assertion reads. */
async function lastAudit() {
  const { rows } = await testPool().query<{ action: string; outcome: string; actor_label: string; object_label: string | null }>(
    "select action, outcome, actor_label, object_label from audit.audit_entry order by at desc, id desc limit 1",
  );
  return rows[0];
}

describe.skipIf(!hasDatabase)("server-side writes and refusals", () => {
  let owner: Who;
  let member: Who;

  beforeAll(async () => {
    owner = await personByEmail("mariam@tahseel.ae");
    member = await personByEmail("layla@tahseel.ae");
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("COM-08 refuses a server action the person may not perform and records the attempt", async () => {
    const { requirePermission, NotPermitted } = await import("@/lib/session");
    signedInAs = member.id;

    // The Settings entry is hidden for a Member; forcing the call anyway is still refused.
    await expect(requirePermission("settings:write")).rejects.toBeInstanceOf(NotPermitted);

    const entry = await lastAudit();
    expect(entry.action).toBe("settings:write");
    expect(entry.outcome).toBe("Denied");
  });

  it("UC-75.2-04 refuses a brand colour below WCAG 2.2 AA even when the screen is bypassed", async () => {
    const { saveBrandColour } = await import("@/features/governance/service");
    const { ContrastError } = await import("@/lib/contrast");
    signedInAs = owner.id;

    const stored = async () =>
      (
        await testPool().query<{ colour: string | null }>(
          "select settings_json->'branding'->>'brandColour' as colour from gov.settings_version order by version_number desc limit 1",
        )
      ).rows[0]?.colour ?? null;
    const before = await stored();

    // Pale yellow passes a hex check and fails a contrast check. The screen disables Save,
    // but the colour reaches buttons, links, navigation and the widget, so the server is
    // what has to refuse it (NFR-18).
    await expect(saveBrandColour("#ffe066")).rejects.toBeInstanceOf(ContrastError);
    expect(await stored()).toBe(before);

    // A colour that clears AA still saves, so the check blocks nothing it should allow.
    await saveBrandColour("#12034B");
    expect(await stored()).toBe("#12034B");
  });

  it("UC-42.1-02 UC-42.1-03 creates an org unit and refuses a duplicate code", async () => {
    const { createOrgUnit } = await import("@/features/organisation/actions");
    const { removeOrgUnit } = await import("@/features/organisation/actions");
    signedInAs = owner.id;

    const code = `TSTU${Date.now().toString().slice(-6)}`;
    const created = await createOrgUnit({ code, nameEn: "Test unit", nameAr: "وحدة اختبار", parentOrgUnitId: null, leadPersonId: null });
    expect(created).toEqual({ ok: true });

    const { rows } = await testPool().query<{ id: string }>("select id from core.org_unit where code = $1", [code]);
    expect(rows).toHaveLength(1);

    const entry = await lastAudit();
    expect(entry.action).toBe("org_unit:create");
    expect(entry.outcome).toBe("Allowed");

    // `UC-42.1-03`: the same code again is refused with a message, not a constraint error.
    const again = await createOrgUnit({ code, nameEn: "Another", nameAr: "أخرى", parentOrgUnitId: null, leadPersonId: null });
    expect(again).toEqual({ ok: false, message: "Code already in use.", messageAr: "الرمز مستخدم بالفعل." });

    // An empty unit removes cleanly, which leaves the seed as it was.
    expect(await removeOrgUnit({ id: rows[0].id, code })).toEqual({ ok: true });
  });

  it("UC-42.1-04 refuses to delete an org unit that still has people, agents or projects", async () => {
    const { removeOrgUnit } = await import("@/features/organisation/actions");
    signedInAs = owner.id;

    const { rows } = await testPool().query<{ id: string; code: string }>(
      `select u.id, u.code from core.org_unit u
       where (select count(*) from core.person p where p.org_unit_id = u.id) > 0 limit 1`,
    );
    expect(rows.length, "the seed must carry a populated org unit").toBeGreaterThan(0);

    const result = await removeOrgUnit({ id: rows[0].id, code: rows[0].code });
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/Move members and projects first/);

    // Still there: a refusal must not half-delete.
    const after = await testPool().query("select 1 from core.org_unit where id = $1", [rows[0].id]);
    expect(after.rowCount).toBe(1);
  });

  it("COM-18 UC-04.1-01 UC-04.1-02 a profile save writes the person and an audit entry", async () => {
    const { saveProfile } = await import("@/features/organisation/actions");
    signedInAs = owner.id;

    const before = await testPool().query<{ version: number }>("select version from core.person where id = $1", [owner.id]);
    await saveProfile({
      nameEn: "Mariam Al Suwaidi",
      nameAr: "مريم السويدي",
      mobile: "+971 50 123 4567",
      preferredLanguage: "ar",
      version: before.rows[0].version,
    });

    const { rows } = await testPool().query<{ name_en: string; name_ar: string; mobile: string; preferred_language: string }>(
      "select name_en, name_ar, mobile, preferred_language from core.person where id = $1",
      [owner.id],
    );
    expect(rows[0].mobile).toBe("+971 50 123 4567");
    expect(rows[0].preferred_language).toBe("ar");

    const entry = await lastAudit();
    expect(entry.action).toBe("profile:update");
    expect(entry.outcome).toBe("Allowed");
    expect(entry.actor_label).toBe("Mariam Al Suwaidi");
  });

  it("COM-10 refuses the second save of the same row", async () => {
    const { saveProfile } = await import("@/features/organisation/actions");
    const { STALE_WRITE_DIGEST } = await import("@/lib/digests");
    signedInAs = owner.id;

    const { rows } = await testPool().query<{ version: number }>("select version from core.person where id = $1", [owner.id]);
    const stale = rows[0].version;

    // Both people read the same version; the first save wins and bumps it.
    expect(
      (await saveProfile({ nameEn: "Mariam Al Suwaidi", nameAr: "مريم السويدي", mobile: "", preferredLanguage: "en", version: stale })).ok,
    ).toBe(true);
    // The refusal comes back as a value carrying its kind, because a thrown message does
    // not survive a production build.
    const second = await saveProfile({ nameEn: "Mariam Al Suwaidi", nameAr: "مريم س.", mobile: "", preferredLanguage: "en", version: stale });
    expect(second.ok).toBe(false);
    expect(second.ok ? null : second.digest).toBe(STALE_WRITE_DIGEST);

    const after = await testPool().query<{ name_ar: string }>("select name_ar from core.person where id = $1", [owner.id]);
    expect(after.rows[0].name_ar).toBe("مريم السويدي");
  });

  it("UC-04.1-04 refuses an invalid mobile on the server", async () => {
    const { saveProfile } = await import("@/features/organisation/actions");
    signedInAs = owner.id;
    const { rows } = await testPool().query<{ version: number }>("select version from core.person where id = $1", [owner.id]);
    const refused = await saveProfile({
      nameEn: "Mariam",
      nameAr: "مريم",
      mobile: "not a number",
      preferredLanguage: "en",
      version: rows[0].version,
    });
    expect(refused.ok).toBe(false);
  });

  it("UC-04.1-03 UC-04.1-05 stores an accepted photo and refuses one that is not allowed", async () => {
    const { saveProfilePhoto } = await import("@/features/organisation/actions");
    signedInAs = owner.id;

    const version = async () =>
      (await testPool().query<{ version: number }>("select version from core.person where id = $1", [owner.id])).rows[0].version;

    expect((await saveProfilePhoto({ photo: `data:image/bmp;base64,${"A".repeat(80)}`, version: await version() })).ok).toBe(false);

    const photo = `data:image/png;base64,${"A".repeat(80)}`;
    expect((await saveProfilePhoto({ photo, version: await version() })).ok).toBe(true);
    const { rows } = await testPool().query<{ photo_ref: string }>("select photo_ref from core.person where id = $1", [owner.id]);
    expect(rows[0].photo_ref).toBe(photo);
  });

  it("UC-04.2-02 UC-04.2-03 leaves the Inbox untouched by the same choices", async () => {
    const { countOpenForMe } = await import("@/features/inbox/service");
    const { saveNotificationPreferences } = await import("@/features/organisation/actions");
    signedInAs = owner.id;

    const before = await countOpenForMe();
    await saveNotificationPreferences({ approvals: false, mentions: false, slaWarnings: false, dailyDigest: false });
    expect(await countOpenForMe()).toBe(before);
  });

  it("UC-04.3-01 UC-04.3-02 lists and removes a passkey, and audits the removal", async () => {
    const { removePasskey } = await import("@/features/organisation/actions");
    const { loadMyProfile } = await import("@/features/organisation/service");
    signedInAs = owner.id;

    const inserted = await testPool().query<{ id: string }>(
      `insert into core.passkey (person_id, label, credential_id, public_key, counter)
       values ($1, 'Test authenticator', $2, 'cHVibGlj', 0) returning id`,
      [owner.id, `cred-${Date.now()}`],
    );

    const profile = await loadMyProfile();
    expect(profile.passkeys.map((passkey) => passkey.label)).toContain("Test authenticator");
    expect(profile.sessions).toBeDefined();

    await removePasskey({ id: inserted.rows[0].id });
    const after = await loadMyProfile();
    expect(after.passkeys.map((passkey) => passkey.id)).not.toContain(inserted.rows[0].id);

    const entry = await lastAudit();
    expect(entry.action).toBe("profile:passkey_remove");
    expect(entry.object_label).toBe("Test authenticator");
  });
});

describe.skipIf(!hasDatabase)("a brand-new installation", () => {
  afterAll(async () => {
    vi.doUnmock("@/features/home/repository");
  });

  it("UC-05.1-04 sends a Platform Owner to the dashboard, like everyone else", async () => {
    const owner = await personByEmail("mariam@tahseel.ae");
    const member = await personByEmail("layla@tahseel.ae");
    // The owner holds every permission, and that sends them nowhere but the dashboard (D371).
    const { landingPath } = await import("@/features/home/service");
    signedInAs = owner.id;
    expect(await landingPath()).toBe("/dashboard");
    signedInAs = member.id;
    expect(await landingPath()).toBe("/dashboard");
  });
});
