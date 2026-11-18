import type { Pool } from "pg";

import { PERMISSIONS, PERMISSION_CODES, SYSTEM_ROLES, type PermissionCode } from "../authz/permissions.js";

/**
 * Reconciles `core.permission` and the system roles' grants from the code that defines them.
 *
 * The permission catalogue is declared in `@/authz/permissions`, and every check in the
 * platform reads it. The database holds the same catalogue so a grant can point at a row,
 * which makes the rows derived data: a permission added to the code and missing from the
 * database is one that refuses everybody, including the owner who has every permission.
 *
 * Run as part of the migration, so an upgraded installation has the catalogue the code it
 * is running expects. Nothing is deleted: a permission withdrawn from the code may still
 * be named by a grant somebody made, and dropping it silently would widen or narrow access
 * without anybody deciding to.
 */
export async function syncPermissionCatalogue(pool: Pool): Promise<{ permissions: number; grants: number }> {
  const descriptions = PERMISSION_CODES.map((code) => [code, PERMISSIONS[code].en, PERMISSIONS[code].ar]);

  const added = await pool.query<{ code: string }>(
    `insert into core.permission (code, description_en, description_ar)
     select value->>0, value->>1, value->>2 from jsonb_array_elements($1::jsonb) as value
     on conflict (code) do update
       set description_en = excluded.description_en, description_ar = excluded.description_ar
     returning code`,
    [JSON.stringify(descriptions)],
  );

  const grants = Object.entries(SYSTEM_ROLES).flatMap(([roleCode, role]) =>
    (role.allow as readonly PermissionCode[]).map((permission) => [roleCode, permission]),
  );

  const granted = await pool.query<{ role_id: string }>(
    `insert into core.role_permission (role_id, permission_id, effect)
     select r.id, p.id, 'Allow'
     from jsonb_array_elements($1::jsonb) as value
     join core.role r on r.code = value->>0
     join core.permission p on p.code = value->>1
     where r.is_system = true
     on conflict (role_id, permission_id) do nothing
     returning role_id`,
    [JSON.stringify(grants)],
  );

  return { permissions: added.rowCount ?? 0, grants: granted.rowCount ?? 0 };
}
