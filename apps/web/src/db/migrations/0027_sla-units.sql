ALTER TABLE "work"."request_type_version" DROP CONSTRAINT "request_type_version_sla_unit_check";--> statement-breakpoint
ALTER TABLE "work"."request_type_version" ADD CONSTRAINT "request_type_version_sla_unit_check" CHECK ("sla_unit" is null or "sla_unit" in ('Minutes', 'Hours', 'Days', 'BusinessDays'));--> statement-breakpoint
ALTER TABLE "work"."transition_step" DROP CONSTRAINT "transition_step_sla_unit_check";--> statement-breakpoint
ALTER TABLE "work"."transition_step" ADD CONSTRAINT "transition_step_sla_unit_check" CHECK ("sla_unit" is null or "sla_unit" in ('Minutes', 'Hours', 'Days', 'BusinessDays'));
