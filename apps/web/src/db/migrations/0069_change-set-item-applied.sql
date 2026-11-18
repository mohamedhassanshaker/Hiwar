-- UC-70.2-06: when each item of a change set was applied and is still in place, which a rollback
-- undoes in reverse order and clears, so a retried rollback skips what it already undid.
ALTER TABLE "gov"."change_set_item" ADD COLUMN "applied_at" timestamp with time zone;
