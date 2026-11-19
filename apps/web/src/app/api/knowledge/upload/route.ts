import { handle, Refused } from "@/server/api";
import { addFile, reprocess } from "@/server/knowledge";
import { apiMember } from "@/server/session";

/** Uploads one or more files (KNO-001 FR-006, FR-010), or replaces one when `sourceId` is set. */
export const POST = handle(async (request: Request) => {
  const member = await apiMember("manage_agents", { write: true });
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new Refused("Choose at least one file.");
  const sourceId = form.get("sourceId");
  if (typeof sourceId === "string" && sourceId) {
    await reprocess(member, sourceId, files[0]);
    return { ok: true };
  }
  const refused: string[] = [];
  for (const file of files) {
    try {
      await addFile(member, file);
    } catch (problem) {
      if (problem instanceof Refused) refused.push(problem.message);
      else throw problem;
    }
  }
  if (refused.length) throw new Refused(refused.join(" "), 422);
  return { ok: true };
});
