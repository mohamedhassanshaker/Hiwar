import { Skills } from "@/features/skills/components/skills";
import { loadSkills } from "@/features/skills/service";

/** S-53: the skills the organisation has installed, authored or bundled. */
export default async function Page() {
  const { skills, details } = await loadSkills();
  return <Skills skills={skills} details={details} />;
}
