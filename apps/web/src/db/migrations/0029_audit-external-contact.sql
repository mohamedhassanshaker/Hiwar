ALTER TABLE "audit"."audit_entry" DROP CONSTRAINT "audit_entry_actor_check";--> statement-breakpoint
ALTER TABLE "audit"."audit_entry" ADD CONSTRAINT "audit_entry_actor_check" CHECK ("actor_type" in ('Person', 'Agent', 'Client', 'ExternalContact', 'System'));
