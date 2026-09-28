import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RulesManager } from "@/components/imports/rules-manager";
import { can } from "@/lib/domain/permissions";
import { listAuthRules } from "@/lib/services/auth-rules";
import { getRequestContext } from "@/lib/services/context";
import { listPayers } from "@/lib/services/directory";

export const metadata = { title: "Prior-auth rules" };

export default async function PayerRulesPage() {
  const ctx = await getRequestContext();
  const payers = listPayers(ctx).map((payer) => ({ id: payer.id, name: payer.name }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Prior-auth rules"
        description="Your record of which codes each payer requires prior authorization for. New requests are checked against it. Codes with no rule are flagged for someone to confirm."
        actions={
          can(ctx.role, "data.import") ? (
            <Link href="/import?kind=authRules" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted">Import rules</Link>
          ) : null
        }
      />
      <RulesManager rules={listAuthRules(ctx)} payers={payers} writable={can(ctx.role, "authRules.write")} />
      <p className="text-xs text-muted-foreground">
        Payer policies change. Record where each rule came from and when it was checked, and review rules regularly. A rule here is a working aid, not a coverage determination.
      </p>
    </div>
  );
}
