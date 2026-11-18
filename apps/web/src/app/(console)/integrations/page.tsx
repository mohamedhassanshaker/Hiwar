import { Integrations } from "@/features/integrations/components/integrations";
import { loadIntegrations } from "@/features/integrations/service";

/** S-76 and S-77: the external clients and what each may do. */
export default async function Page() {
  const { clients, details, base, tools, permissions } = await loadIntegrations();
  return <Integrations clients={clients} details={details} base={base} tools={tools} permissions={permissions} />;
}
