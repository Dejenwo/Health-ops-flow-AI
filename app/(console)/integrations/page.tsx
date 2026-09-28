import { PageHeader } from "@/components/page-header";
import { IntegrationGrid } from "@/components/integrations/integration-grid";
import { can } from "@/lib/domain/permissions";
import { listIntegrationCards } from "@/lib/services/admin";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await getRequestContext();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        description="None of these are live. A request records interest for your organization and does not exchange data."
      />
      <IntegrationGrid items={listIntegrationCards(ctx)} canRequest={can(ctx.role, "integrations.manage")} />
    </div>
  );
}
