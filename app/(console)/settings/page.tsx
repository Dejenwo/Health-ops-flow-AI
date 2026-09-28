import { PageHeader } from "@/components/page-header";
import { OrganizationForm } from "@/components/settings/forms";
import { can } from "@/lib/domain/permissions";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage() {
  const ctx = await getRequestContext();
  return (
    <div className="space-y-5">
      <PageHeader title="Organization" description={ctx.organization.synthetic ? "This organization is marked synthetic." : "Organization profile."} />
      <OrganizationForm
        disabled={!can(ctx.role, "org.update")}
        values={{
          name: ctx.organization.name,
          type: ctx.organization.type,
          specialty: ctx.organization.specialty,
          providerCount: ctx.organization.providerCount,
        }}
      />
    </div>
  );
}
