-- A list attribute's choices carry a label in each language, as the attribute contract
-- declares (`{value, labelEn, labelAr}`), and an attribute may belong to one step rather than
-- to the request form (D304). An existing choice keeps its text as its value and both labels.
ALTER TABLE "work"."attribute_definition" ADD COLUMN "enum_values_json" jsonb;
--> statement-breakpoint
UPDATE "work"."attribute_definition" a
   SET "enum_values_json" = (
     SELECT jsonb_agg(jsonb_build_object('value', v, 'labelEn', v, 'labelAr', v) ORDER BY n)
       FROM unnest(a."enum_values") WITH ORDINALITY AS u(v, n)
   )
 WHERE a."enum_values" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "work"."attribute_definition" DROP COLUMN "enum_values";
--> statement-breakpoint
ALTER TABLE "work"."attribute_definition" RENAME COLUMN "enum_values_json" TO "enum_values";
--> statement-breakpoint
ALTER TABLE "work"."attribute_definition" ADD CONSTRAINT "attribute_definition_enum_values_check"
  CHECK ("enum_values" IS NULL OR jsonb_typeof("enum_values") = 'array');
--> statement-breakpoint
-- Null is the request form. A deleted step's attributes go back to the form rather than
-- disappearing with it.
ALTER TABLE "work"."attribute_definition" ADD COLUMN "step_id" uuid;
--> statement-breakpoint
ALTER TABLE "work"."attribute_definition" ADD CONSTRAINT "attribute_definition_step_id_transition_step_id_fk"
  FOREIGN KEY ("step_id") REFERENCES "work"."transition_step"("id") ON DELETE set null ON UPDATE no action;
