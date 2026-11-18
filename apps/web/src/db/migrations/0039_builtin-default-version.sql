UPDATE "ai"."agent" SET "default_version" = 1 WHERE "is_builtin" AND "default_version" IS NULL;
