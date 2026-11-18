import { strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeTestPool, hasDatabase, testPool } from "./harness";

/**
 * `GET /api/skills/[name]/package` and `GET /api/skills/[name]/files`: a skill's package as a
 * `.zip`, and one of its files. The skill is imported for real, so its files are in the object
 * store where the import put them, and the handlers are called with a real `Request`.
 */

let signedInAs = "";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (signedInAs ? { user: { id: signedInAs } } : null),
}));

describe.skipIf(!hasDatabase)("skill package routes", () => {
  let ownerId = "";
  /** A Member, who holds no `skills:read`. */
  let memberId = "";
  const skillName = `route-package-${Date.now().toString(36)}`;
  const authored = `${skillName}-authored`;
  /** Not valid UTF-8, so a decode on the way in or out would change it. */
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
  const script = "print('hello from the skill')\n";
  let stored: string[] = [];

  beforeAll(async () => {
    const idOf = async (email: string) =>
      (await testPool().query<{ id: string }>("select id from core.person where email = $1", [email])).rows[0].id;
    ownerId = await idOf("mariam@tahseel.ae");
    memberId = await idOf("layla@tahseel.ae");

    signedInAs = ownerId;
    const { createSkill, importSkill } = await import("@/features/skills/service");
    const zip = zipSync({
      "SKILL.md": strToU8(`---\nname: ${skillName}\ndescription: Builds a deck from the brief.\n---\n\n# Deck\n\nRun scripts/build.py.\n`),
      "scripts/build.py": strToU8(script),
      "references/style.md": strToU8("Use the brand colours.\n"),
      "assets/logo.png": png,
    });
    expect(await importSkill({ zipBase64: Buffer.from(zip).toString("base64"), agentCodes: [] })).toBe(skillName);
    await createSkill({
      skillName: authored,
      titleEn: "Authored",
      titleAr: "مؤلفة",
      descriptionEn: "Has no stored package.",
      descriptionAr: "بلا حزمة مخزنة.",
      sourceType: "Authored",
      versionLabel: "0.1.0",
      tags: [],
    });
    stored = ["SKILL.md", "assets/logo.png", "references/style.md", "scripts/build.py"];
  });

  afterAll(async () => {
    const { deleteObject } = await import("@/lib/objects");
    await Promise.all(stored.map((path) => deleteObject(`skills/${skillName}/1.0.0/${path}`)));
    await testPool().query("update ai.skill set current_version_id = null where skill_name = any($1)", [[skillName, authored]]);
    await testPool().query("delete from ai.skill where skill_name = any($1)", [[skillName, authored]]);
    const { closeDatabase } = await import("@/db/client");
    await closeDatabase();
    await closeTestPool();
  });

  const zipOf = async (name: string) => {
    const { GET } = await import("@/app/api/skills/[name]/package/route");
    return GET(new Request(`http://console.awp.test/api/skills/${encodeURIComponent(name)}/package`), {
      params: Promise.resolve({ name }),
    });
  };
  const fileOf = async (name: string, query: string) => {
    const { GET } = await import("@/app/api/skills/[name]/files/route");
    return GET(new Request(`http://console.awp.test/api/skills/${encodeURIComponent(name)}/files?${query}`), {
      params: Promise.resolve({ name }),
    });
  };
  const storedBytes = async (path: string) => {
    const { getObject } = await import("@/lib/objects");
    const object = await getObject(`skills/${skillName}/1.0.0/${path}`);
    return new Uint8Array(await new Response(object!.body).arrayBuffer());
  };

  it("serves the stored package as a zip, every file under a folder named after the skill", async () => {
    signedInAs = ownerId;

    const response = await zipOf(skillName);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${skillName}-1.0.0.zip"; filename*=UTF-8''${skillName}-1.0.0.zip`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(stored.map((path) => `${skillName}/${path}`));
    for (const path of stored) expect(entries[`${skillName}/${path}`], path).toEqual(await storedBytes(path));
    expect(entries[`${skillName}/assets/logo.png`]).toEqual(png);
  });

  it("refuses the zip without skills:read, for no such skill, a bundled skill and one with no stored files", async () => {
    signedInAs = memberId;
    expect((await zipOf(skillName)).status).toBe(403);

    signedInAs = ownerId;
    const missing = await zipOf("no-such-skill-anywhere");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe("That skill does not exist.");

    const bundled = await testPool().query<{ skill_name: string }>(
      "select skill_name from ai.skill where source_type = 'Bundled' and current_version_id is not null limit 1",
    );
    const refused = await zipOf(bundled.rows[0].skill_name);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain(`packages/skills-bundled/${bundled.rows[0].skill_name}`);

    const empty = await zipOf(authored);
    expect(empty.status).toBe(404);
    expect(await empty.text()).toBe("No files are stored for this skill.");
  });

  it("lists the package's files by path, SKILL.md first, with their sizes", async () => {
    signedInAs = ownerId;
    const { listSkillFiles } = await import("@/features/skills/service");

    const files = await listSkillFiles(skillName);

    expect(files.map((file) => file.path)).toEqual(stored);
    expect(files.find((file) => file.path === "assets/logo.png")?.size).toBe(png.byteLength);
    expect(await listSkillFiles(authored)).toEqual([]);
  });

  it("serves one file: text as text, a raster image as an image, and as a download when asked", async () => {
    signedInAs = ownerId;

    const text = await fileOf(skillName, new URLSearchParams({ path: "scripts/build.py" }).toString());
    expect(text.status).toBe(200);
    expect(text.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(text.headers.get("x-content-type-options")).toBe("nosniff");
    expect(text.headers.get("content-disposition")).toBe(`inline; filename="build.py"; filename*=UTF-8''build.py`);
    expect(await text.text()).toBe(script);

    const image = await fileOf(skillName, new URLSearchParams({ path: "assets/logo.png", download: "1" }).toString());
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-disposition")).toBe(`attachment; filename="logo.png"; filename*=UTF-8''logo.png`);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
  });

  it("refuses a path that leaves the package, a file it does not have, and a reader without skills:read", async () => {
    signedInAs = ownerId;
    // Another skill's files sit beside this one's in the bucket.
    for (const path of [`../${authored}/0.1.0/SKILL.md`, "scripts/../SKILL.md", "/SKILL.md", "./SKILL.md", "scripts\\build.py", ""]) {
      const response = await fileOf(skillName, new URLSearchParams({ path }).toString());
      expect(response.status, path).toBe(400);
      expect(await response.text()).toBe("That is not a path inside the skill's package.");
    }

    expect((await fileOf(skillName, "path=scripts/missing.py")).status).toBe(404);
    expect((await fileOf("no-such-skill-anywhere", "path=SKILL.md")).status).toBe(404);

    signedInAs = memberId;
    expect((await fileOf(skillName, "path=SKILL.md")).status).toBe(403);
  });
});
