-- A connector tool is granted at the mode its tier implies: a read (T0) at Auto, anything else
-- at Approval (D264, amending D238). Grants made at Approval to a read move to Auto; a run then
-- calls the read without waiting for a person. Writes keep Approval.
UPDATE "ai"."agent_tool_mode" m
   SET "mode" = 'Auto', "updated_at" = now()
  FROM "ai"."connector_tool" t
 WHERE t."id" = m."connector_tool_id"
   AND t."tier" = 'T0'
   AND m."mode" = 'Approval';
