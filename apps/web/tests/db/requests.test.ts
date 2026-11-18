import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * S-27 to S-30 against the database: the list, the designer, and acting on a request.
 *
 * A request type is data a request then follows, so the designer's writes and the routing
 * that reads them are tested together: a flow that saves but does not route is half a
 * feature, and the half that is missing is the one that matters.
 */

process.env.AGENT_SERVICE_URL ??= "http://agent-service.test";
process.env.RUN_TOKEN_SIGNING_KEY ??= "a-key-for-the-tests-only-0123456789";

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("requests", () => {
  let ownerId = "";
  let otherId = "";
  const createdTypes: string[] = [];
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const owner = await testPool().query<{ id: string }>(
      "select id from core.person where email = 'mariam@tahseel.ae'",
    );
    ownerId = owner.rows[0].id;
    // Somebody else who may act on a request, so the audience rules are what decide.
    const other = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'requests:write' and rp.effect = 'Allow'
         and p.status = 'Active' and p.email <> 'mariam@tahseel.ae'
       order by ra.person_id limit 1`,
    );
    otherId = other.rows[0].id;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (createdTypes.length > 0) {
      // A request pins its version, so the requests go before the type they are of.
      await testPool().query(
        `delete from work.request_event where request_id in (
           select r.id from work.request r
           join work.request_type_version v on v.id = r.request_type_version_id
           join work.request_type rt on rt.id = v.request_type_id where rt.code = any($1))`,
        [createdTypes],
      );
      await testPool().query(
        `delete from work.request where request_type_version_id in (
           select v.id from work.request_type_version v
           join work.request_type rt on rt.id = v.request_type_id where rt.code = any($1))`,
        [createdTypes],
      );
      await testPool().query(
        `delete from work.routing_rule where from_step_id in (
           select ts.id from work.transition_step ts
           join work.request_type_version v on v.id = ts.request_type_version_id
           join work.request_type rt on rt.id = v.request_type_id where rt.code = any($1))`,
        [createdTypes],
      );
      await testPool().query(
        `delete from work.request_type where code = any($1)`,
        [createdTypes],
      );
      createdTypes.length = 0;
    }
  });

  afterAll(async () => {
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** A request type of this test's own, so the designer cases never touch a seeded one. */
  const makeType = async (over: Record<string, unknown> = {}) => {
    const { createRequestType } = await import("@/features/requests/service");
    const code = `T${Date.now().toString().slice(-6)}`;
    await createRequestType({
      code,
      nameEn: "A request type for the tests",
      nameAr: "نوع طلب للاختبارات",
      categoryEn: "Finance",
      decomposition: "None",
      ...over,
    } as Parameters<typeof createRequestType>[0]);
    createdTypes.push(code);
    return code;
  };

  it("UC-27.1-01 UC-27.2-01 the list carries the requests and the types a person may see", async () => {
    const { loadRequestTypes, loadRequests } = await import("@/features/requests/service");
    signedInAs = ownerId;

    const { requests, total } = await loadRequests();
    expect(requests.length).toBe(Math.min(total, 50));
    const { types, mayWriteTypes } = await loadRequestTypes();
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      expect(type.c.length).toBeGreaterThan(0);
      expect(type.st.length).toBeGreaterThan(0);
    }
    expect(mayWriteTypes).toBe(true);
  });

  it("UC-27.1-05 UC-27.2-05 a person sees the requests their projects reach, and may not design a type", async () => {
    const { loadRequestTypes, loadRequests } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const everything = await loadRequests();

    // Somebody who may read requests but not design a type.
    const limited = await testPool().query<{ id: string }>(
      `select distinct ra.person_id as id from core.role_assignment ra
       join core.role r on r.id = ra.role_id
       join core.role_permission rp on rp.role_id = r.id
       join core.permission perm on perm.id = rp.permission_id
       join core.person p on p.id = ra.person_id
       where perm.code = 'requests:read' and rp.effect = 'Allow' and p.status = 'Active'
         and not exists (
           select 1 from core.role_assignment ra2
           join core.role r2 on r2.id = ra2.role_id
           join core.role_permission rp2 on rp2.role_id = r2.id
           join core.permission perm2 on perm2.id = rp2.permission_id
           where ra2.person_id = ra.person_id and perm2.code = 'request_types:write'
         )
       order by ra.person_id limit 1`,
    );
    if (limited.rowCount === 0) return;
    signedInAs = limited.rows[0].id;
    const theirs = await loadRequests();
    expect((await loadRequestTypes()).mayWriteTypes).toBe(false);
    expect(theirs.total).toBeLessThanOrEqual(everything.total);
  });

  it("D349 the request list is filtered, counted and paged on the server, and a request opens off the page", async () => {
    const { createRequest, loadRequest, loadRequests } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    const { publishRequestType, addStep } = await import("@/features/requests/service");
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await publishRequestType({ code });
    const word = `paged${Date.now()}`;
    const keys: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      keys.push(
        await createRequest({ projectKey: "FIN", requestTypeCode: code, titleEn: `${word} ${index}`, titleAr: `${word} ${index}`, entryMode: "Form", attributes: {} }),
      );
    }

    // The search finds exactly these, newest first, and the pages split them.
    const first = await loadRequests({ q: word }, { limit: 2, offset: 0 });
    const second = await loadRequests({ q: word }, { limit: 2, offset: 2 });
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect([...first.requests, ...second.requests].map((request) => request.k)).toEqual([...keys].reverse());
    // Each filter narrows the same count.
    expect((await loadRequests({ q: word, typeCode: code, projectKey: "FIN", requester: ownerId })).total).toBe(3);
    expect((await loadRequests({ q: word, projectKey: "PROC" })).total).toBe(0);
    expect((await loadRequests({ q: word, requester: "ext" })).total).toBe(0);
    expect((await loadRequests({ q: word, submittedBefore: new Date(Date.now() - 86_400_000) })).total).toBe(0);
    expect((await loadRequests({ q: word, submittedFrom: new Date(Date.now() - 86_400_000) })).total).toBe(3);
    // `%` and `_` in the search are literal, not wildcards (D321).
    expect((await loadRequests({ q: `${word}%` })).total).toBe(0);

    // The oldest is not on the first page of two, and still opens by its key.
    expect(first.requests.map((request) => request.k)).not.toContain(keys[0]);
    expect(await loadRequest(keys[0])).toMatchObject({ request: { k: keys[0] }, detail: { key: keys[0] } });
  });

  it("UC-27.2-02 UC-27.2-03 a type is created as a draft, and a duplicate code is refused", async () => {
    const { RequestTypeRejected, createRequestType, loadRequestTypeDetail } = await import(
      "@/features/requests/service"
    );
    signedInAs = ownerId;

    const code = await makeType();
    const { rows } = await testPool().query<{ status: string; number: number }>(
      `select v.status, v.version_number as number from work.request_type_version v
       join work.request_type rt on rt.id = v.request_type_id where rt.code = $1`,
      [code],
    );
    expect(rows[0].status).toBe("Draft");
    expect(rows[0].number).toBe(1);
    expect(await loadRequestTypeDetail(code)).not.toBeNull();

    await expect(
      createRequestType({
        code,
        nameEn: "The same code again",
        nameAr: "نفس الرمز",
        categoryEn: "Finance",
        decomposition: "None",
      }),
    ).rejects.toBeInstanceOf(RequestTypeRejected);
  });

  it("UC-30.1-01 UC-30.1-03 the draft's settings are saved, and the published version is not touched", async () => {
    const { saveDraft } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await saveDraft({
      code,
      categoryEn: "Procurement",
      decomposition: "Template",
      slaValue: 2,
      slaUnit: "BusinessDays",
      defaultProjectKey: null,
      intakeChannels: ["Console", "WhatsApp"],
      entryModes: ["TemplateForm"],
    });

    // The category is the type's, so it is read back from the type rather than the version.
    const { rows: type } = await testPool().query<{ category: string }>(
      "select category_en as category from work.request_type where code = $1",
      [code],
    );
    expect(type[0].category).toBe("Procurement");

    const { rows } = await testPool().query<{
      decomposition: string;
      sla: number;
      channels: string[];
      status: string;
    }>(
      `select v.decomposition, v.sla_value as sla, v.intake_channels as channels, v.status
       from work.request_type_version v join work.request_type rt on rt.id = v.request_type_id
       where rt.code = $1`,
      [code],
    );
    expect(rows[0].decomposition).toBe("Template");
    expect(rows[0].sla).toBe(2);
    expect(rows[0].channels).toContain("WhatsApp");
    // It is still a draft: saving is not publishing.
    expect(rows[0].status).toBe("Draft");

    // The designer opens on exactly this — the column write above is necessary but not
    // sufficient, since the designer reads the type back through `loadRequestTypeDetail`,
    // not the column directly. Reading the draft specifically, since publishing is a
    // separate, later step this save does not take.
    const { loadRequestTypeDetail } = await import("@/features/requests/service");
    const reloaded = await loadRequestTypeDetail(code, "draft");
    expect(reloaded?.decomposition).toBe("Template");
    expect(reloaded?.slaValue).toBe(2);
    expect(reloaded?.slaUnit).toBe("BusinessDays");
  });

  it("UC-30.1-02 a type with no entry mode cannot be saved", async () => {
    const { saveDraftInput } = await import("@/features/requests/schema");
    // A type nobody can enter a request through is not a type, so the boundary refuses it.
    const outcome = saveDraftInput.safeParse({
      code: "X",
      decomposition: "None",
      slaValue: null,
      slaUnit: null,
      defaultProjectKey: null,
      intakeChannels: ["Console"],
      entryModes: [],
    });
    expect(outcome.success).toBe(false);
    expect(JSON.stringify(outcome.error?.issues)).toMatch(/at least one entry mode/i);
  });

  it("UC-30.2-01 UC-30.2-02 UC-30.2-03 UC-30.2-04 steps, audiences and rules are written to the draft", async () => {
    const { addAudience, addRule, addStep, loadRequestTypeDetail, setStepTerminal } = await import(
      "@/features/requests/service"
    );
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Finance approval", nameAr: "اعتماد مالي", slaValue: 1, slaUnit: "BusinessDays" });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });

    await addAudience({
      code,
      stepName: "Submitted",
      principalType: "Requester",
      principalId: null,
      access: "CanAct",
      sequence: null,
    });
    await addAudience({
      code,
      stepName: "Finance approval",
      principalType: "Person",
      principalId: ownerId,
      access: "CanAct",
      sequence: null,
    });
    await addRule({
      code,
      stepName: "Submitted",
      kind: "Action",
      expression: null,
      actionName: "Submit",
      toStepName: "Finance approval",
    });
    await addRule({
      code,
      stepName: "Finance approval",
      kind: "Action",
      expression: null,
      actionName: "Approve",
      toStepName: "Closed",
    });

    // `UC-30.2-04`: terminal means nothing to do and nowhere to go, so marking it clears both.
    await addAudience({
      code,
      stepName: "Closed",
      principalType: "Person",
      principalId: ownerId,
      access: "CanAct",
      sequence: null,
    });
    await setStepTerminal({ code, stepName: "Closed", terminal: true, outcome: "Completed" });

    const detail = await loadRequestTypeDetail(code);
    expect(detail?.steps.map((step) => step.n)).toEqual(["Submitted", "Finance approval", "Closed"]);
    expect(detail?.steps[0].out).toHaveLength(1);
    const closed = detail?.steps[2];
    expect(closed?.aud).toHaveLength(0);
    expect(closed?.out).toHaveLength(0);
  });

  it("D164 a person or requester audience reads as a name in the designer", async () => {
    const { addAudience, addStep, loadRequestTypeDetail } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Review", principalType: "Requester", principalId: null, access: "ViewOnly", sequence: null });
    const other = (await testPool().query<{ name_en: string }>("select name_en from core.person where id = $1", [otherId])).rows[0];
    const review = (await loadRequestTypeDetail(code, "draft"))?.steps.find((step) => step.n === "Review");
    expect(review?.aud.map(([en, , access]) => [en, access])).toEqual(
      expect.arrayContaining([
        [other.name_en, "CanAct"],
        ["Requester", "ViewOnly"],
      ]),
    );
  });

  it("UC-30.2-02 a role audience is taken by its code or name, and one that names no role is refused", async () => {
    const { addAudience, addStep, loadRequestTypeDetail } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    const role = (await testPool().query<{ code: string; name_en: string }>("select code, name_en from core.role where code = 'WorkLead'")).rows[0];
    await addAudience({ code, stepName: "Review", principalType: "Role", principalId: role.code, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Review", principalType: "Role", principalId: role.name_en.toLowerCase(), access: "ViewOnly", sequence: null });
    await expect(
      addAudience({ code, stepName: "Review", principalType: "Role", principalId: "NoSuchRole", access: "CanAct", sequence: null }),
    ).rejects.toThrow("There is no role NoSuchRole.");
    const review = (await loadRequestTypeDetail(code, "draft"))?.steps.find((step) => step.n === "Review");
    expect(review?.aud.map(([en, , access]) => [en, access])).toEqual([
      [role.name_en, "CanAct"],
      [role.name_en, "ViewOnly"],
    ]);
  });

  it("UC-30.2-09 UC-30.2-10 deleting a step names the rules pointing at it, and a loop is allowed", async () => {
    const { addRule, addStep, deleteStep } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Send", toStepName: "Review" });
    // `UC-30.2-10`: a rule back to an earlier step is an explicit choice, so it is allowed.
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Return", toStepName: "Submitted" });

    const warned = await deleteStep({ code, stepName: "Review", confirmed: false });
    expect(warned.removed).toBe(false);
    expect(warned.referencedBy.join(" ")).toContain("Submitted");

    const removed = await deleteStep({ code, stepName: "Review", confirmed: true });
    expect(removed.removed).toBe(true);
  });

  it("UC-30.3-01 UC-30.3-02 UC-30.3-03 attributes are added, kept unique and removed", async () => {
    const { RequestTypeRejected, addAttribute, loadRequestTypeDetail, removeAttribute } = await import(
      "@/features/requests/service"
    );
    signedInAs = ownerId;
    const code = await makeType();

    await addAttribute({ code, key: "amount_aed", labelEn: "Amount", labelAr: "المبلغ", dataType: "Money", required: true, stepName: null });
    expect((await loadRequestTypeDetail(code))?.attributes.map((one) => one.key)).toContain("amount_aed");

    await expect(
      addAttribute({ code, key: "amount_aed", labelEn: "Amount again", labelAr: "المبلغ", dataType: "Money", required: false, stepName: null }),
    ).rejects.toBeInstanceOf(RequestTypeRejected);

    await removeAttribute({ code, key: "amount_aed" });
    expect((await loadRequestTypeDetail(code))?.attributes.map((one) => one.key)).not.toContain("amount_aed");
  });

  it("UC-30.4-01 UC-30.2-05 publishing is refused while the flow has a hole, and taken when it does not", async () => {
    const { FlowNotPublishable, addAudience, addRule, addStep, publishRequestType } = await import(
      "@/features/requests/service"
    );
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addAudience({
      code,
      stepName: "Submitted",
      principalType: "Person",
      principalId: ownerId,
      access: "CanAct",
      sequence: null,
    });
    // A step somebody waits on with nowhere to go strands whatever reaches it.
    await expect(publishRequestType({ code })).rejects.toBeInstanceOf(
      FlowNotPublishable,
    );

    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });

    const { rows } = await testPool().query<{ status: string }>(
      `select v.status from work.request_type_version v
       join work.request_type rt on rt.id = v.request_type_id where rt.code = $1`,
      [code],
    );
    expect(rows[0].status).toBe("Published");
  });

  it("UC-30.2-05 UC-30.4-01 a second publish is judged on the draft being published, not on the live version", async () => {
    const { FlowNotPublishable, addAudience, addRule, addStep, publishRequestType } = await import(
      "@/features/requests/service"
    );
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });

    // The draft the designer edits now is a copy of what is live. A step somebody waits on
    // with nowhere to go is the same hole as before, and the live version being sound says
    // nothing about it.
    await addStep({ code, nameEn: "On hold", nameAr: "معلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "On hold", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Hold", toStepName: "On hold" });

    await expect(publishRequestType({ code })).rejects.toBeInstanceOf(
      FlowNotPublishable,
    );

    // And the live version is still the one it was: a refused publish promotes nothing.
    const { rows: live } = await testPool().query<{ published: number }>(
      `select count(*)::int as published from work.request_type_version v
       join work.request_type rt on rt.id = v.request_type_id
       where rt.code = $1 and v.status = 'Published'`,
      [code],
    );
    expect(live[0].published).toBe(1);
  });

  it("UC-29.2-01 UC-29.2-07 UC-29.2-08 an action routes the request, and the requester may not approve their own", async () => {
    const { RequestRejected, actionsFor, addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({
      code,
      stepName: "Submitted",
      principalType: "Requester",
      principalId: null,
      access: "CanAct",
      sequence: null,
    });
    await addAudience({
      code,
      stepName: "Submitted",
      principalType: "Person",
      principalId: otherId,
      access: "CanAct",
      sequence: null,
    });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A request for the tests",
      titleAr: "طلب للاختبارات",
      entryMode: "Form",
      attributes: {},
    });

    // `UC-29.2-07`: the requester raised it, so an approval of their own is not offered.
    expect((await actionsFor(key)).actions).not.toContain("Approve");
    await expect(takeStepAction({ key, action: "Approve" })).rejects.toBeInstanceOf(RequestRejected);

    // Somebody else on the step may, and the request follows the rule.
    signedInAs = otherId;
    const outcome = await takeStepAction({ key, action: "Approve" });
    expect(outcome.toStepName).toBe("Closed");
    expect(outcome.noMatchingRoute).toBe(false);

    // `UC-29.2-08`: at a terminal step the request offers nothing more.
    expect((await actionsFor(key)).actions).toEqual([]);

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("D240 D247 a request emails its requester a receipt, each move somebody else makes, and its finish", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } = await import("@/features/requests/service");
    const { saveMailSettings, saveMailTemplate } = await import("@/features/governance/service");
    const { DEFAULT_MAIL_SETTINGS } = await import("@/db/queries/mail");
    signedInAs = ownerId;
    const before = (await testPool().query<{ n: number }>("select coalesce(max(version_number), 0) as n from gov.settings_version")).rows[0].n;
    await saveMailSettings({ ...DEFAULT_MAIL_SETTINGS, enabled: true, host: "smtp.test", port: 25, security: "none", fromAddress: "platform@tahseel.test" });
    const code = await makeType();
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    for (const stepName of ["Submitted", "Review"]) {
      await addAudience({ code, stepName, principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    }
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Approve", toStepName: "Review" });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const raise = () => createRequest({ projectKey: project.rows[0].key, requestTypeCode: code, titleEn: "A request for the tests", titleAr: "طلب للاختبارات", entryMode: "Form", attributes: {} });
    const notices = async (key: string) =>
      (
        await testPool().query<{ person_id: string; status: string; outcome: string; kind: string }>(
          "select n.person_id, n.status, n.outcome, n.kind from gov.mail_notification n join work.request r on r.id = n.subject_id where r.key = $1 order by n.created_at",
          [key],
        )
      ).rows;
    const keys: string[] = [];
    try {
      const key = await raise();
      keys.push(key);
      signedInAs = otherId;
      await takeStepAction({ key, action: "Approve" });
      await takeStepAction({ key, action: "Approve" });
      expect((await notices(key)).map((notice) => [notice.kind, notice.person_id, notice.status])).toEqual([
        ["RequestCreated", ownerId, "Queued"],
        ["RequestUpdated", ownerId, "Queued"],
        ["RequestFinished", ownerId, "Queued"],
      ]);

      // A template switched off writes nothing at all.
      signedInAs = ownerId;
      await saveMailTemplate({ kind: "requestCreated", template: { ...DEFAULT_MAIL_SETTINGS.templates.requestCreated, enabled: false } });
      const quiet = await raise();
      keys.push(quiet);
      expect(await notices(quiet)).toEqual([]);
    } finally {
      await testPool().query("delete from gov.mail_notification where subject_id in (select id from work.request where key = any($1))", [keys]);
      await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = any($1))", [keys]);
      await testPool().query("delete from work.request where key = any($1)", [keys]);
      await testPool().query("delete from gov.settings_version where version_number > $1", [before]);
    }
  });

  it("UC-29.2-08 a step terminal-as-Rejected leaves the request Rejected, not indistinguishable from Completed", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, setStepTerminal, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Declined", nameAr: "مرفوض", slaValue: null, slaUnit: null });
    await addAudience({
      code,
      stepName: "Submitted",
      principalType: "Person",
      principalId: otherId,
      access: "CanAct",
      sequence: null,
    });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Reject", toStepName: "Declined" });
    await setStepTerminal({ code, stepName: "Declined", terminal: true, outcome: "Rejected" });
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A request to be rejected",
      titleAr: "طلب سيُرفض",
      entryMode: "Form",
      attributes: {},
    });

    signedInAs = otherId;
    const outcome = await takeStepAction({ key, action: "Reject" });
    expect(outcome.toStepName).toBe("Declined");
    expect(outcome.status).toBe("Rejected");

    const stored = await testPool().query<{ status: string }>("select status from work.request where key = $1", [key]);
    expect(stored.rows[0].status).toBe("Rejected");

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("UC-29.2-06 D190 an audience member who may only read requests is told so, and nobody is offered a step with nothing to do", async () => {
    const { actionsFor, addAudience, addRule, addStep, createRequest, publishRequestType } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    // Fatima's role reads requests and does not write them; the owner raises the request.
    const fatima = await testPool().query<{ id: string }>("select id from core.person where email = 'fatima@tahseel.ae'");
    for (const principalId of [fatima.rows[0].id, ownerId]) {
      await addAudience({ code, stepName: "Review", principalType: "Person", principalId, access: "CanAct", sequence: null });
    }
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A request a reader cannot act on",
      titleAr: "طلب لا يستطيع القارئ التصرف فيه",
      entryMode: "Form",
      attributes: {},
    });

    signedInAs = fatima.rows[0].id;
    const reader = await actionsFor(key);
    expect(reader).toMatchObject({
      actions: [],
      reason: "You can read this request but not act on it.",
      reasonAr: "يمكنك قراءة هذا الطلب دون التصرف فيه.",
    });
    expect(reader.claim.mayTake).toBe(false);

    // D217: the step names the requester, so they may approve their own request and take it.
    signedInAs = ownerId;
    const requester = await actionsFor(key);
    expect(requester.actions).toEqual(["Approve"]);
    expect(requester.claim.mayTake).toBe(true);
  });

  it("D218 a decision carries its note and files into the history, and every step can reject", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, rejectRequest, takeStepAction } =
      await import("@/features/requests/service");
    const { attachFile } = await import("@/features/files/upload-service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Check", nameAr: "تدقيق", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    for (const stepName of ["Review", "Check"]) {
      await addAudience({ code, stepName, principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    }
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Check" });
    await addRule({ code, stepName: "Check", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "Approved with its evidence, then rejected",
      titleAr: "اعتمد بدليله ثم رُفض",
      entryMode: "Form",
      attributes: {},
    });
    await attachFile({ ownerType: "Request", ownerKey: key, name: "evidence.txt", dataUrl: "data:text/plain;base64,ZXZpZGVuY2U=" });
    const history = async () =>
      (
        await testPool().query<{ detail: string }>(
          `select e.detail_en as detail from work.request_event e join work.request r on r.id = e.request_id
           where r.key = $1 and e.event_type = 'ActionTaken' order by e.at`,
          [key],
        )
      ).rows.map((row) => row.detail);

    // A file that is not on the request is refused, and nothing moves.
    await expect(takeStepAction({ key, action: "Approve", comment: "Checked.", attachments: ["nowhere.pdf"] })).rejects.toThrow(
      "nowhere.pdf is not attached to this request.",
    );
    await takeStepAction({ key, action: "Approve", comment: "Checked.", attachments: ["evidence.txt"] });
    // "Check" has no rejecting route of its own; the built-in Reject ends it, and why is required.
    await expect(rejectRequest(key, " ")).rejects.toThrow("Say why it is rejected.");
    await rejectRequest(key, "Duplicates REQ-1.", ["evidence.txt"]);

    expect(await history()).toEqual([
      "Approve: Checked. · Attachments: evidence.txt",
      "Rejected: Duplicates REQ-1. · Attachments: evidence.txt",
    ]);
    const after = await testPool().query<{ status: string; step: string | null }>(
      "select status, current_step_id::text as step from work.request where key = $1",
      [key],
    );
    expect(after.rows[0]).toEqual({ status: "Rejected", step: null });

    await testPool().query("delete from work.attachment where owner_type = 'Request' and owner_id = (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("D218 a sub request hangs off a request the person may see", async () => {
    const { addAudience, addRule, addStep, createRequest, loadRequestDetail, publishRequestType } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const raise = (titleEn: string, parentKey?: string) =>
      createRequest({ projectKey: project.rows[0].key, requestTypeCode: code, titleEn, titleAr: titleEn, entryMode: "Form", attributes: {}, parentKey });

    const parent = await raise("The whole change");
    const child = await raise("One part of it", parent);
    await expect(raise("A part of nothing", "REQ-NOPE")).rejects.toThrow("There is no request REQ-NOPE you may see.");

    expect((await loadRequestDetail(parent))?.subRequests).toEqual([expect.objectContaining({ k: child, t: "One part of it" })]);

    for (const key of [child, parent]) {
      await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
      await testPool().query("delete from work.request where key = $1", [key]);
    }
  });

  it("D217 a requester approves their own request only where the step names them", async () => {
    const { actionsFor, addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const role = await testPool().query<{ id: string }>(
      "select ra.role_id as id from core.role_assignment ra where ra.person_id = $1 limit 1",
      [ownerId],
    );
    const raise = async (principalType: "Person" | "Role", principalId: string) => {
      const code = await makeType();
      await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
      await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
      await addAudience({ code, stepName: "Review", principalType, principalId, access: "CanAct", sequence: null });
      await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
      await publishRequestType({ code });
      return createRequest({
        projectKey: project.rows[0].key,
        requestTypeCode: code,
        titleEn: `Own approval through a ${principalType} audience`,
        titleAr: "اعتماد الطلب الخاص",
        entryMode: "Form",
        attributes: {},
      });
    };

    // Reached only through a role they hold: separation of duties still refuses it.
    const byRole = await raise("Role", role.rows[0].id);
    expect((await actionsFor(byRole)).reason).toBe("You cannot approve your own request.");
    await expect(takeStepAction({ key: byRole, action: "Approve" })).rejects.toThrow("You cannot approve your own request.");

    // Named on the step: the approval is theirs to give.
    const named = await raise("Person", ownerId);
    expect((await takeStepAction({ key: named, action: "Approve" })).status).toBe("Completed");

    for (const key of [byRole, named]) {
      await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
      await testPool().query("delete from work.request where key = $1", [key]);
    }
  });

  it("D217 an open request answers to the audiences of its type's newest published version", async () => {
    const { actionsFor, addAudience, addRule, addStep, createRequest, loadRequests, publishRequestType } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "Raised before its approver was added",
      titleAr: "رُفع قبل إضافة معتمده",
      entryMode: "Form",
      attributes: {},
    });

    signedInAs = otherId;
    expect((await actionsFor(key)).reason).toBe("You are not an audience of this step.");

    // The next version names another approver; the request raised on the first one follows it.
    signedInAs = ownerId;
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await publishRequestType({ code });
    signedInAs = otherId;
    expect((await actionsFor(key)).actions).toEqual(["Approve"]);
    expect((await loadRequests({ key })).total).toBe(1);

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("UC-29.2-06 UC-29.2-09 a view-only audience cannot act, and an unroutable action says so", async () => {
    const { actionsFor, addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({
      code,
      stepName: "Submitted",
      principalType: "Person",
      principalId: ownerId,
      access: "CanAct",
      sequence: null,
    });
    await addAudience({
      code,
      stepName: "Submitted",
      principalType: "Person",
      principalId: otherId,
      access: "ViewOnly",
      sequence: null,
    });
    // The only rule is a condition nothing in this request satisfies.
    await addRule({
      code,
      stepName: "Submitted",
      kind: "Condition",
      expression: "amount_aed >= 5000",
      actionName: null,
      toStepName: "Closed",
    });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "Another request for the tests",
      titleAr: "طلب آخر للاختبارات",
      entryMode: "Form",
      attributes: {},
    });

    // `UC-29.2-06`: a view-only audience reads it and is told why it has no actions.
    signedInAs = otherId;
    const offered = await actionsFor(key);
    expect(offered.actions).toEqual([]);
    expect(offered.reason).toMatch(/not act|read/i);

    // `UC-29.2-09`: an action nothing routes leaves the request where it is, and says so.
    signedInAs = ownerId;
    const outcome = await takeStepAction({ key, action: "Escalate" });
    expect(outcome.noMatchingRoute).toBe(true);
    const { rows } = await testPool().query<{ detail: string }>(
      `select e.detail_en as detail from work.request_event e
       join work.request r on r.id = e.request_id where r.key = $1 order by e.at desc limit 1`,
      [key],
    );
    expect(rows[0].detail).toMatch(/No matching route/i);

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("UC-29.2-02 UC-29.2-03 Request changes returns it, and an agent can be put on the step", async () => {
    const { addAudience, addRule, addStep, assignToAgent, createRequest, requestChanges, publishRequestType } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    for (const step of ["Submitted", "Review"]) {
      await addAudience({ code, stepName: step, principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    }
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Send", toStepName: "Review" });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A third request for the tests",
      titleAr: "طلب ثالث للاختبارات",
      entryMode: "Form",
      attributes: {},
    });

    // `UC-29.2-03`: an agent works the current step as a run.
    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
    const agent = await testPool().query<{ code: string }>(
      `select code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
       order by code limit 1`,
    );
    const assigned = await assignToAgent({ key, agentCode: agent.rows[0].code });
    expect(assigned.started).toBe(true);

    // `UC-29.2-02`: back to the first step, which is where its requester is.
    const returned = await requestChanges(key, "Please attach the receipt.");
    expect(returned.toStepName).toBe("Submitted");
    const { rows } = await testPool().query<{ status: string; detail: string }>(
      `select r.status, (select e.detail_en from work.request_event e where e.request_id = r.id order by e.at desc limit 1) as detail
       from work.request r where r.key = $1`,
      [key],
    );
    expect(rows[0].status).toBe("Submitted");
    expect(rows[0].detail).toMatch(/receipt/i);

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("UC-29.2-03 a step whose audience names an agent runs it the moment a request reaches it", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Agent review", nameAr: "مراجعة الوكيل", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    const agent = await testPool().query<{ id: string; code: string }>(
      `select id, code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
       order by code limit 1`,
    );
    await addAudience({ code, stepName: "Agent review", principalType: "Agent", principalId: agent.rows[0].id, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Send", toStepName: "Agent review" });
    await addRule({ code, stepName: "Agent review", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A request its agent-review step should pick up",
      titleAr: "طلب ينبغي أن تلتقطه خطوة مراجعة الوكيل",
      entryMode: "Form",
      attributes: {},
    });

    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
    // Nobody calls `assignToAgent`: the step's own configured audience is what starts it.
    const outcome = await takeStepAction({ key, action: "Send" });
    expect(outcome.toStepName).toBe("Agent review");

    const { rows } = await testPool().query<{ count: string }>(
      `select count(*) from ai.run r join work.request q on q.id = r.context_id
       where q.key = $1 and r.context_type = 'Request' and r.agent_id = $2`,
      [key, agent.rows[0].id],
    );
    expect(Number(rows[0].count)).toBe(1);
    const { rows: events } = await testPool().query<{ detail: string }>(
      `select detail_en as detail from work.request_event e
       join work.request r on r.id = e.request_id where r.key = $1 order by e.at desc limit 1`,
      [key],
    );
    expect(events[0].detail).toMatch(new RegExp(`Assigned to ${agent.rows[0].code}`, "i"));

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("D41 D115 a step mission is started with its step contract as the output schema", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Agent review", nameAr: "مراجعة الوكيل", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    const agent = await testPool().query<{ id: string; code: string }>(
      `select id, code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
       order by code limit 1`,
    );
    await addAudience({ code, stepName: "Agent review", principalType: "Agent", principalId: agent.rows[0].id, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Send", toStepName: "Agent review" });
    await addRule({ code, stepName: "Agent review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });
    await addRule({ code, stepName: "Agent review", kind: "Action", expression: null, actionName: "Reject", toStepName: "Closed" });
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const started: { description: string; schema: unknown }[] = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { task: { description: string; output_schema: unknown } };
      started.push({ description: body.task.description, schema: body.task.output_schema });
      return { ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" } as Response;
    }) as typeof fetch;

    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A step mission held to its step contract",
      titleAr: "مهمة خطوة ملزمة بعقد خطوتها",
      entryMode: "Form",
      attributes: {},
    });
    await takeStepAction({ key, action: "Send" });

    // The schema the agent service checks the output against, not only words in the prompt,
    // and the prompt names the tool that really takes the action.
    const mission = started.at(-1);
    expect(mission?.schema).toMatchObject({
      required: ["action"],
      properties: { action: { enum: ["Approve", "Reject", "Return"] } },
    });
    expect(mission?.description).toContain("request_step_action_create");
    // D215: Return and the duplicate check have tools of their own.
    expect(mission?.description).toContain("request_change_request_create");
    expect(mission?.description).toContain("request_list");

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("D215 an agent finds a request with request_list and returns it with request_change_request_create", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    const { REQUEST_TOOLS } = await import("@/features/requests/tools");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    for (const stepName of ["Submitted", "Review"]) {
      await addAudience({ code, stepName, principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    }
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Send", toStepName: "Review" });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "Returned for its missing merchant id",
      titleAr: "أُعيد لنقص رقم التاجر",
      entryMode: "Form",
      attributes: {},
    });
    await takeStepAction({ key, action: "Send" });
    const tool = (name: string) => REQUEST_TOOLS.find((one) => one.name === name)!.run as (input: unknown) => Promise<unknown>;

    // D349: the list is searched and paged on the server, and says how many match.
    const listed = (await tool("request_list")({ query: "missing merchant", limit: 50, offset: 0 })) as { total: number; requests: { key: string; title: string }[] };
    expect(listed.requests).toContainEqual(expect.objectContaining({ key, title: "Returned for its missing merchant id" }));
    expect(listed.total).toBe(listed.requests.length);

    await expect(tool("request_change_request_create")({ key, comment: "" })).rejects.toThrow();
    await tool("request_change_request_create")({ key, comment: "Add the merchant id." });

    const after = await testPool().query<{ step: string; status: string }>(
      `select ts.name_en as step, r.status from work.request r join work.transition_step ts on ts.id = r.current_step_id where r.key = $1`,
      [key],
    );
    expect(after.rows[0]).toEqual({ step: "Submitted", status: "Submitted" });
    const returned = await testPool().query<{ detail: string }>(
      `select e.detail_en as detail from work.request_event e join work.request r on r.id = e.request_id
       where r.key = $1 and e.event_type = 'Returned'`,
      [key],
    );
    expect(returned.rows.map((row) => row.detail)).toEqual(["Returned: Add the merchant id."]);

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("an agent audience acts on its own step from a run about that request, and nowhere else", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    const code = await makeType();
    const agent = (
      await testPool().query<{ id: string; code: string }>(
        `select id, code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
         order by code limit 1`,
      )
    ).rows[0];

    // The requester sends it on; only the agent acts on "Agent review"; on "Second look" the
    // agent may only watch.
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Agent review", nameAr: "مراجعة الوكيل", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Second look", nameAr: "نظرة ثانية", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Requester", principalId: null, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Agent review", principalType: "Agent", principalId: agent.id, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Second look", principalType: "Agent", principalId: agent.id, access: "ViewOnly", sequence: null });
    await addAudience({ code, stepName: "Second look", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Send", toStepName: "Agent review" });
    await addRule({ code, stepName: "Agent review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });
    await addRule({ code, stepName: "Agent review", kind: "Action", expression: null, actionName: "Close", toStepName: "Second look" });
    await addRule({ code, stepName: "Second look", kind: "Action", expression: null, actionName: "Finish", toStepName: "Closed" });
    await publishRequestType({ code });

    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const raise = async (title: string) => {
      const key = await createRequest({
        projectKey: project.rows[0].key,
        requestTypeCode: code,
        titleEn: title,
        titleAr: title,
        entryMode: "Form",
        attributes: {},
      });
      // Reaching "Agent review" starts the agent's run, for the requester.
      await takeStepAction({ key, action: "Send" });
      return key;
    };
    const first = await raise("The first request the agent works");
    const second = await raise("The second request the agent works");
    const runOf = async (key: string) =>
      (
        await testPool().query<{ id: string }>(
          `select r.id from ai.run r join work.request q on q.id = r.context_id
           where q.key = $1 and r.context_type = 'Request' and r.agent_id = $2`,
          [key, agent.id],
        )
      ).rows[0].id;
    const firstRun = await runOf(first);
    const secondRun = await runOf(second);
    const asAgent = <T,>(runId: string | undefined, body: () => Promise<T>) =>
      runAs(ownerId, { id: agent.id, label: "request_step_action_create", runId }, body);

    // A run about another request does not carry the agent's audience here, and neither does
    // a call with no run at all, which is how an integration client arrives.
    await expect(asAgent(secondRun, () => takeStepAction({ key: first, action: "Close" }))).rejects.toThrow(/not an audience/);
    await expect(asAgent(undefined, () => takeStepAction({ key: first, action: "Close" }))).rejects.toThrow(/not an audience/);

    // The person behind the run raised the request, so the agent may not approve it for them
    // unaided: it is told a person has to agree first (D141).
    await expect(asAgent(secondRun, () => takeStepAction({ key: second, action: "Approve" }))).rejects.toThrow(/needs a person's approval/);
    // A person in the console approving their own request is refused outright.
    await expect(takeStepAction({ key: second, action: "Approve" })).rejects.toThrow(/approve your own/);

    // From its own run the agent acts on its own step, and the history names the agent.
    expect((await asAgent(firstRun, () => takeStepAction({ key: first, action: "Close" }))).toStepName).toBe("Second look");
    const { rows: events } = await testPool().query<{ actor_type: string; actor_id: string; detail: string }>(
      `select e.actor_type, e.actor_id, e.detail_en as detail from work.request_event e
       join work.request r on r.id = e.request_id where r.key = $1 and e.event_type = 'ActionTaken'
       order by e.at desc limit 1`,
      [first],
    );
    expect(events[0]).toEqual({ actor_type: "Agent", actor_id: agent.id, detail: "Close" });

    // On a step where it only watches, the same run may not act.
    await expect(asAgent(firstRun, () => takeStepAction({ key: first, action: "Finish" }))).rejects.toThrow(/read this request but not act/);

    // A run that has finished keeps no authority, whatever its token says.
    await testPool().query("update ai.run set status = 'Succeeded' where id = $1", [secondRun]);
    await expect(asAgent(secondRun, () => takeStepAction({ key: second, action: "Close" }))).rejects.toThrow(/not an audience/);
  });

  it("D141 an agent approving its requester's own request waits for somebody else's bound approval", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType } = await import("@/features/requests/service");
    const { requestApproval } = await import("@/features/agents/run-service");
    const { decideApproval } = await import("@/features/inbox/service");
    const { mintRunToken } = await import("@/lib/run-token");
    const { handleMcpRequest } = await import("@/mcp/server");
    signedInAs = ownerId;
    const code = await makeType();
    const agent = (
      await testPool().query<{ id: string }>(
        `select id from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
         order by code limit 1`,
      )
    ).rows[0];

    // The agent is the first step's audience, so raising the request starts its run.
    await addStep({ code, nameEn: "Agent review", nameAr: "مراجعة الوكيل", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Agent review", principalType: "Agent", principalId: agent.id, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Agent review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });
    await publishRequestType({ code });
    globalThis.fetch = (async () =>
      ({ ok: true, status: 200, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "Approved by somebody other than its requester",
      titleAr: "يعتمده غير مقدمه",
      entryMode: "Form",
      attributes: {},
    });
    const runId = (
      await testPool().query<{ id: string }>(
        `select r.id from ai.run r join work.request q on q.id = r.context_id
         where q.key = $1 and r.context_type = 'Request' and r.agent_id = $2`,
        [key, agent.id],
      )
    ).rows[0].id;
    const token = await mintRunToken({
      kind: "model",
      runId,
      agentId: agent.id,
      personId: ownerId,
      routes: [],
      connectors: [],
      tools: ["request_step_action_create"],
    });
    const call = async (args: Record<string, unknown>) =>
      (await (
        await handleMcpRequest(
          new Request("http://web.awp-app.svc:3000/api/mcp", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "request_step_action_create", arguments: args } }),
          }),
        )
      ).json()) as { result?: { structuredContent?: Record<string, unknown> }; error?: { message: string; data?: Record<string, unknown> } };
    const approve = { key, action: "Approve" };

    // Refused with the descriptor the harness pauses on, and nothing moved.
    const refused = await call(approve);
    expect(refused.error?.data).toMatchObject({ reasonCode: "approval_required", tool: "request_step_action_create", fields: ["action"] });
    const stepOf = async () =>
      (
        await testPool().query<{ name: string | null }>(
          `select ts.name_en as name from work.request r left join work.transition_step ts on ts.id = r.current_step_id where r.key = $1`,
          [key],
        )
      ).rows[0].name;
    expect(await stepOf()).toBe("Agent review");

    // The harness turns the refusal into a bound approval; it is never routed to the requester.
    const approval = await requestApproval({
      run_id: runId,
      tool_name: "request_step_action_create",
      call_id: `call-${runId}`,
      arguments: approve,
      tier: "T1",
      reason: "The requester cannot approve their own request.",
      context_type: "Request",
      context_id: "",
    });
    const inbox = await testPool().query<{ id: string; person_id: string }>(
      "select id, person_id from ai.inbox_item where source_type = 'Approval' and source_id = $1 order by person_id",
      [approval.id],
    );
    expect(inbox.rowCount).toBeGreaterThan(0);
    expect(inbox.rows.map((row) => row.person_id)).not.toContain(ownerId);

    // An undecided approval does not move the request.
    expect((await call({ ...approve, __approval: approval.id })).error?.message).toMatch(/not been decided/);

    signedInAs = inbox.rows[0].person_id;
    await decideApproval({ inboxItemId: inbox.rows[0].id, decision: "Approved" });
    signedInAs = ownerId;

    // The approved retry moves the request, and its history names the approval.
    const moved = await call({ ...approve, __approval: approval.id });
    expect(moved.error).toBeUndefined();
    expect(moved.result?.structuredContent).toMatchObject({ toStepName: "Closed" });
    const { rows: events } = await testPool().query<{ detail: string }>(
      `select e.detail_en as detail from work.request_event e join work.request r on r.id = e.request_id
       where r.key = $1 and e.event_type = 'ActionTaken' order by e.at desc limit 1`,
      [key],
    );
    expect(events[0].detail).toBe(`Approve (${approval.key})`);

    // Spent once.
    expect((await call({ ...approve, __approval: approval.id })).error?.message).toMatch(/already been used|closed/);

    await testPool().query("delete from ai.inbox_item where source_type = 'Approval' and source_id = $1", [approval.id]);
  });

  it("a request's agent run that stops short says so in the request's history, and the request stays", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    const { finishRun } = await import("@/features/agents/run-service");
    signedInAs = ownerId;
    const code = await makeType();
    const agent = (
      await testPool().query<{ id: string; code: string }>(
        `select id, code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
         order by code limit 1`,
      )
    ).rows[0];
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Agent review", nameAr: "مراجعة الوكيل", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Agent review", principalType: "Agent", principalId: agent.id, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Send", toStepName: "Agent review" });
    await addRule({ code, stepName: "Agent review", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });

    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A request whose agent fails",
      titleAr: "طلب يفشل وكيله",
      entryMode: "Form",
      attributes: {},
    });
    await takeStepAction({ key, action: "Send" });
    const run = (
      await testPool().query<{ id: string; key: string }>(
        `select r.id, r.key from ai.run r join work.request q on q.id = r.context_id
         where q.key = $1 and r.context_type = 'Request'`,
        [key],
      )
    ).rows[0];

    await finishRun({
      run_id: run.id,
      status: "Failed",
      output: "the output does not match its schema",
      // `finalize` always sends one, and a request is a context a handoff belongs to.
      handoff: { goal: "Close the request", decisions: [], open_questions: [], next_step: "Retry the step" },
      tokens_in: 0,
      tokens_out: 0,
      tool_call_count: 0,
      estimated_cost_aed: 0,
      eval_scores: {},
      steps: [],
    });
    const handoff = await testPool().query<{ next_step: string }>(
      `select h.next_step from work.context_handoff h join work.request r on r.id = h.owner_id
       where h.owner_type = 'Request' and r.key = $1`,
      [key],
    );
    expect(handoff.rows[0]?.next_step).toBe("Retry the step");

    const { rows } = await testPool().query<{ actor_type: string; actor_id: string; detail: string; step: string }>(
      `select e.actor_type, e.actor_id, e.detail_en as detail, ts.name_en as step
       from work.request_event e join work.request r on r.id = e.request_id
       left join work.transition_step ts on ts.id = r.current_step_id
       where r.key = $1 order by e.at desc limit 1`,
      [key],
    );
    expect(rows[0]).toMatchObject({ actor_type: "Agent", actor_id: agent.id, step: "Agent review" });
    expect(rows[0].detail).toContain(`${agent.code} stopped without finishing: the run failed (run ${run.key})`);
    // What the run produced is not copied into a history other people read.
    expect(rows[0].detail).not.toContain("schema");
  });

  it("D136 a run whose request was deleted while it ran still finishes, with nothing written to a history that is gone", async () => {
    const { finishRun } = await import("@/features/agents/run-service");
    const repository = await import("@/features/agents/repository");
    signedInAs = ownerId;
    const agent = (
      await testPool().query<{ id: string; versionId: string }>(
        `select id, active_version_id as "versionId" from ai.agent where active_version_id is not null order by code limit 1`,
      )
    ).rows[0];
    const runId = crypto.randomUUID();
    const deletedRequestId = crypto.randomUUID();
    await repository.openRun({
      id: runId,
      agentId: agent.id,
      agentVersionId: agent.versionId,
      trigger: "Manual",
      contextType: "Request",
      contextId: deletedRequestId,
      temporalWorkflowId: null,
      replayOfRunId: null,
      replayFromStep: null,
      grantedTools: [],
      personId: ownerId,
    });

    try {
      await expect(
        finishRun({
          run_id: runId,
          status: "Failed",
          output: "",
          tokens_in: 0,
          tokens_out: 0,
          tool_call_count: 0,
          estimated_cost_aed: 0,
          eval_scores: {},
          steps: [],
        }),
      ).resolves.toMatchObject({ run: expect.stringMatching(/^RUN-/) });

      const run = await testPool().query<{ status: string }>("select status from ai.run where id = $1", [runId]);
      expect(run.rows[0].status).toBe("Failed");
      const events = await testPool().query("select 1 from work.request_event where request_id = $1", [deletedRequestId]);
      expect(events.rowCount).toBe(0);
    } finally {
      // A failed run is the agent's last failure for every other suite reading it.
      await testPool().query("delete from ai.run_step where run_id = $1", [runId]);
      await testPool().query("delete from ai.run where id = $1", [runId]);
    }
  });

  it("every way of raising a request starts its first step's agent, or says why it could not", async () => {
    const { addAudience, addRule, addStep, createFromIntakeWidget, createFromSchedule, publishRequestType, saveDraft } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    const agent = (
      await testPool().query<{ id: string; code: string }>(
        `select id, code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
         order by code limit 1`,
      )
    ).rows[0];
    const project = await testPool().query<{ id: string; key: string }>("select id, key from work.project order by key limit 1");
    await saveDraft({
      code,
      categoryEn: "Finance",
      decomposition: "None",
      slaValue: 30,
      slaUnit: "Minutes",
      defaultProjectKey: project.rows[0].key,
      intakeChannels: ["Console", "Widget"],
      entryModes: ["TemplateForm"],
    });
    await addStep({ code, nameEn: "Triage", nameAr: "فرز", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Triage", principalType: "Agent", principalId: agent.id, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Triage", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });

    globalThis.fetch = (async () =>
      ({ ok: true, json: async () => ({ run_id: "r-1" }), text: async () => "" }) as Response) as typeof fetch;

    // A schedule firing raises it as the firing's owner, whom the agent then works for.
    const typeId = (await testPool().query<{ id: string }>("select id from work.request_type where code = $1", [code])).rows[0].id;
    const scheduled = await createFromSchedule({
      requestTypeId: typeId,
      projectId: project.rows[0].id,
      titleEn: "A scheduled request",
      titleAr: "طلب مجدول",
      descriptionEn: null,
    });
    const runs = await testPool().query<{ count: string }>(
      "select count(*) from ai.run where context_type = 'Request' and context_id = $1 and agent_id = $2",
      [scheduled.id, agent.id],
    );
    expect(Number(runs.rows[0].count)).toBe(1);

    // An external contact is not a person a run can act for: no run, and the history says so.
    const widget = await createFromIntakeWidget({
      requestTypeCode: code,
      contactName: "Someone Outside",
      contactEmail: "someone@outside.example",
      summary: "Nobody inside raised this one.",
      attributes: {},
    });
    const { rows } = await testPool().query<{ actor_type: string; detail: string; detail_ar: string; runs: string }>(
      `select e.actor_type, e.detail_en as detail, e.detail_ar,
              (select count(*) from ai.run where context_type = 'Request' and context_id = r.id) as runs
       from work.request_event e join work.request r on r.id = e.request_id
       where r.key = $1 and e.event_type = 'Assigned'`,
      [widget],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_type: "System", runs: "0" });
    expect(rows[0].detail).toContain(`Could not start ${agent.code}`);
    // The Arabic history line is Arabic throughout, reason included.
    expect(rows[0].detail_ar).toBe(`تعذّر تشغيل ${agent.code}: لا أحد وراء هذا الطلب ليعمل الوكيل نيابةً عنه`);
  });

  it("UC-29.2-03 a run that cannot start is recorded with its reason in each language", async () => {
    const { addAudience, addRule, addStep, assignToAgent, createRequest, publishRequestType } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A request whose agent cannot start",
      titleAr: "طلب لا يمكن تشغيل وكيله",
      entryMode: "Form",
      attributes: {},
    });
    const agent = await testPool().query<{ code: string }>(
      `select code from ai.agent where is_system = false and status not in ('Paused', 'Error', 'Retired')
       order by code limit 1`,
    );

    // The agent service refuses the run, so `startRun` throws `RunNotStarted`.
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
    const assigned = await assignToAgent({ key, agentCode: agent.rows[0].code });

    expect(assigned).toEqual({ started: false, reason: "The agent service refused the run (500)." });
    const { rows } = await testPool().query<{ detail_en: string; detail_ar: string }>(
      `select e.detail_en, e.detail_ar from work.request_event e join work.request r on r.id = e.request_id
       where r.key = $1 and e.event_type = 'Assigned'`,
      [key],
    );
    expect(rows).toEqual([
      {
        detail_en: `Could not start ${agent.rows[0].code}: The agent service refused the run (500).`,
        detail_ar: `تعذّر تشغيل ${agent.rows[0].code}: رفضت خدمة الوكلاء التشغيل (500).`,
      },
    ]);

    await testPool().query("delete from ai.run where context_type = 'Request' and context_id = (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("UC-29.2-05 a sequential audience acts in order", async () => {
    const { RequestRejected, addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    // The second in the sequence waits for the first.
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: otherId, access: "CanAct", sequence: 1 });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: 2 });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A sequential request for the tests",
      titleAr: "طلب تسلسلي للاختبارات",
      entryMode: "Form",
      attributes: {},
    });

    signedInAs = ownerId;
    await expect(takeStepAction({ key, action: "Close" })).rejects.toBeInstanceOf(RequestRejected);

    signedInAs = otherId;
    expect((await takeStepAction({ key, action: "Close" })).toStepName).toBe("Closed");

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("D147 a person who takes a step holds it until it moves on, and the others wait", async () => {
    const { actionsFor, addAudience, addRule, addStep, createRequest, publishRequestType, releaseStep, takeStep, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "A step one person takes",
      titleAr: "خطوة يتولاها شخص",
      entryMode: "Form",
      attributes: {},
    });
    const row = async () =>
      (await testPool().query<{ status: string; claimed_by: string | null }>("select status, claimed_by from work.request where key = $1", [key])).rows[0];

    signedInAs = otherId;
    expect((await actionsFor(key)).claim).toMatchObject({ mayTake: true, mine: false });
    await takeStep(key);
    expect(await row()).toEqual({ status: "InProgress", claimed_by: otherId });
    expect((await actionsFor(key)).claim).toMatchObject({ mine: true, mayTake: false });

    // Everybody else waits, and is told who has it.
    signedInAs = ownerId;
    const waiting = await actionsFor(key);
    expect(waiting.actions).toEqual([]);
    expect(waiting.reason).toMatch(/has taken this step/);
    await expect(takeStepAction({ key, action: "Close" })).rejects.toThrow(/has taken this step/);
    await expect(takeStep(key)).rejects.toThrow(/has taken this step/);
    await expect(releaseStep(key)).rejects.toThrow(/not taken this step/);

    // Released, anyone may act again; taken and acted on, the request moves and the claim goes.
    signedInAs = otherId;
    await releaseStep(key);
    expect(await row()).toEqual({ status: "Submitted", claimed_by: null });
    await takeStep(key);
    expect((await takeStepAction({ key, action: "Close" })).toStepName).toBe("Closed");
    expect((await row()).claimed_by).toBeNull();
  });

  it("UC-27.1-05 D166 D203 a request outside a person's projects is listed to an audience of its step and to who acted on one", async () => {
    const { actionsFor, addAudience, addRule, addStep, createRequest, loadRequests, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Sign-off", nameAr: "اعتماد", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Requester", principalId: null, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Sign-off", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Send", toStepName: "Review" });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Forward", toStepName: "Sign-off" });
    await addRule({ code, stepName: "Sign-off", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });
    // A project the other person may not see, so only the audience rule can list it.
    const hidden = await testPool().query<{ key: string }>(
      `select p.key from work.project p where not exists (
         select 1 from work.project_member m where m.project_id = p.id and m.principal_id = $1)
       order by p.key`,
      [otherId],
    );
    const visibleTo = async (who: string, key: string) => {
      signedInAs = who;
      return (await loadRequests({ key })).total === 1;
    };
    let key = "";
    for (const project of hidden.rows) {
      signedInAs = ownerId;
      const candidate = await createRequest({
        projectKey: project.key,
        requestTypeCode: code,
        titleEn: "Listed to the step's audience",
        titleAr: "يُعرض لجمهور الخطوة",
        entryMode: "Form",
        attributes: {},
      });
      if (!(await visibleTo(otherId, candidate))) {
        key = candidate;
        break;
      }
    }
    expect(key, "a project the other person cannot see").not.toBe("");

    // At Review, where they are the audience, they see it.
    signedInAs = ownerId;
    await takeStepAction({ key, action: "Send" });
    expect(await visibleTo(otherId, key)).toBe(true);
    // Having acted on it, they keep reading it after it moves on, with no actions on the next step.
    signedInAs = otherId;
    await takeStepAction({ key, action: "Forward" });
    expect(await visibleTo(otherId, key)).toBe(true);
    signedInAs = otherId;
    expect((await actionsFor(key)).actions).toEqual([]);
    await expect(takeStepAction({ key, action: "Close" })).rejects.toThrow();
    signedInAs = ownerId;
    await takeStepAction({ key, action: "Close" });
    expect(await visibleTo(otherId, key)).toBe(true);
  });

  it("D159 a request routed to a step with no audience and no rule completes, marked terminal or not", async () => {
    const { addAudience, addRule, addStep, createRequest, publishRequestType, takeStepAction } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    // Never marked terminal: it is one by §7.2.5's definition, as the designer shows it.
    await addStep({ code, nameEn: "Done", nameAr: "تم", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Close", toStepName: "Done" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "Routed to an unmarked terminal step",
      titleAr: "يُوجَّه إلى خطوة نهائية غير معلَّمة",
      entryMode: "Form",
      attributes: {},
    });
    signedInAs = otherId;
    expect(await takeStepAction({ key, action: "Close" })).toMatchObject({ status: "Completed" });
    const row = (await testPool().query<{ status: string }>("select status from work.request where key = $1", [key])).rows[0];
    expect(row.status).toBe("Completed");
  });

  it("UC-29.2-07 a requester whose step offers only an approval is told why nothing is offered", async () => {
    const { actionsFor, addAudience, addRule, addStep, createRequest, publishRequestType } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Requester", principalId: null, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "Only an approval is offered",
      titleAr: "لا يُعرض إلا الاعتماد",
      entryMode: "Form",
      attributes: {},
    });
    expect(await actionsFor(key)).toMatchObject({
      actions: [],
      reason: "You cannot approve your own request.",
      reasonAr: "لا يمكنك اعتماد طلبك.",
    });
  });

  it("UC-29.2-04 one action branches on the request's attributes, and only the audience of the step it reaches may act there", async () => {
    const { RequestRejected, actionsFor, addAttribute, addAudience, addRule, addStep, createRequest, loadRequestDetail, loadRequestTypeDetail, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    const { parseRuleLabel } = await import("@/features/requests/routing");
    signedInAs = ownerId;
    const code = await makeType();
    await addAttribute({ code, key: "amount_aed", labelEn: "Amount", labelAr: "المبلغ", dataType: "Money", required: true, stepName: null });
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Finance", nameAr: "المالية", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Finance", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    // The designer's text, as a person types it.
    await addRule({ code, stepName: "Review", ...parseRuleLabel("Approve if amount_aed >= 5000"), toStepName: "Finance" });
    await addRule({ code, stepName: "Review", ...parseRuleLabel("Approve"), toStepName: "Done" });
    await addRule({ code, stepName: "Review", ...parseRuleLabel("Close"), toStepName: "Done" });
    await addRule({ code, stepName: "Finance", ...parseRuleLabel("Approve"), toStepName: "Done" });
    expect((await loadRequestTypeDetail(code))?.steps[0].out.map(([when]) => when)).toEqual([
      "Approve if amount_aed >= 5000",
      "Approve",
      "Close",
    ]);
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const raise = (amount: string) =>
      createRequest({
        projectKey: project.rows[0].key,
        requestTypeCode: code,
        titleEn: `Claim of ${amount}`,
        titleAr: `مطالبة بقيمة ${amount}`,
        entryMode: "Form",
        attributes: { amount_aed: amount },
      });
    const small = await raise("4999");
    const large = await raise("7500");
    const closed = await raise("9000");

    // At Review, the requester is not its audience.
    expect((await actionsFor(large)).reason).toBe("You are not an audience of this step.");
    await expect(takeStepAction({ key: large, action: "Approve" })).rejects.toBeInstanceOf(RequestRejected);

    signedInAs = otherId;
    expect((await actionsFor(large)).actions).toEqual(expect.arrayContaining(["Approve", "Close"]));
    expect((await takeStepAction({ key: small, action: "Approve" })).toStepName).toBe("Done");
    expect((await takeStepAction({ key: large, action: "Approve" })).toStepName).toBe("Finance");
    // The guard belongs to Approve: another action on a large request follows its own rule.
    expect((await takeStepAction({ key: closed, action: "Close" })).toStepName).toBe("Done");

    // At Finance, Review's audience no longer acts, and Finance's does.
    expect((await loadRequestDetail(large))?.currentStep).toBe(1);
    expect((await actionsFor(large)).reason).toBe("You are not an audience of this step.");
    await expect(takeStepAction({ key: large, action: "Approve" })).rejects.toBeInstanceOf(RequestRejected);
    signedInAs = ownerId;
    expect((await takeStepAction({ key: large, action: "Approve" })).toStepName).toBe("Done");
  });

  it("D302 steps added at once, as an agent's parallel calls add them, all land, each in its own place", async () => {
    const { addStep, loadRequestTypeDetail } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    const names = ["One", "Two", "Three", "Four"];
    await Promise.all(names.map((name) => addStep({ code, nameEn: name, nameAr: name, slaValue: null, slaUnit: null })));
    expect((await loadRequestTypeDetail(code, "draft"))?.steps.map((step) => step.n).sort()).toEqual([...names].sort());
  });

  it("D304 a list's choices are bilingual, and a step's own attribute is asked and required at that step", async () => {
    const { AttributeError, addAttribute, addAudience, addRule, addStep, createRequest, loadRequestDetail, loadRequestTypeDetail, publishRequestType, takeStepAction } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    const choices = [
      { value: "Low", labelEn: "Low", labelAr: "منخفضة" },
      { value: "High", labelEn: "High", labelAr: "عالية" },
    ];
    await addAttribute({ code, key: "urgency", labelEn: "Urgency", labelAr: "الأولوية", dataType: "Enum", required: true, enumValues: choices, stepName: null });
    await addAttribute({ code, key: "verified_aed", labelEn: "Verified amount", labelAr: "المبلغ المعتمد", dataType: "Money", required: true, stepName: "Review" });
    await publishRequestType({ code });

    const detail = await loadRequestTypeDetail(code);
    expect(detail).toMatchObject({ version: 1, status: "Published" });
    expect(detail?.attributes).toEqual([
      expect.objectContaining({ key: "urgency", enumValues: choices, stepName: null }),
      expect.objectContaining({ key: "verified_aed", enumValues: null, stepName: "Review" }),
    ]);

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const raise = (urgency: string) =>
      createRequest({ projectKey: project.rows[0].key, requestTypeCode: code, titleEn: "Laptop", titleAr: "حاسوب", entryMode: "Form", attributes: { urgency } });
    // A list takes only its own choices; the step's attribute is not asked on the form.
    await expect(raise("urgent")).rejects.toBeInstanceOf(AttributeError);
    const key = await raise("High");

    signedInAs = otherId;
    await expect(takeStepAction({ key, action: "Approve" })).rejects.toMatchObject({ field: "verified_aed" });
    await expect(takeStepAction({ key, action: "Approve", attributes: { verified_aed: "a lot" } })).rejects.toBeInstanceOf(AttributeError);
    expect((await loadRequestDetail(key))?.currentStep).toBe(0);
    expect((await takeStepAction({ key, action: "Approve", attributes: { verified_aed: "1850" } })).toStepName).toBe("Done");
    const after = await loadRequestDetail(key);
    expect(after?.attributes).toEqual(expect.arrayContaining([["urgency", "High"], ["verified_aed", "1850"]]));
    // D314 and D315: the history reads latest first, and the action carries the values it supplied.
    expect(after?.history[0]).toMatchObject({ detailEn: "Approve", attributes: [["verified_aed", "1850"]] });
    expect(after?.history.at(-1)?.attributes).toBeNull();
    const times = (after?.history ?? []).map((entry) => entry.at);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("D309 a routing rule is edited in place: its condition, its action and where it goes, keeping its order", async () => {
    const { RequestTypeRejected, addRule, addStep, loadRequestTypeDetail, updateRule } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    for (const name of ["Review", "Finance", "Done"]) await addStep({ code, nameEn: name, nameAr: name, slaValue: null, slaUnit: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Reject", toStepName: "Done" });
    const rulesOf = async () => (await loadRequestTypeDetail(code, "draft"))?.steps.find((step) => step.n === "Review")?.out.map(([when, , to]) => [when, to]);

    await updateRule({ code, stepName: "Review", position: 1, expression: "amount_aed >= 5000", toStepName: "Finance" });
    expect(await rulesOf()).toEqual([["Approve if amount_aed >= 5000", "Finance"], ["Reject", "Done"]]);
    await updateRule({ code, stepName: "Review", position: 2, kind: "Condition", expression: "amount_aed < 10", actionName: null });
    expect(await rulesOf()).toEqual([["Approve if amount_aed >= 5000", "Finance"], ["amount_aed < 10", "Done"]]);

    // A condition with no condition, a step that does not exist and a rule that is not there are refused.
    await expect(updateRule({ code, stepName: "Review", position: 2, expression: null })).rejects.toBeInstanceOf(RequestTypeRejected);
    await expect(updateRule({ code, stepName: "Review", position: 1, toStepName: "Nowhere" })).rejects.toBeInstanceOf(RequestTypeRejected);
    await expect(updateRule({ code, stepName: "Review", position: 3, actionName: "Close" })).rejects.toBeInstanceOf(RequestTypeRejected);
    expect(await rulesOf()).toEqual([["Approve if amount_aed >= 5000", "Finance"], ["amount_aed < 10", "Done"]]);
  });

  it("D316 an attribute moved to a place keeps the others in their order, and a place past the end is the end", async () => {
    const { addAttribute, addStep, loadRequestTypeDetail, updateAttribute } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    for (const [key, stepName] of [["entity", null], ["amount_aed", null], ["verified", "Review"]] as const) {
      await addAttribute({ code, key, labelEn: key, labelAr: key, dataType: "Text", required: false, stepName });
    }
    const order = async () => (await loadRequestTypeDetail(code, "draft"))?.attributes.map((one) => one.key);

    await updateAttribute({ code, key: "verified", position: 1 });
    expect(await order()).toEqual(["verified", "entity", "amount_aed"]);
    await updateAttribute({ code, key: "entity", position: 99 });
    expect(await order()).toEqual(["verified", "amount_aed", "entity"]);
    // A move changes nothing else about the attribute.
    expect((await loadRequestTypeDetail(code, "draft"))?.attributes[0]).toMatchObject({ key: "verified", stepName: "Review" });
  });

  it("D312 a work item raised for a request is listed on it, in its project, and finishing it leaves a request with steps where it is", async () => {
    const { addAudience, addRule, addStep, createRequest, loadRequestDetail, publishRequestType, workFinished } = await import("@/features/requests/service");
    const { createWorkItem } = await import("@/features/work-items/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    await publishRequestType({ code });
    const projects = await testPool().query<{ key: string }>("select key from work.project order by key limit 2");
    const key = await createRequest({ projectKey: projects.rows[0].key, requestTypeCode: code, titleEn: "Server move", titleAr: "نقل الخادم", entryMode: "Form", attributes: {} });

    // The form's project is overridden by the request's.
    const item = await createWorkItem({ projectKey: projects.rows.at(-1)!.key, type: "Task", titleEn: "Back up", titleAr: "نسخ احتياطي", priority: "Medium", requestKey: key });
    const linked = await testPool().query<{ project: string; origin_type: string }>(
      "select p.key as project, wi.origin_type from work.work_item wi join work.project p on p.id = wi.project_id where wi.key = $1",
      [item],
    );
    expect(linked.rows[0]).toEqual({ project: projects.rows[0].key, origin_type: "Request" });
    expect((await loadRequestDetail(key))?.workItems.map((work) => work.k)).toEqual([item]);

    // A type that does not decompose is moved by its steps, not by its work items finishing.
    await testPool().query("update work.work_item set status = 'Done' where key = $1", [item]);
    await workFinished(key);
    expect((await loadRequestDetail(key))?.currentStep).toBe(0);
    expect((await testPool().query<{ status: string }>("select status from work.request where key = $1", [key])).rows[0].status).toBe("Submitted");

    await testPool().query("delete from work.work_item_activity where work_item_id in (select id from work.work_item where key = $1)", [item]);
    await testPool().query("delete from work.work_item where key = $1", [item]);
  });

  it("D304 an attribute is edited in place: labels, a choice's label under its stored value, where it is asked, its type", async () => {
    const { RequestTypeRejected, addAttribute, addAudience, addRule, addStep, loadRequestTypeDetail, publishRequestType, updateAttribute } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    await addAttribute({
      code,
      key: "urgency",
      labelEn: "Urgency",
      labelAr: "Urgency",
      dataType: "Enum",
      required: false,
      enumValues: [{ value: "High", labelEn: "High", labelAr: "High" }],
      stepName: null,
    });
    await publishRequestType({ code });

    // A published type is edited on a new draft; the key and a choice's stored value stay.
    const { before, after } = await updateAttribute({
      code,
      key: "urgency",
      labelAr: "الأولوية",
      required: true,
      enumValues: [
        { value: "High", labelEn: "Urgent", labelAr: "عاجل" },
        { value: "Low", labelEn: "Low", labelAr: "منخفضة" },
      ],
      stepName: "Review",
    });
    expect(before).toMatchObject({ labelAr: "Urgency", required: false, stepName: null });
    expect(after).toMatchObject({ key: "urgency", labelEn: "Urgency", labelAr: "الأولوية", required: true, stepName: "Review" });
    expect(after.enumValues?.[0]).toEqual({ value: "High", labelEn: "Urgent", labelAr: "عاجل" });
    expect(await loadRequestTypeDetail(code, "draft")).toMatchObject({ version: 2, status: "Draft" });
    // The published version is untouched until the draft is published.
    expect((await loadRequestTypeDetail(code))?.attributes[0]).toMatchObject({ labelAr: "Urgency", stepName: null });

    // A type that is no longer a list drops its choices; back to the form with null.
    expect((await updateAttribute({ code, key: "urgency", dataType: "Text", stepName: null })).after).toMatchObject({ dataType: "Text", enumValues: null, stepName: null });
    // A list with no choices, and an attribute the type has not got, are refused.
    await expect(updateAttribute({ code, key: "urgency", dataType: "Enum" })).rejects.toBeInstanceOf(RequestTypeRejected);
    await expect(updateAttribute({ code, key: "no_such_key", required: true })).rejects.toBeInstanceOf(RequestTypeRejected);
  });

  it("D302 the designer and the list follow the version being edited, and publishing twice says there is no draft", async () => {
    const { RequestTypeRejected, addAttribute, addAudience, addRule, addStep, loadRequestTypeDetail, loadRequestTypes, publishRequestType, setStepSla } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Close", nameAr: "إغلاق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: otherId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Close" });
    await addAttribute({ code, key: "checked", labelEn: "Checked", labelAr: "تم التحقق", dataType: "Boolean", required: true, stepName: "Review" });
    await publishRequestType({ code });

    // The first change after publishing opens a draft copy, and the step's attribute moves with its step.
    await setStepSla({ code, stepName: "Review", slaValue: 2, slaUnit: "Days" });
    expect(await loadRequestTypeDetail(code, "draft")).toMatchObject({
      version: 2,
      status: "Draft",
      attributes: [expect.objectContaining({ key: "checked", stepName: "Review" })],
    });
    await publishRequestType({ code });

    // One row per type, on the version now published; the superseded one is not a type of its own.
    expect((await loadRequestTypes()).types.filter((type) => type.c === code)).toEqual([expect.objectContaining({ v: "v2", st: "Published" })]);
    expect(await loadRequestTypeDetail(code, "draft")).toMatchObject({ version: 2, status: "Published" });
    await expect(publishRequestType({ code })).rejects.toBeInstanceOf(RequestTypeRejected);
  });

  it("UC-29.2-06 somebody outside the step's audience is told why in both languages", async () => {
    const { actionsFor, addAudience, addRule, addStep, createRequest, publishRequestType } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "Somebody else's step",
      titleAr: "خطوة شخص آخر",
      entryMode: "Form",
      attributes: {},
    });

    signedInAs = otherId;
    expect(await actionsFor(key)).toMatchObject({
      actions: [],
      reason: "You are not an audience of this step.",
      reasonAr: "لست ضمن جمهور هذه الخطوة.",
    });
  });

  it("UC-30.2-01 a step moves within the draft, and the first step is where a request starts", async () => {
    const { addStep, loadRequestTypeDetail, moveStep, updateStep } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    for (const name of ["Intake", "Review", "Closed"]) {
      await addStep({ code, nameEn: name, nameAr: name, slaValue: null, slaUnit: null });
    }
    const order = async () => (await loadRequestTypeDetail(code, "draft"))?.steps.map((step) => step.n);

    await moveStep({ code, stepName: "Review", position: 1 });
    expect(await order()).toEqual(["Review", "Intake", "Closed"]);
    await moveStep({ code, stepName: "Review", position: 3 });
    expect(await order()).toEqual(["Intake", "Closed", "Review"]);

    // The same edit through the patch, with its diff.
    const version = (
      await testPool().query<{ version: number }>(
        `select ts.version from work.transition_step ts join work.request_type_version v on v.id = ts.request_type_version_id
         join work.request_type t on t.id = v.request_type_id where t.code = $1 and ts.name_en = 'Closed' and v.status = 'Draft'`,
        [code],
      )
    ).rows[0].version;
    const diff = await updateStep({ code, stepName: "Closed", expectedVersion: version, position: 1 });
    expect(diff).toMatchObject({ before: { position: 2 }, after: { position: 1 } });
    expect(await order()).toEqual(["Closed", "Intake", "Review"]);
  });

  it("UC-28.1-01 UC-28.1-03 a request is created at the first step, and a missing attribute is refused", async () => {
    const { AttributeError, addAttribute, addAudience, addRule, addStep, createRequest, loadRequestDetail, publishRequestType } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    await addAttribute({ code, key: "amount_aed", labelEn: "Amount", labelAr: "المبلغ", dataType: "Money", required: true, stepName: null });
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    // `UC-28.1-03`: a required attribute with no value is refused, naming the field.
    await expect(
      createRequest({
        projectKey: project.rows[0].key,
        requestTypeCode: code,
        titleEn: "Missing the amount",
        titleAr: "بدون مبلغ",
        entryMode: "Form",
        attributes: {},
      }),
    ).rejects.toBeInstanceOf(AttributeError);

    const key = await createRequest({
      projectKey: project.rows[0].key,
      requestTypeCode: code,
      titleEn: "With the amount",
      titleAr: "مع المبلغ",
      entryMode: "Form",
      attributes: { amount_aed: "186" },
    });

    // It starts at the first transition step, which is where its audiences are waiting.
    const detail = await loadRequestDetail(key);
    expect(detail?.currentStep).toBe(0);
    expect(detail?.attributes).toContainEqual(["amount_aed", "186"]);

    await testPool().query("delete from work.request_event where request_id in (select id from work.request where key = $1)", [key]);
    await testPool().query("delete from work.request where key = $1", [key]);
  });

  it("UC-28.1-05 UC-28.1-06 UC-28.2-07 only the types and modes a person may use are offered", async () => {
    const { agenticEntryAvailable } = await import("@/features/requests/classification");
    const { loadPublishedTypes } = await import("@/features/requests/directory");
    signedInAs = ownerId;

    const published = await loadPublishedTypes();
    // `UC-28.1-06`: only published types are offered at all.
    for (const type of published) {
      expect(type.entryModes.length).toBeGreaterThan(0);
    }
    // `UC-28.2-07`: without the agent service there is no agentic entry to offer.
    expect(typeof (await agenticEntryAvailable())).toBe("boolean");
    // D310: nor while its flag is off, whatever the agent service.
    const flag = "agentic-interactive-request-entry";
    const { rows } = await testPool().query<{ is_enabled: boolean }>("select is_enabled from gov.feature_flag where key = $1", [flag]);
    await testPool().query("update gov.feature_flag set is_enabled = false where key = $1", [flag]);
    try {
      expect(await agenticEntryAvailable()).toBe(false);
    } finally {
      await testPool().query("update gov.feature_flag set is_enabled = $2 where key = $1", [flag, rows[0]?.is_enabled ?? false]);
    }
  });

  it("UC-30.1-04 offers an external intake form only for a published type that takes widget intake", async () => {
    const { addAudience, addStep, intakeProfile, createFromIntakeWidget, publishRequestType, saveDraft, addRule } =
      await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();

    // A draft has no published version for the endpoint to read, so there is no form.
    expect(await intakeProfile(code)).toBeNull();

    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    await saveDraft({
      code,
      categoryEn: "Finance",
      decomposition: "None",
      slaValue: 30,
      slaUnit: "Minutes",
      defaultProjectKey: project.rows[0].key,
      intakeChannels: ["Console", "Widget"],
      entryModes: ["TemplateForm"],
    });
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: 30, slaUnit: "Minutes" });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    // A flow is only publishable once somebody can act on its first step.
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await publishRequestType({ code });

    const profile = await intakeProfile(code);
    expect(profile?.projectKey).toBe(project.rows[0].key);

    const key = await createFromIntakeWidget({
      requestTypeCode: code,
      contactName: "Someone Outside",
      contactEmail: "someone@outside.example",
      summary: "The card reader at branch 4 is dead.",
      attributes: {},
    });

    // The request is raised by an external contact keyed by the email, on the Widget
    // channel â not by whoever happened to be signed in to the console.
    const raised = await testPool().query<{ requester_type: string; channel: string; address: string }>(
      `select r.requester_type, r.channel, e.channel_address as address
       from work.request r join core.external_contact e on e.id = r.requester_id
       where r.key = $1`,
      [key],
    );
    expect(raised.rows[0]).toMatchObject({
      requester_type: "ExternalContact",
      channel: "Widget",
      address: "someone@outside.example",
    });
  });

  it("UC-30.2-04 edits a step as a patch: omitted is unchanged, null clears, stale is refused", async () => {
    const { addStep, updateStep, loadRequestTypeDetail } = await import("@/features/requests/service");
    const { RequestTypeRejected } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "ÙØ±Ø§Ø¬Ø¹Ø©", slaValue: 2, slaUnit: "Hours" });

    const stepVersion = async () => {
      const row = await testPool().query<{ version: number }>(
        `select ts.version from work.transition_step ts
         join work.request_type_version v on v.id = ts.request_type_version_id
         join work.request_type t on t.id = v.request_type_id
         where t.code = $1 and ts.name_en = 'Review'`,
        [code],
      );
      return row.rows[0].version;
    };

    // Naming one field leaves the others alone.
    const diff = await updateStep({ code, stepName: "Review", expectedVersion: await stepVersion(), slaValue: 30, slaUnit: "Minutes" });
    expect(diff.before).toMatchObject({ slaValue: 2, slaUnit: "Hours" });
    expect(diff.after).toMatchObject({ slaValue: 30, slaUnit: "Minutes" });

    let detail = await loadRequestTypeDetail(code, "draft");
    let step = detail?.steps.find((one) => one.n === "Review");
    expect(step?.slaValue).toBe(30);
    expect(step?.nAr).toBe("ÙØ±Ø§Ø¬Ø¹Ø©");

    // An explicit null clears; the name is untouched because it was not named.
    await updateStep({ code, stepName: "Review", expectedVersion: await stepVersion(), slaValue: null, slaUnit: null });
    detail = await loadRequestTypeDetail(code, "draft");
    step = detail?.steps.find((one) => one.n === "Review");
    expect(step?.slaValue).toBeNull();
    expect(step?.nAr).toBe("ÙØ±Ø§Ø¬Ø¹Ø©");

    // A version somebody else has moved past is refused rather than overwritten.
    await expect(
      updateStep({ code, stepName: "Review", expectedVersion: 1, slaValue: 5, slaUnit: "Hours" }),
    ).rejects.toBeInstanceOf(RequestTypeRejected);
  });


  it("UC-30.2-04 names what a terminal flip takes with it, so an approval is informed", async () => {
    const { addStep, addAudience, addRule, updateStep } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Check", nameAr: "ÙØ­Øµ", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "ÙÙØªÙÙ", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Check", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Check", kind: "Action", expression: null, actionName: "Close", toStepName: "Done" });

    const version = await testPool().query<{ version: number }>(
      `select ts.version from work.transition_step ts
       join work.request_type_version v on v.id = ts.request_type_version_id
       join work.request_type t on t.id = v.request_type_id
       where t.code = $1 and ts.name_en = 'Check'`,
      [code],
    );
    const diff = await updateStep({
      code,
      stepName: "Check",
      expectedVersion: version.rows[0].version,
      isTerminal: true,
    });

    // The cascade is part of the change, so it is part of the diff.
    expect(diff.cascade.audiences.length).toBeGreaterThan(0);
    expect(diff.cascade.rules.join(" ")).toContain("Close");
  });

  it("UC-30.2-04 refuses a sensitive field to an agent until an approval binds it", async () => {
    const { updateStep, addStep } = await import("@/features/requests/service");
    const { ApprovalRequired } = await import("@/lib/approval-binding");
    const { runAs } = await import("@/lib/session");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Hold", nameAr: "Ø§ÙØªØ¸Ø§Ø±", slaValue: null, slaUnit: null });

    // The same edit, asked for by an agent acting on the owner's behalf. The owner may do
    // it; the agent may not do it unattended.
    const asAgent = runAs(ownerId, { id: "00000000-0000-4000-8000-00000000a9e7", label: "pa" }, () =>
      updateStep({ code, stepName: "Hold", expectedVersion: 1, isTerminal: true }),
    );
    await expect(asAgent).rejects.toBeInstanceOf(ApprovalRequired);

    // Refused before anything was written, which is what makes a retry after approval safe.
    const after = await testPool().query<{ is_terminal: boolean }>(
      `select ts.is_terminal from work.transition_step ts
       join work.request_type_version v on v.id = ts.request_type_version_id
       join work.request_type t on t.id = v.request_type_id
       where t.code = $1 and ts.name_en = 'Hold'`,
      [code],
    );
    expect(after.rows[0].is_terminal).toBe(false);
  });

  it("UC-30.2-04 lets one of two concurrent edits win, and tells the other to read again", async () => {
    const { addStep, updateStep, RequestTypeRejected } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Race", nameAr: "Ø³Ø¨Ø§Ù", slaValue: 1, slaUnit: "Hours" });

    const at = await testPool().query<{ version: number }>(
      `select ts.version from work.transition_step ts
       join work.request_type_version v on v.id = ts.request_type_version_id
       join work.request_type t on t.id = v.request_type_id
       where t.code = $1 and ts.name_en = 'Race'`,
      [code],
    );
    const version = at.rows[0].version;

    // Both patches were written against the same version they each read.
    const results = await Promise.allSettled([
      updateStep({ code, stepName: "Race", expectedVersion: version, slaValue: 10, slaUnit: "Minutes" }),
      updateStep({ code, stepName: "Race", expectedVersion: version, slaValue: 20, slaUnit: "Minutes" }),
    ]);
    const won = results.filter((one) => one.status === "fulfilled");
    const lost = results.filter((one) => one.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(RequestTypeRejected);
  });

  /** A published type of this test's own with one step the owner acts on, ready to raise requests against. */
  const publishedType = async () => {
    const { addAudience, addRule, addStep, publishRequestType } = await import("@/features/requests/service");
    const code = await makeType();
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await publishRequestType({ code });
    return code;
  };

  const raise = async (code: string, titleEn: string) => {
    const { createRequest } = await import("@/features/requests/service");
    const project = await testPool().query<{ key: string }>("select key from work.project order by key limit 1");
    return createRequest({ projectKey: project.rows[0].key, requestTypeCode: code, titleEn, titleAr: titleEn, entryMode: "Form", attributes: {} });
  };

  it("deleting a request removes it with its decision log, and the deletion is audited", async () => {
    const { deleteRequest } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const key = await raise(await publishedType(), "To be deleted");
    const raised = await testPool().query<{ id: string; events: number }>(
      `select r.id, (select count(*)::int from work.request_event e where e.request_id = r.id) as events
       from work.request r where r.key = $1`,
      [key],
    );
    expect(raised.rows[0].events).toBeGreaterThan(0);

    // A deleted key is free to be raised again, so earlier entries for it may exist.
    const deletions = () =>
      testPool().query<{ actor_id: string }>(
        "select actor_id from audit.audit_entry where action = 'requests:delete' and object_label = $1 order by at desc, id desc",
        [key],
      );
    const before = (await deletions()).rows.length;

    await deleteRequest(key);

    const left = await testPool().query<{ requests: number; events: number }>(
      `select (select count(*)::int from work.request where id = $1) as requests,
              (select count(*)::int from work.request_event where request_id = $1) as events`,
      [raised.rows[0].id],
    );
    expect(left.rows[0]).toEqual({ requests: 0, events: 0 });
    const after = await deletions();
    expect(after.rows).toHaveLength(before + 1);
    expect(after.rows[0].actor_id).toBe(ownerId);
  });

  it("deleting a request is refused while a request raised from it remains, for a missing key, and without requests:write", async () => {
    const { RequestRejected, deleteRequest } = await import("@/features/requests/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    const code = await publishedType();
    const parent = await raise(code, "The parent");
    const child = await raise(code, "Raised from the parent");
    await testPool().query(
      "update work.request set parent_request_id = (select id from work.request where key = $1) where key = $2",
      [parent, child],
    );
    try {
      const refused = deleteRequest(parent);
      await expect(refused).rejects.toBeInstanceOf(RequestRejected);
      await expect(refused).rejects.toThrow("it still has 1 requests raised from it");
      await expect(deleteRequest("REQ-NO-SUCH-KEY")).rejects.toBeInstanceOf(RequestRejected);

      // `omar@tahseel.ae` is an Agent Designer, who may not change requests.
      const designer = await testPool().query<{ id: string }>("select id from core.person where email = 'omar@tahseel.ae'");
      signedInAs = designer.rows[0].id;
      await expect(deleteRequest(child)).rejects.toBeInstanceOf(NotPermitted);

      const kept = await testPool().query<{ count: number }>(
        "select count(*)::int as count from work.request where key = any($1)",
        [[parent, child]],
      );
      expect(kept.rows[0].count).toBe(2);
    } finally {
      await testPool().query("update work.request set parent_request_id = null where key = $1", [child]);
    }
  });

  it("deleting a request type is refused while a request uses it, then removes every version, step and rule", async () => {
    const { RequestTypeRejected, deleteRequestType } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await publishedType();
    const key = await raise(code, "Pins the type");

    const refused = deleteRequestType(code);
    await expect(refused).rejects.toBeInstanceOf(RequestTypeRejected);
    await expect(refused).rejects.toThrow(`The request type ${code} cannot be deleted: 1 requests still use it. Delete it with its requests`);

    // D293: asked to, it takes its requests and their history with it.
    await deleteRequestType(code, true);

    const left = await testPool().query<{ types: number; versions: number; requests: number }>(
      `select (select count(*)::int from work.request_type where code = $1) as types,
              (select count(*)::int from work.request_type_version v
                 where not exists (select 1 from work.request_type rt where rt.id = v.request_type_id)) as versions,
              (select count(*)::int from work.request where key = $2) as requests`,
      [code, key],
    );
    expect(left.rows[0]).toEqual({ types: 0, versions: 0, requests: 0 });
    await expect(deleteRequestType(code)).rejects.toThrow("That request type no longer exists.");
  });

  it("D293 a type with a published version and a draft copied from it is deleted whole", async () => {
    const { addStep, deleteRequestType } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await publishedType();
    // Designing again copies the published version, its routing rules included, into a draft.
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    const versions = await testPool().query<{ count: number }>(
      "select count(*)::int as count from work.request_type_version v join work.request_type rt on rt.id = v.request_type_id where rt.code = $1",
      [code],
    );
    expect(versions.rows[0].count).toBe(2);

    await deleteRequestType(code);
    const left = await testPool().query<{ count: number }>("select count(*)::int as count from work.request_type where code = $1", [code]);
    expect(left.rows[0].count).toBe(0);
  });

  it("D293 deleting a type with its requests is refused while an approval points at one of them", async () => {
    const { deleteRequestType } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await publishedType();
    const key = await raise(code, "Has an approval");
    const approval = await testPool().query<{ id: string }>(
      `insert into ai.approval (key, request_id, requested_by_type, action)
       select 'APR-T' || floor(random() * 1e6)::int, id, 'Person', 'request_step_action_create' from work.request where key = $1 returning id`,
      [key],
    );
    try {
      await expect(deleteRequestType(code, true)).rejects.toThrow("1 approvals on its requests");
    } finally {
      await testPool().query("delete from ai.approval where id = $1", [approval.rows[0].id]);
    }
  });

  it("D293 an audience and a routing rule come off a draft step by their position", async () => {
    const { addAudience, addRule, addStep, loadRequestTypeDetail, removeAudience, removeRule } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Submitted", nameAr: "مقدم", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Closed", nameAr: "مغلق", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Person", principalId: ownerId, access: "CanAct", sequence: null });
    await addAudience({ code, stepName: "Submitted", principalType: "Requester", principalId: null, access: "ViewOnly", sequence: null });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Close", toStepName: "Closed" });
    await addRule({ code, stepName: "Submitted", kind: "Action", expression: null, actionName: "Approve", toStepName: "Closed" });

    await removeAudience({ code, stepName: "Submitted", position: 1 });
    await removeRule({ code, stepName: "Submitted", position: 2 });

    const step = (await loadRequestTypeDetail(code, "draft"))!.steps.find((one) => one.n === "Submitted")!;
    expect(step.aud.map(([, , access]) => access)).toEqual(["ViewOnly"]);
    expect(step.out.map(([when]) => when)).toEqual(["Close"]);
    await expect(removeRule({ code, stepName: "Submitted", position: 2 })).rejects.toThrow("Step Submitted has no rule 2.");
  });

  it("UC-30.1-01 a step's SLA is set and cleared as a pair, and half of one is refused", async () => {
    const { RequestTypeRejected, addStep, setStepSla } = await import("@/features/requests/service");
    const { NotPermitted } = await import("@/lib/session");
    signedInAs = ownerId;
    const code = await makeType();
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: 2, slaUnit: "Hours" });
    const sla = async () => {
      const row = await testPool().query<{ sla_value: number | null; sla_unit: string | null }>(
        `select ts.sla_value, ts.sla_unit from work.transition_step ts
         join work.request_type_version v on v.id = ts.request_type_version_id
         join work.request_type t on t.id = v.request_type_id
         where t.code = $1 and ts.name_en = 'Review'`,
        [code],
      );
      return row.rows[0];
    };

    await setStepSla({ code, stepName: "Review", slaValue: 30, slaUnit: "Minutes" });
    expect(await sla()).toEqual({ sla_value: 30, sla_unit: "Minutes" });

    await setStepSla({ code, stepName: "Review", slaValue: null, slaUnit: null });
    expect(await sla()).toEqual({ sla_value: null, sla_unit: null });

    await expect(setStepSla({ code, stepName: "Review", slaValue: 5, slaUnit: null })).rejects.toBeInstanceOf(RequestTypeRejected);
    await expect(setStepSla({ code, stepName: "Nowhere", slaValue: 5, slaUnit: "Hours" })).rejects.toBeInstanceOf(RequestTypeRejected);

    // `layla@tahseel.ae` is a Member, who may read request types but not design them.
    const member = await testPool().query<{ id: string }>("select id from core.person where email = 'layla@tahseel.ae'");
    signedInAs = member.rows[0].id;
    await expect(setStepSla({ code, stepName: "Review", slaValue: 5, slaUnit: "Hours" })).rejects.toBeInstanceOf(NotPermitted);
    expect(await sla()).toEqual({ sla_value: null, sla_unit: null });
  });
});
