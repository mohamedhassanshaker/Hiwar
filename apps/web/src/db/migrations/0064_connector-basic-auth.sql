-- A connector may authenticate with a user name and password (D296).
ALTER TABLE "ai"."connector" DROP CONSTRAINT "connector_auth_check";
--> statement-breakpoint
ALTER TABLE "ai"."connector" ADD CONSTRAINT "connector_auth_check"
  CHECK ("auth_type" IN ('OAuth', 'ClientCredentials', 'Bearer', 'ApiKey', 'Basic', 'None'));
--> statement-breakpoint
ALTER TABLE "ai"."connector_catalog_entry" DROP CONSTRAINT "connector_catalog_auth_check";
--> statement-breakpoint
ALTER TABLE "ai"."connector_catalog_entry" ADD CONSTRAINT "connector_catalog_auth_check"
  CHECK ("auth_type" IN ('OAuth', 'ClientCredentials', 'Bearer', 'ApiKey', 'Basic', 'None'));
--> statement-breakpoint
-- A remote MCP connector's credential is now sent (D296). One with none stored, or labelled OAuth
-- before sign-in existed, never sent any: it keeps working as it did, with no authentication.
UPDATE "ai"."connector" SET "auth_type" = 'None', "secret_ref" = NULL
 WHERE "transport" = 'StreamableHttp' AND "auth_type" <> 'None'
   AND ("secret_ref" IS NULL OR "auth_type" = 'OAuth');
