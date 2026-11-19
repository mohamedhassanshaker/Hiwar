import { Models } from "@/features/models/components/models";
import { loadModels } from "@/features/models/service";

/** S-59 and S-60: the model providers, their connections and the routes. */
export default async function Page() {
  const { providers, routes } = await loadModels();
  return <Models providers={providers} routes={routes} />;
}
