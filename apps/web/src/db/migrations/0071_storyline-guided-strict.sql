-- A storyline runs Guided or Strict (D339). Free and List storylines, and steps whose own phase
-- mode is Free or List, become Guided, which offers the script and has the agent answer anything
-- else, as Free did.
UPDATE "ai"."storyline_version" SET "mode" = 'Guided' WHERE "mode" IN ('Free', 'List');
--> statement-breakpoint
UPDATE "ai"."storyline_step" SET "config_json" = "config_json" - 'mode' WHERE "config_json"->>'mode' IN ('Free', 'List');
--> statement-breakpoint
ALTER TABLE "ai"."storyline_version" DROP CONSTRAINT "storyline_version_mode_check";
--> statement-breakpoint
ALTER TABLE "ai"."storyline_version" ADD CONSTRAINT "storyline_version_mode_check" CHECK ("mode" in ('Guided', 'Strict'));
--> statement-breakpoint
-- Form fields stored as {slot, label, options} before step configs were checked (D336) had no
-- key or label the widget reads, so every input showed no label and typing filled all of them.
-- Each becomes the form field shape: the slot is its key, the label its English label (the
-- Arabic falls back to it), Text, not required, and its options its choices.
UPDATE "ai"."storyline_step" st
   SET "config_json" = jsonb_set(st."config_json", '{formFields}', (
     SELECT jsonb_agg(
              CASE WHEN f ? 'key' THEN f ELSE jsonb_strip_nulls(jsonb_build_object(
                'key', coalesce(f->>'slot', f->>'name', 'field_' || ord),
                'labelEn', coalesce(f->>'labelEn', f->>'label', f->>'slot', f->>'name', 'Field ' || ord),
                'labelAr', coalesce(f->>'labelAr', ''),
                'dataType', coalesce(f->>'dataType', 'Text'),
                'required', coalesce((f->>'required')::boolean, false),
                'choices', CASE WHEN jsonb_typeof(f->'options') = 'array' THEN
                  (SELECT jsonb_agg(jsonb_build_object('value', o, 'en', o, 'ar', o)) FROM jsonb_array_elements_text(f->'options') o)
                END
              )) END
              ORDER BY ord)
       FROM jsonb_array_elements(st."config_json"->'formFields') WITH ORDINALITY AS e(f, ord)))
 WHERE jsonb_typeof(st."config_json"->'formFields') = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(st."config_json"->'formFields') f WHERE NOT f ? 'key');
