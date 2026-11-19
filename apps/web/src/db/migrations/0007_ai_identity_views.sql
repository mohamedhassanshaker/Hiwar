-- The module's raw SQL also reads core.org_unit and the reporting-line columns of core.person.
-- In Hiwar an org unit is a customer organization, and nobody reports to an agent.
CREATE OR REPLACE VIEW core.org_unit AS
SELECT o.id, o.name AS name_en, o.name AS name_ar, NULL::uuid AS parent_org_unit_id
FROM public.organizations o;
--> statement-breakpoint
DROP VIEW core.person;
--> statement-breakpoint
CREATE VIEW core.person AS
SELECT
  u.id,
  u.email,
  u.name AS name_en,
  u.name AS name_ar,
  CASE WHEN u.platform_role IS NULL THEN 'Inactive' ELSE 'Active' END AS status,
  'en'::text AS preferred_language,
  NULL::text AS reports_to_type,
  NULL::uuid AS reports_to_id
FROM public.users u;
