import { afterAll, describe, expect, it } from "vitest";

import { closeTestPool, failureOf, hasDatabase, inRolledBackTransaction, seedFixture, testPool } from "./harness";

/**
 * The ten integrity rules of `Tahseel_AWP_Data_Model.md` section 23, each with its own
 * case. Rules 2 and the project-rule half of rule 4 belong to the module services, which
 * need the compiled attribute schema and the project's approval rules; the cases here
 * cover what the database itself refuses.
 */
describe.skipIf(!hasDatabase)("data model section 23 — integrity rules", () => {
  afterAll(closeTestPool);

  it("rule 1: a sub item belongs to its parent's project", async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedFixture(client);
      const parent = await client.query<{ id: string }>(
        `insert into work.work_item (key, project_id, type, title_en, title_ar)
         values ('TSK-9001', $1, 'Task', 'Parent', 'أصل') returning id`,
        [fixture.projectId],
      );

      const wrong = await failureOf(
        client,
        `insert into work.work_item (key, project_id, type, title_en, title_ar, parent_work_item_id)
         values ('TSK-9002', $1, 'SubItem', 'Sub', 'فرعي', $2)`,
        [fixture.otherProjectId, parent.rows[0].id],
      );
      expect(wrong).toContain("sub item belongs to its parent's project");

      const right = await failureOf(
        client,
        `insert into work.work_item (key, project_id, type, title_en, title_ar, parent_work_item_id)
         values ('TSK-9003', $1, 'SubItem', 'Sub', 'فرعي', $2)`,
        [fixture.projectId, parent.rows[0].id],
      );
      expect(right).toBeNull();
    });
  });

  it("rule 3: the requester never approves their own request", async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedFixture(client);
      const approval = await seedRequestApproval(client, fixture.projectId, fixture.personId);

      const self = await failureOf(
        client,
        `insert into ai.approval_decision (approval_id, approver_person_id, decision) values ($1, $2, 'Approved')`,
        [approval, fixture.personId],
      );
      expect(self).toContain("requester may not approve their own request");

      const independent = await failureOf(
        client,
        `insert into ai.approval_decision (approval_id, approver_person_id, decision) values ($1, $2, 'Approved')`,
        [approval, fixture.otherPersonId],
      );
      expect(independent).toBeNull();
    });
  });

  it("rule 3: the author of the work never approves it", async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedFixture(client);
      const item = await client.query<{ id: string }>(
        `insert into work.work_item (key, project_id, title_en, title_ar, assignee_type, assignee_id)
         values ('TSK-9100', $1, 'Work', 'عمل', 'Person', $2) returning id`,
        [fixture.projectId, fixture.personId],
      );
      const approval = await client.query<{ id: string }>(
        `insert into ai.approval (key, requested_by_type, action, work_item_id)
         values ('APR-9100', 'Agent', 'publish', $1) returning id`,
        [item.rows[0].id],
      );

      const author = await failureOf(
        client,
        `insert into ai.approval_decision (approval_id, approver_person_id, decision) values ($1, $2, 'Approved')`,
        [approval.rows[0].id, fixture.personId],
      );
      expect(author).toContain("author of the work may not approve it");
    });
  });

  it("rule 3: a rejection always carries a reason", async () => {
    await inRolledBackTransaction(async (client) => {
      const fixture = await seedFixture(client);
      const approval = await seedRequestApproval(client, fixture.projectId, fixture.personId);

      const noReason = await failureOf(
        client,
        `insert into ai.approval_decision (approval_id, approver_person_id, decision) values ($1, $2, 'Rejected')`,
        [approval, fixture.otherPersonId],
      );
      expect(noReason).toContain("approval_decision_reason_check");

      const withReason = await failureOf(
        client,
        `insert into ai.approval_decision (approval_id, approver_person_id, decision, reason)
         values ($1, $2, 'Rejected', 'Out of policy')`,
        [approval, fixture.otherPersonId],
      );
      expect(withReason).toBeNull();
    });
  });

  it("rule 4: a tool mode is never looser than the tool's tier", async () => {
    await inRolledBackTransaction(async (client) => {
      const { versionId, t2ToolId, t3ToolId } = await seedAgentAndTools(client);

      expect(
        await failureOf(client, `insert into ai.agent_tool_mode (agent_version_id, connector_tool_id, mode) values ($1, $2, 'Auto')`, [
          versionId,
          t2ToolId,
        ]),
      ).toContain("T2 tool always needs a human approval");

      expect(
        await failureOf(client, `insert into ai.agent_tool_mode (agent_version_id, connector_tool_id, mode) values ($1, $2, 'Approval')`, [
          versionId,
          t3ToolId,
        ]),
      ).toContain("T3 tool is forbidden");

      expect(
        await failureOf(client, `insert into ai.agent_tool_mode (agent_version_id, connector_tool_id, mode) values ($1, $2, 'Approval')`, [
          versionId,
          t2ToolId,
        ]),
      ).toBeNull();
    });
  });

  it("rule 5: a terminal step has no audience and no outgoing routing rule", async () => {
    await inRolledBackTransaction(async (client) => {
      const { terminalStepId, openStepId } = await seedRequestType(client);

      expect(
        await failureOf(client, `insert into work.step_audience (step_id, principal_type) values ($1, 'Role')`, [terminalStepId]),
      ).toContain("terminal transition step has no audience");

      expect(
        await failureOf(client, `insert into work.routing_rule (from_step_id, sort_order, kind, action_name) values ($1, 1, 'Action', 'Submit')`, [
          terminalStepId,
        ]),
      ).toContain("terminal transition step has no audience");

      expect(
        await failureOf(client, `insert into work.step_audience (step_id, principal_type) values ($1, 'Role')`, [openStepId]),
      ).toBeNull();
    });
  });

  it("rule 6: only one published request type version at a time", async () => {
    await inRolledBackTransaction(async (client) => {
      const type = await client.query<{ id: string }>(
        `insert into work.request_type (code, name_en, name_ar) values ('T6', 'Rule six', 'القاعدة ٦') returning id`,
      );
      await client.query(
        `insert into work.request_type_version (request_type_id, version_number, status) values ($1, 1, 'Published')`,
        [type.rows[0].id],
      );

      expect(
        await failureOf(
          client,
          `insert into work.request_type_version (request_type_id, version_number, status) values ($1, 2, 'Published')`,
          [type.rows[0].id],
        ),
      ).toContain("request_type_version_published_key");

      expect(
        await failureOf(
          client,
          `insert into work.request_type_version (request_type_id, version_number, status) values ($1, 2, 'Draft')`,
          [type.rows[0].id],
        ),
      ).toBeNull();
    });
  });

  it("rule 6: only one active agent version at a time", async () => {
    await inRolledBackTransaction(async (client) => {
      const agent = await client.query<{ id: string }>(
        `insert into ai.agent (code, name_en, name_ar, initials) values ('r6', 'Rule six', 'القاعدة ٦', 'R6') returning id`,
      );
      await client.query(`insert into ai.agent_version (agent_id, version_number, is_active) values ($1, 1, true)`, [agent.rows[0].id]);

      expect(
        await failureOf(client, `insert into ai.agent_version (agent_id, version_number, is_active) values ($1, 2, true)`, [agent.rows[0].id]),
      ).toContain("agent_version_active_key");
    });
  });

  it("rule 7: audit entries are insert-only", async () => {
    const pool = testPool();
    const inserted = await pool.query<{ id: string }>(
      `insert into audit.audit_entry (actor_type, actor_label, action, object_type, outcome)
       values ('System', 'integrity test', 'test.rule7', 'Test', 'Allowed') returning id`,
    );
    expect(inserted.rows).toHaveLength(1);

    await expect(pool.query(`update audit.audit_entry set action = 'tampered' where id = $1`, [inserted.rows[0].id])).rejects.toThrow(
      /append-only: UPDATE is not permitted/,
    );
    await expect(pool.query(`delete from audit.audit_entry where id = $1`, [inserted.rows[0].id])).rejects.toThrow(
      /append-only: DELETE is not permitted/,
    );
  });

  it("rule 8: a client key stores a hash and a prefix, never the secret", async () => {
    await inRolledBackTransaction(async (client) => {
      const columns = await client.query<{ data_type: string }>(
        `select data_type from information_schema.columns
         where table_schema = 'gov' and table_name = 'client_key' and column_name = 'secret_hash'`,
      );
      expect(columns.rows[0].data_type).toBe("bytea");

      const plaintext = await client.query<{ count: string }>(
        `select count(*)::text as count from information_schema.columns
         where table_schema in ('gov', 'ai')
           and column_name in ('secret_ref', 'secret_hash')
           and data_type <> 'bytea'`,
      );
      expect(plaintext.rows[0].count).toBe("0");
    });
  });

  it("rule 9: codes and keys are unique within their entity", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(`insert into work.project (key, name_en, name_ar) values ('UNQ', 'One', 'واحد')`);
      expect(await failureOf(client, `insert into work.project (key, name_en, name_ar) values ('UNQ', 'Two', 'اثنان')`)).toContain(
        "project_key_key",
      );
    });
  });

  it("rule 10: budget periods for one agent may not overlap", async () => {
    await inRolledBackTransaction(async (client) => {
      const agent = await client.query<{ id: string }>(
        `insert into ai.agent (code, name_en, name_ar, initials) values ('r10', 'Rule ten', 'القاعدة ١٠', 'RT') returning id`,
      );
      await client.query(
        `insert into gov.agent_budget (agent_id, limit_aed, effective_from, effective_to)
         values ($1, 400, '2026-01-01Z', '2026-07-01Z')`,
        [agent.rows[0].id],
      );

      expect(
        await failureOf(
          client,
          `insert into gov.agent_budget (agent_id, limit_aed, effective_from, effective_to)
           values ($1, 500, '2026-06-01Z', '2026-12-01Z')`,
          [agent.rows[0].id],
        ),
      ).toContain("may not overlap");

      expect(
        await failureOf(
          client,
          `insert into gov.agent_budget (agent_id, limit_aed, effective_from, effective_to)
           values ($1, 500, '2026-07-01Z', '2026-12-01Z')`,
          [agent.rows[0].id],
        ),
      ).toBeNull();
    });
  });
});

