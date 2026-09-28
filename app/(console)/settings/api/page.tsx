import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/domain/permissions";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "API" };

export default async function ApiSettingsPage() {
  const ctx = await getRequestContext();
  const allowed = can(ctx.role, "api.manage");
  return (
    <div className="space-y-4">
      <PageHeader title="API" description="Organization API keys are not issued in this MVP." />
      <p className="max-w-2xl text-sm text-muted-foreground">
        {allowed
          ? "A future REST API will be organization-scoped and authenticated. This screen does not generate a secret, and no public API is listening."
          : "Your role cannot manage API credentials."}
      </p>
    </div>
  );
}
