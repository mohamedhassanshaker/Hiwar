import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, restoreColumns, testPool } from "./harness";

/**
 * `UC-30.1-04`: the intake form an external site embeds, and the script that draws it,
 * called as the App Router calls them.
 *
 * A stranger reaches both with no session, so what is checked is what bounds them: they
 * answer only for a published request type that takes `Widget` intake and names a project,
 * every answer carries the CORS allowance the host page needs, and a submission is checked
 * before anything is raised.
 *
 * The seeded `CRD` takes `Widget` intake but names no project, so the suite gives its
 * published version one for its duration and puts the row back exactly afterwards.
 */

process.env.APP_URL = "http://platform.test";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => null,
}));

const CODE = "CRD";
const params = (requestTypeCode: string) => ({ params: Promise.resolve({ requestTypeCode }) });

type Attribute = { key: string; label_en: string; label_ar: string; data_type: string; required: boolean; enum_values: { value: string; labelEn: string; labelAr: string }[] | null };

function submit(code: string, body: string): Request {
  return new Request(`http://platform.test/api/request-widget/${code}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://somebody-else.example" },
    body,
  });
}

describe.skipIf(!hasDatabase)("the request intake widget routes", () => {
  let version: { id: string; default_project_id: string | null; version: number; updated_at: Date };
  let type: { name_en: string; name_ar: string };
  let project: { id: string; key: string };
  let attributes: Attribute[] = [];
  const email = `route-test-${Date.now().toString(36)}@example.test`;
  const raised: string[] = [];

  beforeAll(async () => {
    const found = await testPool().query<typeof version & typeof type>(
      `select v.id, v.default_project_id, v.version, v.updated_at, rt.name_en, rt.name_ar
       from work.request_type rt join work.request_type_version v on v.id = rt.current_published_version_id
       where rt.code = $1`,
      [CODE],
    );
    const { id, default_project_id, version: rowVersion, updated_at, name_en, name_ar } = found.rows[0];
    version = { id, default_project_id, version: rowVersion, updated_at };
    type = { name_en, name_ar };
    const projects = await testPool().query<typeof project>("select id, key from work.project order by key limit 1");
    project = projects.rows[0];
    const defined = await testPool().query<Attribute>(
      `select key, label_en, label_ar, data_type, required, enum_values from work.attribute_definition
       where request_type_version_id = $1 order by sort_order`,
      [version.id],
    );
    attributes = defined.rows;
    await testPool().query("update work.request_type_version set default_project_id = $2 where id = $1", [version.id, project.id]);
  });

  afterAll(async () => {
    if (raised.length) {
      await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = any($1))", [raised]);
      await testPool().query("delete from work.request where key = any($1)", [raised]);
    }
    await testPool().query("delete from core.external_contact where channel = 'Widget' and channel_address = $1", [email]);
    await restoreColumns("work.request_type_version", version.id, {
      default_project_id: version.default_project_id,
      version: version.version,
      updated_at: version.updated_at,
    });
    await closeTestPool();
  });

  it("UC-30.1-04 a type that takes widget intake but names no project offers no form", async () => {
    const { GET } = await import("@/app/api/request-widget/[requestTypeCode]/route");
    const { GET: script } = await import("@/app/api/request-widget/[requestTypeCode]/embed.js/route");
    await testPool().query("update work.request_type_version set default_project_id = null where id = $1", [version.id]);
    try {
      const form = await GET(new Request(`http://platform.test/api/request-widget/${CODE}`), params(CODE));
      expect(form.status).toBe(404);
      expect(form.headers.get("access-control-allow-origin")).toBe("*");
      expect(await form.json()).toEqual({ reason: "No such form." });

      const embed = await script(new Request(`http://platform.test/api/request-widget/${CODE}/embed.js`), params(CODE));
      expect(embed.status).toBe(404);
    } finally {
      await testPool().query("update work.request_type_version set default_project_id = $2 where id = $1", [version.id, project.id]);
    }
  });

  it("UC-30.1-04 OPTIONS answers the preflight for any origin", async () => {
    const { OPTIONS } = await import("@/app/api/request-widget/[requestTypeCode]/route");
    const response = await OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });

  it("UC-30.1-04 GET returns the published fields, uncached and open to any origin", async () => {
    const { GET } = await import("@/app/api/request-widget/[requestTypeCode]/route");
    const response = await GET(new Request(`http://platform.test/api/request-widget/${CODE}`), params(CODE));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      code: CODE,
      nameEn: type.name_en,
      nameAr: type.name_ar,
      fields: attributes.map((attribute) => ({
        key: attribute.key,
        labelEn: attribute.label_en,
        labelAr: attribute.label_ar,
        dataType: attribute.data_type,
        required: attribute.required,
        enumValues: attribute.enum_values,
      })),
    });
  });

  it("UC-30.1-04 GET for a type that takes no widget intake, or does not exist, is 404", async () => {
    const { rows } = await testPool().query<{ code: string }>(
      `select rt.code from work.request_type rt join work.request_type_version v on v.id = rt.current_published_version_id
       where not ('Widget' = any(v.intake_channels)) order by rt.code limit 1`,
    );
    const { GET } = await import("@/app/api/request-widget/[requestTypeCode]/route");

    for (const code of [rows[0].code, "NO-SUCH-TYPE"]) {
      const response = await GET(new Request(`http://platform.test/api/request-widget/${code}`), params(code));
      expect(response.status, code).toBe(404);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("UC-30.1-04 embed.js is generated for the type, public, uncached and pointed at its endpoint", async () => {
    const { GET } = await import("@/app/api/request-widget/[requestTypeCode]/embed.js/route");
    const response = await GET(new Request(`http://platform.test/api/request-widget/${CODE}/embed.js`), params(CODE));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const script = await response.text();
    expect(script).toContain(JSON.stringify(`http://platform.test/api/request-widget/${CODE}`));
    expect(script).toContain(`title: ${JSON.stringify(type.name_en)}`);
    expect(script).toContain(`title: ${JSON.stringify(type.name_ar)}`);
  });

  it("UC-30.1-04 embed.js for a type that does not exist is a 404 script", async () => {
    const { GET } = await import("@/app/api/request-widget/[requestTypeCode]/embed.js/route");
    const response = await GET(new Request("http://platform.test/api/request-widget/NO-SUCH-TYPE/embed.js"), params("NO-SUCH-TYPE"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/javascript");
    expect(await response.text()).toBe("// No such form.");
  });

  it("UC-30.1-04 a valid submission raises a request from an external contact into the type's project", async () => {
    const { POST } = await import("@/app/api/request-widget/[requestTypeCode]/route");
    const values: Record<string, string> = { card_last4: "4242", reason: "lost", delivery_addr: "Abu Dhabi" };
    const body = JSON.stringify({
      name: "Route Test",
      email: email.toUpperCase(),
      summary: "My card was lost",
      attributes: { ...values, invented_field: "not part of the type" },
    });

    const response = await POST(submit(CODE, body), params(CODE));
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.status).toBe(200);
    const { key } = (await response.json()) as { key: string };
    raised.push(key);

    const { rows } = await testPool().query<{
      project_id: string;
      request_type_version_id: string;
      channel: string;
      requester_type: string;
      requester_id: string;
      title_en: string;
      attributes: Record<string, string>;
    }>(
      "select project_id, request_type_version_id, channel, requester_type, requester_id, title_en, attributes from work.request where key = $1",
      [key],
    );
    expect(rows[0]).toMatchObject({
      project_id: project.id,
      request_type_version_id: version.id,
      channel: "Widget",
      requester_type: "ExternalContact",
      title_en: "My card was lost",
    });
    // Only the attributes the type declares are stored.
    expect(rows[0].attributes).toEqual(
      Object.fromEntries(attributes.filter((attribute) => values[attribute.key]).map((attribute) => [attribute.key, values[attribute.key]])),
    );
    // The contact is keyed by the email as given, lower-cased.
    const contact = await testPool().query<{ id: string }>(
      "select id from core.external_contact where channel = 'Widget' and channel_address = $1",
      [email],
    );
    expect(rows[0].requester_id).toBe(contact.rows[0].id);
  });

  it("UC-30.1-04 a body that is not JSON, or lacks a name, a valid email or a summary, is 400", async () => {
    const { POST } = await import("@/app/api/request-widget/[requestTypeCode]/route");

    const malformed = await POST(submit(CODE, "name=someone"), params(CODE));
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("access-control-allow-origin")).toBe("*");
    expect(await malformed.json()).toEqual({ reason: "The body is not JSON." });

    for (const incomplete of [
      { email, summary: "no name" },
      { name: "Route Test", email: "not-an-email", summary: "bad email" },
      { name: "Route Test", email, summary: "   " },
    ]) {
      const response = await POST(submit(CODE, JSON.stringify(incomplete)), params(CODE));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ reason: "A name, a valid email and a summary are required." });
    }
  });

  it("UC-30.1-04 a missing required field, or a type with no widget intake, is refused with the reason", async () => {
    const { POST } = await import("@/app/api/request-widget/[requestTypeCode]/route");
    const required = attributes.filter((attribute) => attribute.required).map((attribute) => attribute.label_en);
    const before = await testPool().query("select 1 from work.request where request_type_version_id = $1", [version.id]);

    const missing = await POST(
      submit(CODE, JSON.stringify({ name: "Route Test", email, summary: "nothing filled in", attributes: {} })),
      params(CODE),
    );
    expect(missing.status).toBe(400);
    // The first problem, by the rule the console's form applies (D304).
    expect(await missing.json()).toEqual({ reason: `${required[0]} is required.` });

    const wrongType = await POST(
      submit("NO-SUCH-TYPE", JSON.stringify({ name: "Route Test", email, summary: "anything" })),
      params("NO-SUCH-TYPE"),
    );
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toEqual({ reason: "That request type takes no requests from a website." });

    const after = await testPool().query("select 1 from work.request where request_type_version_id = $1", [version.id]);
    expect(after.rowCount).toBe(before.rowCount);
  });
});
