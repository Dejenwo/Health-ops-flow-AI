import { PageHeader } from "@/components/page-header";
import { IntegrationGrid } from "@/components/integrations/integration-grid";
import { can } from "@/lib/domain/permissions";
import { listIntegrationCards } from "@/lib/services/admin";
import { getRequestContext } from "@/lib/services/context";
import { getIntegrationOverview } from "@/lib/services/integrations";
import { ClearinghousePanel } from "@/components/integrations/clearinghouse-panel";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await getRequestContext();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Integrations"
        description="Connect HealthFlow to the systems your practice already uses."
      />
      {can(ctx.role, "integrations.manage") ? <ClearinghousePanel overview={getIntegrationOverview(ctx)} /> : null}
      <h2 className="pt-2 font-semibold">More integrations</h2>
      <p className="-mt-3 text-sm text-muted-foreground">Not live yet. Requesting one tells us your organization needs it.</p>
      <IntegrationGrid items={listIntegrationCards(ctx)} canRequest={can(ctx.role, "integrations.manage")} />
    </div>
  );
}
