import { BadPackagePath, PackageStoreUnavailable, SkillMissing, SkillRejected } from "@/features/skills/errors";
import { NotPermitted } from "@/lib/session";

/** The answer to a refused read of a skill's package, or null for anything unexpected. */
export function packageRefusal(problem: unknown): Response | null {
  if (problem instanceof NotPermitted) return new Response("You may not read skills.", { status: 403 });
  if (problem instanceof SkillMissing) return new Response(problem.message, { status: 404 });
  if (problem instanceof BadPackagePath) return new Response(problem.message, { status: 400 });
  if (problem instanceof PackageStoreUnavailable) return new Response(problem.message, { status: 503 });
  if (problem instanceof SkillRejected) return new Response(problem.message, { status: 409 });
  return null;
}
