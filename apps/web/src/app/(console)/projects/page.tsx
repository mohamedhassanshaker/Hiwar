import { Projects } from "@/features/projects/components/projects";
import { loadProjects } from "@/features/projects/service";

/** S-20 and S-21: the projects the signed-in person may see. */
export default async function Page() {
  return <Projects {...(await loadProjects())} />;
}