async function seedRequestApproval(
  client: import("pg").PoolClient,
  projectId: string,
  requesterId: string,
): Promise<string> {
  const type = await client.query<{ id: string }>(
    `insert into work.request_type (code, name_en, name_ar) values ('APR', 'Approval fixture', 'اعتماد') returning id`,
  );
  const version = await client.query<{ id: string }>(
    `insert into work.request_type_version (request_type_id, version_number, status) values ($1, 1, 'Published') returning id`,
    [type.rows[0].id],
  );
  const request = await client.query<{ id: string }>(
    `insert into work.request (key, project_id, request_type_version_id, title_en, title_ar, requester_type, requester_id)
     values ('APR-0001', $1, $2, 'Claim', 'مطالبة', 'Person', $3) returning id`,
    [projectId, version.rows[0].id, requesterId],
  );
  const approval = await client.query<{ id: string }>(
    `insert into ai.approval (key, requested_by_type, action, request_id) values ('APR-9000', 'Agent', 'pay', $1) returning id`,
    [request.rows[0].id],
  );
  return approval.rows[0].id;
}

async function seedAgentAndTools(
  client: import("pg").PoolClient,
): Promise<{ versionId: string; t2ToolId: string; t3ToolId: string }> {
  const agent = await client.query<{ id: string }>(
    `insert into ai.agent (code, name_en, name_ar, initials) values ('tier', 'Tier fixture', 'المستوى', 'TF') returning id`,
  );
  const version = await client.query<{ id: string }>(
    `insert into ai.agent_version (agent_id, version_number) values ($1, 1) returning id`,
    [agent.rows[0].id],
  );
  const connector = await client.query<{ id: string }>(
    `insert into ai.connector (code, name_en, name_ar) values ('fix', 'Fixture', 'اختبار') returning id`,
  );
  const t2 = await client.query<{ id: string }>(
    `insert into ai.connector_tool (connector_id, name, title_en, title_ar, tier) values ($1, 'pay', 'Pay', 'دفع', 'T2') returning id`,
    [connector.rows[0].id],
  );
  const t3 = await client.query<{ id: string }>(
    `insert into ai.connector_tool (connector_id, name, title_en, title_ar, tier) values ($1, 'drop', 'Drop', 'حذف', 'T3') returning id`,
    [connector.rows[0].id],
  );
  return { versionId: version.rows[0].id, t2ToolId: t2.rows[0].id, t3ToolId: t3.rows[0].id };
}

async function seedRequestType(
  client: import("pg").PoolClient,
): Promise<{ terminalStepId: string; openStepId: string }> {
  const type = await client.query<{ id: string }>(
    `insert into work.request_type (code, name_en, name_ar) values ('TRM', 'Terminal fixture', 'نهائي') returning id`,
  );
  const version = await client.query<{ id: string }>(
    `insert into work.request_type_version (request_type_id, version_number) values ($1, 1) returning id`,
    [type.rows[0].id],
  );
  const open = await client.query<{ id: string }>(
    `insert into work.transition_step (request_type_version_id, sort_order, name_en, name_ar)
     values ($1, 1, 'Submitted', 'مُقدَّم') returning id`,
    [version.rows[0].id],
  );
  const terminal = await client.query<{ id: string }>(
    `insert into work.transition_step (request_type_version_id, sort_order, name_en, name_ar, is_terminal)
     values ($1, 2, 'Closed', 'مغلق', true) returning id`,
    [version.rows[0].id],
  );
  return { terminalStepId: terminal.rows[0].id, openStepId: open.rows[0].id };
}
