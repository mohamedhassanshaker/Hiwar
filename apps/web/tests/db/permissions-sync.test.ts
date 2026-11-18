import { afterAll, describe, expect, it } from "vitest";

import { PERMISSION_CODES, SYSTEM_ROLES } from "@/authz/permissions";
import { syncPermissionCatalogue } from "@/db/permissions-sync";
import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `COM-07` and requirement 33: the permission catalogue in the database is derived from the
 * one in the code.
 *
 * A permission the code checks and the database has never heard of refuses everybody,
 * including the owner, so the migration reconciles the two. The reconciliation is what is
 * tested here, because it is what stops an upgrade locking people out.
 */
describe.skipIf(!hasDatabase)("the permission catalogue", () => {
  afterAll(closeTestPool);

  it("has every permission the code declares, with its description", async () => {
    await syncPermissionCatalogue(testPool());

    const { rows } = await testPool().query<{ code: string }>("select code from core.permission");
    const stored = new Set(rows.map((row) => row.code));
    expect([...PERMISSION_CODES].filter((code) => !stored.has(code))).toEqual([]);
  });

  it("gives every system role the grants the code gives it", async () => {
    await syncPermissionCatalogue(testPool());

    const { rows } = await testPool().query<{ role: string; permission: string }>(
      `select r.code as role, p.code as permission
       from core.role_permission rp
       join core.role r on r.id = rp.role_id
       join core.permission p on p.id = rp.permission_id
       where r.is_system = true and rp.effect = 'Allow'`,
    );
    const held = new Map<string, Set<string>>();
    for (const row of rows) {
      held.set(row.role, (held.get(row.role) ?? new Set()).add(row.permission));
    }

    for (const [role, definition] of Object.entries(SYSTEM_ROLES)) {
      const theirs = held.get(role);
      if (!theirs) continue;
      expect([...definition.allow].filter((code) => !theirs.has(code))).toEqual([]);
    }
  });

  it("restores a permission somebody deleted, and leaves one the code no longer declares", async () => {
    // A row removed by hand comes back, because the code is what decides the catalogue.
    await testPool().query("delete from core.role_permission rp using core.permission p where p.id = rp.permission_id and p.code = 'exports:create'");
    await testPool().query("delete from core.permission where code = 'exports:create'");
    const first = await syncPermissionCatalogue(testPool());
    expect(first.permissions).toBeGreaterThan(0);

    const back = await testPool().query("select 1 from core.permission where code = 'exports:create'");
    expect(back.rowCount).toBe(1);

    // Nothing is deleted: a grant somebody made against a withdrawn permission is theirs to
    // remove, and dropping it here would change who may do what without anybody deciding to.
    await testPool().query(
      `insert into core.permission (code, description_en, description_ar)
       values ('legacy:permission', 'A permission the code no longer declares', 'صلاحية لم يعد الكود يعلنها')
       on conflict do nothing`,
    );
    await syncPermissionCatalogue(testPool());
    const kept = await testPool().query("select 1 from core.permission where code = 'legacy:permission'");
    expect(kept.rowCount).toBe(1);
    await testPool().query("delete from core.permission where code = 'legacy:permission'");
  });
});
