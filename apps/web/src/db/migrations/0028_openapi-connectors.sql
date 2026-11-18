ALTER TABLE "ai"."connector" DROP CONSTRAINT "connector_transport_check";--> statement-breakpoint
ALTER TABLE "ai"."connector" ADD CONSTRAINT "connector_transport_check" CHECK ("transport" in ('StreamableHttp', 'Stdio', 'OpenApi'));--> statement-breakpoint
ALTER TABLE "ai"."connector" DROP CONSTRAINT "connector_auth_check";--> statement-breakpoint
ALTER TABLE "ai"."connector" ADD CONSTRAINT "connector_auth_check" CHECK ("auth_type" in ('OAuth', 'ClientCredentials', 'Bearer', 'ApiKey', 'None'));--> statement-breakpoint
ALTER TABLE "ai"."connector_tool" ADD COLUMN "operation" jsonb;--> statement-breakpoint
ALTER TABLE "ai"."connector_tool" ADD CONSTRAINT "connector_tool_operation_check" CHECK ("operation" is null or jsonb_typeof("operation") = 'object');
