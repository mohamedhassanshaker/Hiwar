import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `UC-41.2-03` and `NFR-09` for requests and rooms: a role assigned in one org unit applies in
 * that unit only. Each case acts as somebody scoped to Finance or Procurement against a record
 * in Customer Service, with a record in their own unit as the control.
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

describe.skipIf(!hasDatabase)("role scope on requests and rooms", () => {
  let ownerId = "";
  let financeMemberId = "";
  let orgMemberId = "";
  let platformMemberId = "";
  let procurementLeadId = "";
  const people: string[] = [];
  const createdTypes: string[] = [];
  const createdRooms: string[] = [];
  // A word no seeded title holds, so a count by title finds only this suite's rows.
  const marker = `Sorrel${Date.now().toString(36)}`;

  /** A person with one role in one scope; `scopeId` is null for the organisation. */
  const person = async (label: string, roleCode: string, scopeType: string, scopeId: string | null, unitId: string) => {
    const role = await testPool().query<{ id: string }>("select id from core.role where code = $1", [roleCode]);
    const row = await testPool().query<{ id: string }>(
      `insert into core.person (email, name_en, name_ar, initials, status, org_unit_id)
       values ($1, $2, $2, 'SC', 'Active', $3) returning id`,
      [`scope-${label}-${Date.now()}@tahseel.ae`, `Scope ${label}`, unitId],
    );
    await testPool().query(
      "insert into core.role_assignment (person_id, role_id, scope_type, scope_id) values ($1, $2, $3, $4)",
      [row.rows[0].id, role.rows[0].id, scopeType, scopeId],
    );
    people.push(row.rows[0].id);
    return row.rows[0].id;
  };

  beforeAll(async () => {
    ownerId = (await testPool().query<{ id: string }>("select id from core.person where email = 'mariam@tahseel.ae'")).rows[0].id;
    const unit = async (name: string) =>
      (await testPool().query<{ id: string }>("select id from core.org_unit where name_en = $1", [name])).rows[0].id;
    const [finance, procurement, platform] = [await unit("Finance"), await unit("Procurement"), await unit("Platform")];
    financeMemberId = await person("finance", "Member", "OrgUnit", finance, finance);
    orgMemberId = await person("org", "Member", "Organisation", null, finance);
    platformMemberId = await person("platform", "Member", "OrgUnit", platform, finance);
    procurementLeadId = await person("procurement", "WorkLead", "OrgUnit", procurement, procurement);
  });

  afterEach(async () => {
    // A room a refused call made anyway is cleared with the rest.
    const stray = await testPool().query<{ key: string }>("select key from work.discussion_room where title_en like $1", [`%${marker}%`]);
    createdRooms.push(...stray.rows.map((row) => row.key).filter((key) => !createdRooms.includes(key)));
    if (createdRooms.length > 0) {
      const rooms = "(select id from work.discussion_room where key = any($1))";
      await testPool().query(`delete from work.context_handoff where owner_type = 'Room' and owner_id in ${rooms}`, [createdRooms]);
      await testPool().query(`delete from work.room_message where room_id in ${rooms}`, [createdRooms]);
      await testPool().query(`delete from work.room_participant where room_id in ${rooms}`, [createdRooms]);
      await testPool().query("update work.discussion_room set forked_from_room_id = null where key = any($1)", [createdRooms]);
      await testPool().query("delete from work.discussion_room where key = any($1)", [createdRooms]);
      createdRooms.length = 0;
    }
    if (createdTypes.length > 0) {
      const requests = `(select r.id from work.request r
         join work.request_type_version v on v.id = r.request_type_version_id
         join work.request_type rt on rt.id = v.request_type_id where rt.code = any($1))`;
      await testPool().query(`delete from gov.mail_notification where subject_id in ${requests}`, [createdTypes]);
      await testPool().query(`delete from work.request_event where request_id in ${requests}`, [createdTypes]);
      await testPool().query(`delete from work.request where id in ${requests}`, [createdTypes]);
      await testPool().query(
        `delete from work.routing_rule where from_step_id in (
           select ts.id from work.transition_step ts
           join work.request_type_version v on v.id = ts.request_type_version_id
           join work.request_type rt on rt.id = v.request_type_id where rt.code = any($1))`,
        [createdTypes],
      );
      await testPool().query("delete from work.request_type where code = any($1)", [createdTypes]);
      createdTypes.length = 0;
    }
  });

  afterAll(async () => {
    for (const table of ["ai.inbox_item", "gov.mail_notification", "core.notification_preference", "core.role_assignment"]) {
      await testPool().query(`delete from ${table} where person_id = any($1)`, [people]);
    }
    await testPool().query("delete from core.person where id = any($1)", [people]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  /** A published type of two steps, Review then Done, whose Review step names `audience`. */
  const makeFlow = async (audience: { principalType: "Person" | "Role"; principalId: string }) => {
    const { addAudience, addRule, addStep, createRequestType, publishRequestType } = await import("@/features/requests/service");
    signedInAs = ownerId;
    const code = `S${Date.now().toString().slice(-6)}`;
    await createRequestType({
      code,
      nameEn: `${marker} type`,
      nameAr: "نوع للاختبار",
      categoryEn: "Finance",
      decomposition: "None",
    } as Parameters<typeof createRequestType>[0]);
    createdTypes.push(code);
    await addStep({ code, nameEn: "Review", nameAr: "مراجعة", slaValue: null, slaUnit: null });
    await addStep({ code, nameEn: "Done", nameAr: "منجز", slaValue: null, slaUnit: null });
    await addAudience({ code, stepName: "Review", ...audience, access: "CanAct", sequence: null });
    await addRule({ code, stepName: "Review", kind: "Action", expression: null, actionName: "Approve", toStepName: "Done" });
    await publishRequestType({ code });
    return code;
  };

  /** A request of `code` in `projectKey`, raised by `as`. */
  const raise = async (code: string, projectKey: string, as = ownerId) => {
    const { createRequest } = await import("@/features/requests/service");
    signedInAs = as;
    return createRequest({ projectKey, requestTypeCode: code, titleEn: `${marker} request`, titleAr: "طلب", entryMode: "Form", attributes: {} });
  };

  const requestsIn = async (code: string, projectKey: string) =>
    (
      await testPool().query<{ n: number }>(
        `select count(*)::int as n from work.request r
         join work.project p on p.id = r.project_id
         join work.request_type_version v on v.id = r.request_type_version_id
         join work.request_type rt on rt.id = v.request_type_id
         where rt.code = $1 and p.key = $2`,
        [code, projectKey],
      )
    ).rows[0].n;

  /** A room the owner creates in `projectKey`, with only the owner in it. */
  const roomIn = async (projectKey: string) => {
    const { createRoom } = await import("@/features/rooms/service");
    signedInAs = ownerId;
    const key = await createRoom({
      projectKey,
      titleEn: `${marker} room`,
      titleAr: "غرفة",
      type: "Chat",
      turnTaking: "MentionOnly",
      status: "Active",
      participants: [ownerId],
    });
    createdRooms.push(key);
    return key;
  };

  const roomRow = async (key: string) =>
    (
      await testPool().query<{ id: string; status: string; turn_taking: string; version: number; mirror_channel_id: string | null }>(
        "select id, status, turn_taking, version, mirror_channel_id from work.discussion_room where key = $1",
        [key],
      )
    ).rows[0];

  const roomsTitled = async (title: string) =>
    (await testPool().query<{ key: string }>("select key from work.discussion_room where title_en = $1", [title])).rows.map((row) => row.key);

  it("raising or deleting a request outside the person's unit is refused", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { deleteRequest } = await import("@/features/requests/service");
    const code = await makeFlow({ principalType: "Person", principalId: ownerId });

    await expect(raise(code, "CS", financeMemberId)).rejects.toBeInstanceOf(NotPermitted);
    expect(await requestsIn(code, "CS")).toBe(0);
    const own = await raise(code, "FIN", financeMemberId);

    const theirs = await raise(code, "CS");
    signedInAs = financeMemberId;
    await expect(deleteRequest(theirs)).rejects.toBeInstanceOf(NotPermitted);
    expect(await requestsIn(code, "CS")).toBe(1);
    await deleteRequest(own);
    expect(await requestsIn(code, "FIN")).toBe(0);
  });

  it("a request the person may not see is not read, and no room is made from it", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { RoomRejected, createRoomFromRequest } = await import("@/features/rooms/service");
    const { loadRequestDetail, loadRequestForRoom } = await import("@/features/requests/service");
    const hiddenType = await makeFlow({ principalType: "Person", principalId: ownerId });
    const hidden = await raise(hiddenType, "CS");
    const shown = await raise(hiddenType, "FIN");
    // Named on its step, so it is visible to them (D166), but its room would be in CS.
    const namedType = await makeFlow({ principalType: "Person", principalId: financeMemberId });
    const named = await raise(namedType, "CS");

    signedInAs = financeMemberId;
    expect(await loadRequestDetail(hidden)).toBeNull();
    expect(await loadRequestForRoom(hidden)).toBeNull();
    const refusal = createRoomFromRequest(hidden);
    await expect(refusal).rejects.toBeInstanceOf(RoomRejected);
    await expect(refusal).rejects.toThrow("That request no longer exists.");
    expect(await roomsTitled(`${hidden}: ${marker} request`)).toEqual([]);

    expect(await loadRequestDetail(named)).toMatchObject({ key: named });
    await expect(createRoomFromRequest(named)).rejects.toBeInstanceOf(NotPermitted);
    expect(await roomsTitled(`${named}: ${marker} request`)).toEqual([]);

    expect(await loadRequestDetail(shown)).toMatchObject({ key: shown });
    const room = await createRoomFromRequest(shown);
    createdRooms.push(room);
    expect((await testPool().query<{ key: string }>(
      "select p.key from work.discussion_room r join work.project p on p.id = r.project_id where r.key = $1",
      [room],
    )).rows[0].key).toBe("FIN");
  });

  it("a role audience reaches a person only where their assignment of that role covers the request's project", async () => {
    const { RequestRejected, actionsFor, loadRequests, takeStepAction } = await import("@/features/requests/service");
    const member = (await testPool().query<{ id: string }>("select id from core.role where code = 'Member'")).rows[0].id;
    const code = await makeFlow({ principalType: "Role", principalId: member });
    const cs = await raise(code, "CS");
    const fin = await raise(code, "FIN");

    signedInAs = financeMemberId;
    expect(await actionsFor(cs)).toMatchObject({ actions: [], reason: "You are not an audience of this step." });
    await expect(takeStepAction({ key: cs, action: "Approve" })).rejects.toBeInstanceOf(RequestRejected);
    expect((await loadRequests({ key: cs })).total).toBe(0);
    expect((await loadRequests({ key: fin })).total).toBe(1);
    expect((await actionsFor(fin)).actions).toEqual(["Approve"]);

    for (const reached of [orgMemberId, platformMemberId]) {
      signedInAs = reached;
      expect((await actionsFor(cs)).actions).toEqual(["Approve"]);
      expect((await loadRequests({ key: cs })).total).toBe(1);
    }
    signedInAs = orgMemberId;
    await expect(takeStepAction({ key: cs, action: "Approve" })).resolves.toMatchObject({ toStepName: "Done" });
  });

  it("creating or forking a room outside the person's unit is refused", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { RoomRejected, createRoom, forkRoom, setParticipant } = await import("@/features/rooms/service");
    const create = (projectKey: string) =>
      createRoom({
        projectKey,
        titleEn: `${marker} ${projectKey} by a member`,
        titleAr: "غرفة",
        type: "Chat",
        turnTaking: "MentionOnly",
        status: "Active",
        participants: [financeMemberId],
      });
    const fork = (roomKey: string) =>
      forkRoom({ roomKey, titleEn: `${marker} fork of ${roomKey}`, titleAr: "تفرع", whatShouldChange: "Narrow it." });

    signedInAs = financeMemberId;
    await expect(create("CS")).rejects.toBeInstanceOf(NotPermitted);
    expect(await roomsTitled(`${marker} CS by a member`)).toEqual([]);
    createdRooms.push(await create("FIN"));

    const cs = await roomIn("CS");
    signedInAs = financeMemberId;
    await expect(fork(cs)).rejects.toBeInstanceOf(RoomRejected);
    // In the room, so they may read it, and still not write a room in its project.
    signedInAs = ownerId;
    await setParticipant({ roomKey: cs, principal: financeMemberId, action: "Add" });
    signedInAs = financeMemberId;
    await expect(fork(cs)).rejects.toBeInstanceOf(NotPermitted);
    expect(await roomsTitled(`${marker} fork of ${cs}`)).toEqual([]);

    const fin = await roomIn("FIN");
    signedInAs = financeMemberId;
    createdRooms.push(await fork(fin));
    expect(await roomsTitled(`${marker} fork of ${fin}`)).toHaveLength(1);
  });

  it("moderating a room outside the person's unit is refused and changes nothing", async () => {
    const { NotPermitted } = await import("@/lib/session");
    const { closeRoom, deleteRoom, setParticipant, setTurnTaking } = await import("@/features/rooms/service");
    const { mirrorRoom } = await import("@/features/engage/service");
    const close = (roomKey: string) => closeRoom({ roomKey, goal: "Done here", decisions: "", openQuestions: "", nextStep: "" });
    const participants = async (roomKey: string) =>
      (
        await testPool().query<{ id: string }>(
          "select rp.principal_id as id from work.room_participant rp join work.discussion_room r on r.id = rp.room_id where r.key = $1",
          [roomKey],
        )
      ).rows.map((row) => row.id);

    const cs = await roomIn("CS");
    const before = await roomRow(cs);
    signedInAs = procurementLeadId;
    await expect(setTurnTaking({ roomKey: cs, turnTaking: "Autonomous", version: before.version })).rejects.toBeInstanceOf(NotPermitted);
    await expect(setParticipant({ roomKey: cs, principal: procurementLeadId, action: "Add" })).rejects.toBeInstanceOf(NotPermitted);
    await expect(close(cs)).rejects.toBeInstanceOf(NotPermitted);
    await expect(mirrorRoom({ roomKey: cs, channelType: "WhatsApp", externalRef: `${marker}-mirror` })).rejects.toBeInstanceOf(NotPermitted);
    await expect(deleteRoom(cs)).rejects.toBeInstanceOf(NotPermitted);
    expect(await roomRow(cs)).toEqual(before);
    expect(await participants(cs)).not.toContain(procurementLeadId);

    const prc = await roomIn("PRC");
    signedInAs = procurementLeadId;
    await setTurnTaking({ roomKey: prc, turnTaking: "Autonomous", version: (await roomRow(prc)).version });
    await setParticipant({ roomKey: prc, principal: procurementLeadId, action: "Add" });
    expect(await participants(prc)).toContain(procurementLeadId);
    await close(prc);
    expect((await roomRow(prc)).status).not.toBe("Active");
    await deleteRoom(prc);
    expect(await roomRow(prc)).toBeUndefined();
  });
});
