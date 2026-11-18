-- D387: sign-in is the built-in password or UAE PASS; single sign-on through an OIDC provider
-- is gone. A person's password hash has a table of its own so no read of `person` carries it;
-- a Forgot password link is stored by its hash only. The Emirates ID links a UAE PASS account
-- to the person, and a session records how it was opened so Log out can end UAE PASS's too.
CREATE TABLE "core"."person_credential" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."person_credential" ADD CONSTRAINT "person_credential_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "core"."password_reset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."password_reset" ADD CONSTRAINT "password_reset_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."person"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token" ON "core"."password_reset" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "password_reset_person" ON "core"."password_reset" USING btree ("person_id");
--> statement-breakpoint
ALTER TABLE "core"."person" ADD COLUMN "emirates_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "person_emirates_id_key" ON "core"."person" USING btree ("emirates_id");
--> statement-breakpoint
ALTER TABLE "core"."person" ADD CONSTRAINT "person_emirates_id_check" CHECK (emirates_id is null or emirates_id ~ '^784[0-9]{12}$');
--> statement-breakpoint
ALTER TABLE "core"."person" ALTER COLUMN "sign_in_method" SET DEFAULT 'Password';
--> statement-breakpoint
ALTER TABLE "core"."auth_session" ADD COLUMN "sign_in_method" text;
