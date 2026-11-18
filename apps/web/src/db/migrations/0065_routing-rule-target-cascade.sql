-- A rule whose target step is deleted routes nowhere, so it is deleted with the step (D301).
-- Left as no action, deleting a version's steps was refused or not depending on the order the
-- rows were visited in.
ALTER TABLE "work"."routing_rule" DROP CONSTRAINT "routing_rule_to_step_id_transition_step_id_fk";
--> statement-breakpoint
ALTER TABLE "work"."routing_rule" ADD CONSTRAINT "routing_rule_to_step_id_transition_step_id_fk"
  FOREIGN KEY ("to_step_id") REFERENCES "work"."transition_step"("id") ON DELETE cascade ON UPDATE no action;
