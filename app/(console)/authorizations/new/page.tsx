import { AuthorizationForm } from "@/components/authorizations/authorization-form";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/domain/permissions";
import { rulesForOrganization } from "@/lib/services/auth-rules";
import { activeMembers, listPayers, listProviders } from "@/lib/services/directory";
import { listPatients } from "@/lib/services/patients";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "New authorization" };

export default async function NewAuthorizationPage() {
  const ctx = await getRequestContext();
  const patients = listPatients(ctx, { pageSize: 100 }).items;
  const providers = listProviders(ctx);
  const payers = listPayers(ctx);
  const members = activeMembers(ctx);
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="New authorization" description="Creates a draft. The case can move to review only after the packet checklist passes." />
      <AuthorizationForm
        canAssign={can(ctx.role, "authorizations.assign")}
        authRules={rulesForOrganization(ctx)}
        patients={patients.map((patient) => ({
          id: patient.id,
          label: `${patient.lastName}, ${patient.firstName} · ${patient.mrn}`,
          memberId: patient.memberId,
          groupNumber: patient.groupNumber,
          primaryPayerId: patient.primaryPayerId,
        }))}
        providers={providers.map((provider) => ({ id: provider.id, label: provider.name }))}
        payers={payers.map((payer) => ({ id: payer.id, label: payer.name }))}
        members={members.map((member) => ({ id: member.userId, label: member.name }))}
      />
    </div>
  );
}
