import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthorizationForm } from "@/components/authorizations/authorization-form";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/domain/permissions";
import { rulesForOrganization } from "@/lib/services/auth-rules";
import { getAuthorizationWorkspace, recordAuthorizationView } from "@/lib/services/authorizations";
import { activeMembers, listPayers, listProviders } from "@/lib/services/directory";
import { listPatients } from "@/lib/services/patients";
import { getRequestContext } from "@/lib/services/context";

export default async function EditAuthorizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getRequestContext();
  const data = getAuthorizationWorkspace(ctx, id);
  if (!data) notFound();
  recordAuthorizationView(ctx, id);
  const auth = data.authorization;
  if (data.locked) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <PageHeader title={`${auth.authorizationNumber} is locked`} description="This request has been submitted to the payer, so its contents can no longer be edited." />
        <p className="text-sm text-muted-foreground">
          Use Reschedule on the case to change the service date, or Start replacement request to file an amended request.
        </p>
        <Link href={`/authorizations/${auth.id}`} className="text-sm text-primary">Back to the case</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Edit ${auth.authorizationNumber}`} description="Status changes stay on the case workspace so they pass through the state machine." />
      <AuthorizationForm
        id={auth.id}
        canAssign={can(ctx.role, "authorizations.assign")}
        authRules={rulesForOrganization(ctx)}
        values={{
          patientId: auth.patientId,
          providerId: auth.providerId,
          renderingProviderId: auth.renderingProviderId ?? "",
          payerId: auth.payerId,
          memberId: auth.memberId,
          groupNumber: auth.groupNumber,
          procedure: auth.procedure,
          lines: auth.lines.map((line) => ({
            id: line.id,
            codeType: line.codeType,
            code: line.code,
            modifiers: line.modifiers.join(" "),
            description: line.description,
            requestedUnits: line.requestedUnits,
            unitType: line.unitType,
          })),
          diagnoses: auth.diagnoses,
          placeOfService: auth.placeOfService || "11",
          siteOfCare: auth.siteOfCare,
          facilityName: auth.facilityName,
          requestedServiceDate: auth.requestedServiceDate,
          priority: auth.priority,
          reviewType: auth.reviewType,
          clinicalReason: auth.clinicalReason,
          assignedUserId: auth.assignedUserId ?? "",
          internalNotes: auth.internalNotes,
        }}
        patients={listPatients(ctx, { pageSize: 100 }).items.map((patient) => ({ id: patient.id, label: `${patient.lastName}, ${patient.firstName} · ${patient.mrn}` }))}
        providers={listProviders(ctx).map((provider) => ({ id: provider.id, label: provider.name }))}
        payers={listPayers(ctx).map((payer) => ({ id: payer.id, label: payer.name }))}
        members={activeMembers(ctx).map((member) => ({ id: member.userId, label: member.name }))}
      />
    </div>
  );
}
