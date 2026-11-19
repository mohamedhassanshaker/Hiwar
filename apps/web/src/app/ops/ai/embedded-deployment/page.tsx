import { Deployments } from "@/features/engage/components/deployments";
import { FeatureOff } from "@/components/shared/feature-off";
import { loadDeployments } from "@/features/engage/service";

/** S-62 to S-65: the embedded deployments, their storylines and the widget preview. */
export default async function Page() {
  const { enabled, deployments, extras, agentOptions } = await loadDeployments();
  // `UC-62.1-04`: with the feature off the screen says so rather than showing an empty list.
  if (!enabled) return <FeatureOff feature="Embedded deployments" featureAr="النشر المضمّن" />;
  return <Deployments deployments={deployments} extras={extras} agentOptions={agentOptions} />;
}
