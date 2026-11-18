-- The role a widget's service account holds (D221): start the agent and search knowledge, and
-- nothing else, under the id the seed gives it. The permission sync that runs with the
-- migrations grants its permissions.
INSERT INTO "core"."role" ("id", "code", "name_en", "name_ar", "is_system")
VALUES ('802bc159-7eb0-5c5d-9028-129a230192b3', 'WidgetVisitor', 'Widget visitor', 'زائر الويدجت', true)
ON CONFLICT ("code") DO NOTHING;
