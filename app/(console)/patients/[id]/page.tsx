import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/domain/permissions";
import { DOCUMENT_CATEGORY_LABEL, SEX_LABEL } from "@/lib/domain/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { getPatientDetail, recordPatientView } from "@/lib/services/patients";
import { getRequestContext } from "@/lib/services/context";

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getRequestContext();
  const detail = getPatientDetail(ctx, id);
  if (!detail) notFound();
  recordPatientView(ctx, id);
  const { patient } = detail;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={patient.mrn}
        title={`${patient.lastName}, ${patient.firstName}`}
        description={`${SEX_LABEL[patient.sex]} · DOB ${formatDate(patient.dateOfBirth)}`}
        actions={can(ctx.role, "patients.write") ? <Link className={buttonVariants({ variant: "outline" })} href={`/patients/${patient.id}/edit`}>Edit</Link> : null}
      />
      <Tabs defaultValue="demographics">
        <TabsList>
          <TabsTrigger value="demographics">Demographics</TabsTrigger>
          <TabsTrigger value="insurance">Insurance</TabsTrigger>
          <TabsTrigger value="authorizations">Authorizations</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="demographics" className="mt-4 text-sm">
          <p>{patient.address}</p>
          <p>{patient.city}, {patient.state} {patient.zip}</p>
          <p>{patient.phone}</p>
          <p>{patient.email}</p>
        </TabsContent>
        <TabsContent value="insurance" className="mt-4 text-sm">
          <p>Payer: {detail.payer?.name ?? "None"}</p>
          <p>Member ID: {patient.memberId || "—"}</p>
          <p>Group: {patient.groupNumber || "—"}</p>
          <p className="text-muted-foreground">Demo payer records are not live integrations.</p>
        </TabsContent>
        <TabsContent value="authorizations" className="mt-4 space-y-2">
          {detail.authorizations.map((item) => (
            <Link key={item.id} href={`/authorizations/${item.id}`} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span>{item.authorizationNumber} · {item.procedure}</span>
              <StatusBadge status={item.status} />
            </Link>
          ))}
        </TabsContent>
        <TabsContent value="documents" className="mt-4 space-y-2 text-sm">
          {detail.documents.map((document) => (
            <div key={document.id} className="flex justify-between rounded-lg border px-3 py-2">
              <span>{document.filename} · {DOCUMENT_CATEGORY_LABEL[document.category]}</span>
              <a className="text-primary" href={`/api/documents/${document.id}`}>Download</a>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="activity" className="mt-4 space-y-2 text-sm">
          {detail.activity.map((item) => (
            <p key={item.id}>{item.summary} <span className="text-muted-foreground">{formatDateTime(item.createdAt)}</span></p>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
