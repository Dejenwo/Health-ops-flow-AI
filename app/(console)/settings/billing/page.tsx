import { PageHeader } from "@/components/page-header";
import { PlanPicker } from "@/components/settings/forms";
import { can } from "@/lib/domain/permissions";
import { getSubscription } from "@/lib/services/admin";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const ctx = await getRequestContext();
  if (!can(ctx.role, "billing.read")) {
    return <p className="text-sm text-muted-foreground">Your role cannot view billing.</p>;
  }
  const billing = getSubscription(ctx);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing"
        description={`Current plan: ${billing.plan.name}. Status: ${billing.subscription?.status ?? "none"}. ${billing.stripeConfigured ? "Stripe key detected." : "Stripe is not configured, so plan changes stay in demo mode."}`}
      />
      {can(ctx.role, "billing.manage") ? <PlanPicker current={billing.subscription?.plan ?? "STARTER"} /> : <p className="text-sm">Ask an owner or admin to change plans.</p>}
    </div>
  );
}
