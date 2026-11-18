import { generateKeyPairSync } from "node:crypto";

import { isoBase64URL, isoCBOR, toHash } from "@simplewebauthn/server/helpers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-40, decided on the server: who may move a reporting line, and what a move may not do.
 *
 * The chart draws from the root down, so a reporting loop is not a cosmetic defect — the
 * branch inside the cycle is never reached and everyone in it disappears from the
 * organisation. The screen cannot prevent that on its own, because the loop is a property
 * of the stored graph and not of the form.
 */

let signedInAs = "";
/** The request's cookies; the passkey ceremony keeps its challenge here between its two calls. */
const cookieJar = new Map<string, { value: string; options: unknown }>();

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: unknown) => void cookieJar.set(name, { value, options }),
    delete: (name: string) => void cookieJar.delete(name),
  }),
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

describe.skipIf(!hasDatabase)("organisation", () => {
  let ownerId = "";
  let memberId = "";
  /** The person the owner reports to, restored after each move. */
  let ownerReportsTo: { type: string | null; id: string | null } = { type: null, id: null };

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;

    const member = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'layla@tahseel.ae'",
    );
    memberId = member.rows[0].id;

    const line = await testPool().query<{ reports_to_type: string | null; reports_to_id: string | null }>(
      "select reports_to_type, reports_to_id from core.person where id = $1",
      [ownerId],
    );
    ownerReportsTo = { type: line.rows[0].reports_to_type, id: line.rows[0].reports_to_id };
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-42.1-01 lists each org unit with its lead and what it holds", async () => {
    const { loadOrgUnits } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const { units } = await loadOrgUnits();
    expect(units.length).toBeGreaterThan(0);

    // Specification 7.3.3 names each of these on the row, and the figures have to be the
    // ones in the database: a count that silently returns zero renders the same as a unit
    // with nobody in it, which is how every unit came to show 0 people, 0 agents and 0
    // projects while the organisation held 7, 8 and 5 of them.
    const counted = await testPool().query<{ code: string; people: number; agents: number; projects: number }>(
      `select u.code,
              (select count(*) from core.person p where p.org_unit_id = u.id)::int as people,
              (select count(*) from ai.agent a where a.org_unit_id = u.id)::int as agents,
              (select count(*) from work.project pr where pr.org_unit_id = u.id)::int as projects
         from core.org_unit u`,
    );
    const expected = new Map(counted.rows.map((row) => [row.code, row]));
    for (const unit of units) {
      expect(unit.nameEn).toBeTruthy();
      const row = expected.get(unit.code);
      expect(row, `${unit.code} is in the database`).toBeDefined();
      expect([unit.people, unit.agents, unit.projects]).toEqual([row!.people, row!.agents, row!.projects]);
    }
    expect(units.reduce((total, unit) => total + unit.people + unit.agents + unit.projects, 0)).toBeGreaterThan(0);
    // Every unit in the demo organisation is led by someone.
    expect(units.every((unit) => unit.lead !== "")).toBe(true);
    // Exactly one root, which is what the indented list draws from.
    expect(units.filter((unit) => unit.isRoot)).toHaveLength(1);
  });

  it("offers every org unit to any signed-in person's picker, by English name, and nothing without a session", async () => {
    const { listOrgUnitChoices } = await import("@/features/organisation/actions");
    const expected = await testPool().query<{ id: string; nameEn: string; nameAr: string; code: string }>(
      `select id, name_en as "nameEn", name_ar as "nameAr", code from core.org_unit order by name_en`,
    );
    expect(expected.rowCount).toBeGreaterThan(1);

    // Choosing a unit for a project or an agent is not reading the organisation's
    // administration, so a person holding no role at all is still offered the units.
    const roleless = await testPool().query<{ id: string }>(
      `insert into core.person (email, name_en, name_ar, initials, status)
       values ($1, 'No role', 'بلا دور', 'NR', 'Active') returning id`,
      [`no-role-${Date.now().toString(36)}@tahseel.test`],
    );
    try {
      signedInAs = roleless.rows[0].id;
      expect(await listOrgUnitChoices()).toEqual(expected.rows);
    } finally {
      await testPool().query("delete from core.person where id = $1", [roleless.rows[0].id]);
    }

    signedInAs = "";
    await expect(listOrgUnitChoices()).rejects.toThrow(/^redirect:\/sign-in/);
  });

  it("UC-40.2-01 moves a person under a new manager and records who did it", async () => {
    const { changeReportingLine } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ reports_to_id: string | null }>(
      "select reports_to_id from core.person where id = $1",
      [memberId],
    );
    const original = before.rows[0].reports_to_id;

    await changeReportingLine(memberId, ownerId);

    const after = await testPool().query<{ reports_to_id: string | null; reports_to_type: string | null }>(
      "select reports_to_id, reports_to_type from core.person where id = $1",
      [memberId],
    );
    expect(after.rows[0]).toMatchObject({ reports_to_id: ownerId, reports_to_type: "Person" });

    const entry = await testPool().query<{ action: string; outcome: string }>(
      "select action, outcome from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toMatchObject({ action: "organisation:write", outcome: "Allowed" });

    // Leave the seeded hierarchy as it was, so the other suites see what they expect.
    await testPool().query("update core.person set reports_to_id = $1 where id = $2", [original, memberId]);
  });

  it("UC-40.2-02 refuses a move that would make a reporting loop", async () => {
    const { changeReportingLine, ReportingLineError } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    // The owner is the root, so putting her under anyone below her closes a cycle.
    await expect(changeReportingLine(ownerId, memberId)).rejects.toBeInstanceOf(ReportingLineError);

    const after = await testPool().query<{ reports_to_id: string | null }>(
      "select reports_to_id from core.person where id = $1",
      [ownerId],
    );
    expect(after.rows[0].reports_to_id).toBe(ownerReportsTo.id);
  });

  it("UC-40.2-02 refuses making someone their own manager", async () => {
    const { changeReportingLine, ReportingLineError } = await import("@/features/organisation/service");
    signedInAs = ownerId;
    await expect(changeReportingLine(memberId, memberId)).rejects.toBeInstanceOf(ReportingLineError);
  });

  it("UC-40.2-01 clears the reporting line when nobody is chosen", async () => {
    const { changeReportingLine } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const before = await testPool().query<{ reports_to_id: string | null }>(
      "select reports_to_id from core.person where id = $1",
      [memberId],
    );
    const original = before.rows[0].reports_to_id;

    await changeReportingLine(memberId, null);

    const after = await testPool().query<{ reports_to_id: string | null; reports_to_type: string | null }>(
      "select reports_to_id, reports_to_type from core.person where id = $1",
      [memberId],
    );
    expect(after.rows[0]).toMatchObject({ reports_to_id: null, reports_to_type: null });

    await testPool().query("update core.person set reports_to_id = $1, reports_to_type = 'Person' where id = $2", [
      original,
      memberId,
    ]);
  });

  it("UC-40.1-04 the chart resolves a manager that is an agent, not only a person", async () => {
    // The column is polymorphic and an agent may manage a person, so the chart has to read
    // the type: an agent is identified in the chart by its code, never by its row id.
    const { listOrgNodes } = await import("@/features/organisation/repository");

    const agent = await testPool().query<{ id: string; code: string }>(
      "select id, code from ai.agent where is_system = false order by code limit 1",
    );
    const before = await testPool().query<{ reports_to_id: string | null; reports_to_type: string | null }>(
      "select reports_to_id, reports_to_type from core.person where id = $1",
      [memberId],
    );

    await testPool().query(
      "update core.person set reports_to_type = 'Agent', reports_to_id = $1 where id = $2",
      [agent.rows[0].id, memberId],
    );

    const nodes = await listOrgNodes();
    const node = nodes.find((candidate) => candidate.id === memberId);
    expect(node?.parent).toBe(agent.rows[0].code);

    await testPool().query("update core.person set reports_to_type = $1, reports_to_id = $2 where id = $3", [
      before.rows[0].reports_to_type,
      before.rows[0].reports_to_id,
      memberId,
    ]);
  });
});

