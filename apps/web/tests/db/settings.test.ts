import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/** A valid PNG header of a given size. Nothing decodes it; only the IHDR is ever read. */
function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0);
  bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

/**
 * S-75 Settings, decided on the server: what General accepts, what the history records, and
 * what a feature flag actually changes.
 *
 * A flag is only a flag if something reads it. `UC-75.3-03` is the case that proves it:
 * turning graph retrieval off has to leave the platform vector-only, not merely flip a row
 * that nothing consults.
 */

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

describe.skipIf(!hasDatabase)("settings", () => {
  let ownerId = "";
  let memberId = "";
  let original: {
    nameEn: string;
    nameAr: string;
    timeZone: string;
    languages: string[];
    workingCalendarId: string | null;
    holidayCalendarId: string | null;
  };

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    const member = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    memberId = member.rows[0].id;

    const row = await testPool().query<typeof original>(
      `select name_en as "nameEn", name_ar as "nameAr", time_zone as "timeZone", languages,
              working_calendar_id as "workingCalendarId", holiday_calendar_id as "holidayCalendarId"
       from core.organisation limit 1`,
    );
    original = row.rows[0];
  });

  afterEach(async () => {
    // The organisation is a singleton every other suite reads, so it goes back as it was.
    await testPool().query(
      `update core.organisation set name_en = $1, name_ar = $2, time_zone = $3, languages = $4,
              working_calendar_id = $5, holiday_calendar_id = $6`,
      [
        original.nameEn,
        original.nameAr,
        original.timeZone,
        original.languages,
        original.workingCalendarId,
        original.holidayCalendarId,
      ],
    );
    await testPool().query(
      "update gov.feature_flag set is_enabled = true where key in ('graph-retrieval-graphiti','embedded-deployments')",
    );
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-75.1-01 saves General and records the change as a new settings version", async () => {
    const { saveGeneralSettings } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ count: string }>(
      "select count(*) as count from gov.settings_version",
    );

    await saveGeneralSettings({
      ...original,
      nameEn: "Tahseel Renamed",
      timeZone: "Asia/Riyadh",
      languages: ["en"],
    });

    const row = await testPool().query<{ name_en: string; time_zone: string; languages: string[] }>(
      "select name_en, time_zone, languages from core.organisation limit 1",
    );
    expect(row.rows[0]).toMatchObject({ name_en: "Tahseel Renamed", time_zone: "Asia/Riyadh" });
    expect(row.rows[0].languages).toEqual(["en"]);

    // "Saved with history": one more settings version than before.
    const after = await testPool().query<{ count: string }>(
      "select count(*) as count from gov.settings_version",
    );
    expect(Number(after.rows[0].count)).toBe(Number(before.rows[0].count) + 1);
  });

  it("UC-75.1-01 records what moved and what it was, not merely that something was saved", async () => {
    const { saveGeneralSettings } = await import("@/features/governance/service");
    signedInAs = ownerId;

    await saveGeneralSettings({ ...original, timeZone: "Asia/Riyadh" });

    const entry = await testPool().query<{ action: string; detail_json: { changed: Record<string, unknown> } }>(
      "select action, detail_json from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0].action).toBe("settings:write");
    expect(entry.rows[0].detail_json.changed).toMatchObject({
      timeZone: { from: original.timeZone, to: "Asia/Riyadh" },
    });
    // Unchanged fields are absent, so the trail reads as a change rather than a copy.
    expect(entry.rows[0].detail_json.changed).not.toHaveProperty("nameEn");
  });

  it("UC-75.1-01 refuses a time zone this platform cannot resolve", async () => {
    const { generalSettingsInput } = await import("@/features/governance/schema");

    // Calendars drive SLA and schedule arithmetic, so an unresolvable zone would make every
    // due date silently wrong rather than fail loudly.
    expect(() =>
      generalSettingsInput.parse({ ...original, timeZone: "Mars/Olympus_Mons" }),
    ).toThrow();
    expect(() => generalSettingsInput.parse({ ...original, timeZone: "Asia/Dubai" })).not.toThrow();
  });

  it("UC-75.1-01 refuses an empty name or no language at all", async () => {
    const { generalSettingsInput } = await import("@/features/governance/schema");
    expect(() => generalSettingsInput.parse({ ...original, nameEn: "  " })).toThrow();
    expect(() => generalSettingsInput.parse({ ...original, languages: [] })).toThrow();
  });

  it("UC-75.1-01 refuses a calendar that does not exist", async () => {
    const { saveGeneralSettings, SettingsRejected } = await import("@/features/governance/service");
    signedInAs = ownerId;

    await expect(
      saveGeneralSettings({ ...original, workingCalendarId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(SettingsRejected);
  });

  it("UC-75.2-01 an uploaded logo is what the shell renders in place of the default mark", async () => {
    const { saveBrandingAsset, loadBranding } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const before = await loadBranding();
    const uploaded = png(320, 100);

    await saveBrandingAsset("LogoLight", uploaded);

    // The shell reads this to decide whether to draw the design system's mark at all, so
    // an upload that stored nothing readable here would leave the screen unchanged.
    expect((await loadBranding()).logoLight).toBe(uploaded);

    // Put back through SQL, not the service: what the seed stores is a reference, and the
    // service only accepts an upload.
    if (before.logoLight) {
      await testPool().query("update gov.branding_asset set content_ref = $1 where kind = 'LogoLight'", [
        before.logoLight,
      ]);
    } else {
      await testPool().query("delete from gov.branding_asset where kind = 'LogoLight'");
    }
  });

  it("UC-75.2-02 a logo below the required size never reaches the shell", async () => {
    const { saveBrandingAsset } = await import("@/features/governance/service");
    const { BrandingRejected } = await import("@/lib/branding");
    signedInAs = ownerId;

    await expect(saveBrandingAsset("LogoLight", png(239, 80))).rejects.toBeInstanceOf(BrandingRejected);
  });

  it("UC-75.2-03 a saved brand colour is what the shell is given to apply", async () => {
    const { saveBrandColour, loadBranding } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const before = await loadBranding();
    // Dark enough to pass the WCAG 2.2 AA check the service enforces.
    await saveBrandColour("#0B5FFF");
    expect((await loadBranding()).brandColour).toBe("#0B5FFF");

    if (before.brandColour) await saveBrandColour(before.brandColour);
  });

  it("UC-75.3-01 toggling a flag is audited and changes what the platform reports", async () => {
    const { setFeatureFlag } = await import("@/features/governance/service");
    const { isFeatureEnabled } = await import("@/features/governance/service");
    const { FEATURE_FLAGS } = await import("@/lib/feature-flags");
    signedInAs = ownerId;

    expect(await isFeatureEnabled(FEATURE_FLAGS.graphRetrieval)).toBe(true);

    await setFeatureFlag(FEATURE_FLAGS.graphRetrieval, false);

    expect(await isFeatureEnabled(FEATURE_FLAGS.graphRetrieval)).toBe(false);
    const entry = await testPool().query<{ action: string; object_label: string }>(
      "select action, object_label from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toMatchObject({
      action: "settings:feature_flag",
      object_label: FEATURE_FLAGS.graphRetrieval,
    });
  });

  it("UC-75.3-03 turning graph retrieval off leaves the platform vector-only", async () => {
    const { setFeatureFlag } = await import("@/features/governance/service");
    const { loadKnowledge } = await import("@/features/knowledge/service");
    signedInAs = ownerId;

    expect((await loadKnowledge()).graphRetrieval).toBe(true);

    await setFeatureFlag("graph-retrieval-graphiti", false);

    // The screen reads this to disable Graph and Hybrid; a flag nothing consults is not a flag.
    expect((await loadKnowledge()).graphRetrieval).toBe(false);
  });

  it("UC-75.3-02 names the deployments that would stop before the flag is turned off", async () => {
    const { flagConsequences } = await import("@/features/governance/service");
    signedInAs = ownerId;

    const affected = await flagConsequences("embedded-deployments");
    const live = await testPool().query<{ count: string }>(
      "select count(*) as count from ai.embedded_deployment where status = 'Enabled'",
    );
    expect(affected).toHaveLength(Number(live.rows[0].count));
    for (const deployment of affected) expect(deployment.key).toBeTruthy();

    // A flag with no consequence beyond this screen needs no list.
    expect(await flagConsequences("page-assistant")).toEqual([]);
  });

  it("UC-75.4-01 refuses every settings write to someone who may not make one", async () => {
    const { saveGeneralSettings, setFeatureFlag, saveBrandColour } = await import(
      "@/features/governance/service"
    );
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = memberId;

    // Read-only or hidden is a screen decision; the server refuses the writes outright.
    await expect(saveGeneralSettings({ ...original })).rejects.toBeInstanceOf(NotPermitted);
    await expect(setFeatureFlag("page-assistant", false)).rejects.toBeInstanceOf(NotPermitted);
    await expect(saveBrandColour("#0B5FFF")).rejects.toBeInstanceOf(NotPermitted);

    const row = await testPool().query<{ name_en: string }>("select name_en from core.organisation limit 1");
    expect(row.rows[0].name_en).toBe(original.nameEn);
  });

  it("the Settings screen reads the organisation and every flag, and only for somebody who may", async () => {
    const { loadSettings } = await import("@/features/governance/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;

    const settings = await loadSettings();
    expect(settings.organisation).toEqual({
      nameEn: original.nameEn,
      nameAr: original.nameAr,
      timeZone: original.timeZone,
      languages: original.languages,
    });
    expect(settings.workingCalendarId).toBe(original.workingCalendarId);
    const flags = await testPool().query<{ key: string }>("select key from gov.feature_flag order by key");
    expect(settings.flags.map((flag) => flag.key).sort()).toEqual(flags.rows.map((row) => row.key).sort());

    signedInAs = memberId;
    await expect(loadSettings()).rejects.toBeInstanceOf(NotPermitted);
  });

  it("the tab icon is the stored favicon, read without a session", async () => {
    const { faviconUrl } = await import("@/features/governance/service");
    signedInAs = "";

    const stored = await testPool().query<{ content_ref: string }>(
      "select content_ref from gov.branding_asset where kind = 'Favicon'",
    );
    expect(await faviconUrl()).toBe(stored.rows[0]?.content_ref ?? null);
  });

  it("UC-79.1-01 the documentation pages are read in their own order, without a session", async () => {
    const { loadDocs } = await import("@/features/governance/service");
    signedInAs = "";

    const pages = await testPool().query<{ slug: string }>("select slug from gov.doc_page order by sort_order");
    expect(pages.rowCount).toBeGreaterThan(0);
    expect((await loadDocs()).map((page) => page.slug)).toEqual(pages.rows.map((row) => row.slug));
  });
});
