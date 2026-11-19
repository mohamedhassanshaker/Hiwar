import { requirePermission } from "@/lib/session";
import * as repository from "./repository";

export { ModelsRejected } from "./errors";
export {
  setProviderActive,
  testConnection,
  testConnectionDraft,
  discoverEngineModels,
  addCustomProvider,
  addCloudProvider,
  removeConnection,
  removeProvider,
  saveConnection,
} from "./provider-service";
export { saveRoute, removeRoute, republishRoutes } from "./route-service";

/** S-59 the providers and their connections, S-60 the routes. */

export async function loadModels() {
  await requirePermission("models:read");
  const [providers, routes] = await Promise.all([repository.listProviders(), repository.listRoutes()]);
  return { providers, routes };
}