describe.skipIf(!hasDatabase)("S-40 the org chart", () => {
  let ownerId = "";

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>("select id from core.person where email = 'mariam@tahseel.ae'");
    ownerId = owner.rows[0].id;
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  it("UC-40.1-01 draws every person and every agent with an active version", async () => {
    const { loadOrgChart } = await import("@/features/organisation/service");
    signedInAs = ownerId;

    const people = await testPool().query<{ id: string }>("select id from core.person");
    const agents = await testPool().query<{ code: string }>(
      "select code from ai.agent where active_version_id is not null",
    );

    const nodes = await loadOrgChart();
    expect(nodes.map((node) => node.id).sort()).toEqual(
      [...people.rows.map((row) => row.id), ...agents.rows.map((row) => row.code)].sort(),
    );
  });

  it("sends somebody who is not signed in to sign in", async () => {
    const { loadOrgChart } = await import("@/features/organisation/service");
    signedInAs = "";
    await expect(loadOrgChart()).rejects.toThrow(/^redirect:\/sign-in/);
  });
});

describe.skipIf(!hasDatabase)("UC-04.3-02 registering a passkey", () => {
  let owner = { id: "", email: "", nameEn: "" };
  /** Credential ids this suite built, deleted again after each case. */
  const registered: string[] = [];

  beforeAll(async () => {
    const row = await testPool().query<{ id: string; email: string; name_en: string }>(
      "select id, email, name_en from core.person where email = 'mariam@tahseel.ae'",
    );
    owner = { id: row.rows[0].id, email: row.rows[0].email, nameEn: row.rows[0].name_en };
  });

  afterEach(async () => {
    cookieJar.clear();
    if (registered.length > 0) {
      await testPool().query("delete from core.passkey where credential_id = any($1)", [registered.splice(0)]);
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /**
   * What a browser returns from `navigator.credentials.create` with "none" attestation,
   * built by hand: a fresh P-256 key, client data naming the challenge and origin, and
   * authenticator data carrying the relying party's hash and the presence and verification
   * flags. Nothing is signed, because "none" attestation carries no statement.
   */
  async function attestation(challenge: string, origin: string, rpId: string) {
    const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ format: "jwk" });
    const coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(jwk.x ?? "")],
        [-3, isoBase64URL.toBuffer(jwk.y ?? "")],
      ]),
    );
    const credentialId = new Uint8Array(Buffer.from(`test-credential-${Date.now()}-${Math.random()}`));
    const authData = Buffer.concat([
      await toHash(new TextEncoder().encode(rpId)),
      Buffer.from([0x45]), // user present, user verified, attested credential data included
      Buffer.alloc(4), // signature counter
      Buffer.alloc(16), // AAGUID
      Buffer.from([credentialId.length >> 8, credentialId.length & 0xff]),
      credentialId,
      coseKey,
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, string>>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", new Uint8Array(authData)],
      ]),
    );
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false }));
    const id = isoBase64URL.fromBuffer(credentialId);
    return {
      id,
      response: {
        id,
        rawId: id,
        type: "public-key",
        response: {
          clientDataJSON: isoBase64URL.fromBuffer(new Uint8Array(clientDataJSON)),
          attestationObject: isoBase64URL.fromBuffer(attestationObject),
          transports: ["internal"],
        },
        clientExtensionResults: {},
      },
    };
  }

  it("offers the signed-in person a ceremony for this relying party and keeps its challenge server-side", async () => {
    const { startPasskeyRegistration } = await import("@/features/organisation/service");
    const { env } = await import("@/lib/env");
    signedInAs = owner.id;

    const options = await startPasskeyRegistration();

    expect(options.rp.id).toBe(env().WEBAUTHN_RP_ID);
    expect(options.user).toMatchObject({
      id: Buffer.from(owner.id).toString("base64url"),
      name: owner.email,
      displayName: owner.nameEn,
    });
    expect(options.attestation).toBe("none");
    expect(cookieJar.get("awp.webauthn.challenge")).toMatchObject({
      value: options.challenge,
      options: { httpOnly: true, maxAge: 60 },
    });
  });

  it("registers a verified passkey to the signed-in person and audits it", async () => {
    const { finishPasskeyRegistration, startPasskeyRegistration } = await import("@/features/organisation/service");
    const { env } = await import("@/lib/env");
    signedInAs = owner.id;

    const options = await startPasskeyRegistration();
    const built = await attestation(options.challenge, env().APP_URL, env().WEBAUTHN_RP_ID);
    registered.push(built.id);

    await finishPasskeyRegistration({ label: "Test key", response: built.response });

    const rows = await testPool().query<{ person_id: string; label: string; counter: number }>(
      "select person_id, label, counter from core.passkey where credential_id = $1",
      [built.id],
    );
    expect(rows.rows).toEqual([{ person_id: owner.id, label: "Test key", counter: 0 }]);
    expect(cookieJar.has("awp.webauthn.challenge")).toBe(false);

    const entry = await testPool().query<{ action: string; object_label: string; actor_id: string }>(
      "select action, object_label, actor_id from audit.audit_entry order by at desc, id desc limit 1",
    );
    expect(entry.rows[0]).toEqual({ action: "profile:passkey_register", object_label: "Test key", actor_id: owner.id });
  });

  it("refuses a response answering another ceremony's challenge", async () => {
    const { finishPasskeyRegistration, startPasskeyRegistration } = await import("@/features/organisation/service");
    const { env } = await import("@/lib/env");
    signedInAs = owner.id;

    await startPasskeyRegistration();
    const built = await attestation(isoBase64URL.fromBuffer(new Uint8Array(32)), env().APP_URL, env().WEBAUTHN_RP_ID);
    registered.push(built.id);

    await expect(finishPasskeyRegistration({ label: "Replayed", response: built.response })).rejects.toThrow(
      /challenge/,
    );
    const rows = await testPool().query("select 1 from core.passkey where credential_id = $1", [built.id]);
    expect(rows.rowCount).toBe(0);
  });

  it("refuses a response made for another site", async () => {
    const { finishPasskeyRegistration, startPasskeyRegistration } = await import("@/features/organisation/service");
    const { env } = await import("@/lib/env");
    signedInAs = owner.id;

    const options = await startPasskeyRegistration();
    const built = await attestation(options.challenge, "https://elsewhere.example", env().WEBAUTHN_RP_ID);
    registered.push(built.id);

    await expect(finishPasskeyRegistration({ label: "Foreign", response: built.response })).rejects.toThrow(/origin/);
    const rows = await testPool().query("select 1 from core.passkey where credential_id = $1", [built.id]);
    expect(rows.rowCount).toBe(0);
  });

  it("refuses a response when no ceremony was started", async () => {
    const { finishPasskeyRegistration } = await import("@/features/organisation/service");
    const { env } = await import("@/lib/env");
    signedInAs = owner.id;

    const built = await attestation("unissued", env().APP_URL, env().WEBAUTHN_RP_ID);
    await expect(finishPasskeyRegistration({ label: "Late", response: built.response })).rejects.toThrow(
      "The passkey registration timed out. Start it again.",
    );
  });
});
