import Link from "next/link";
import { PageHeader, fieldClass } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { listPayers } from "@/lib/services/directory";
import { listPatients } from "@/lib/services/patients";
import { getRequestContext } from "@/lib/services/context";
import { can } from "@/lib/domain/permissions";

export const metadata = { title: "Patients" };

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function PatientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await getRequestContext();
  const page = Number(one(params.page) || "1");
  const result = listPatients(ctx, {
    q: one(params.q),
    payerId: one(params.payerId),
    sort: (one(params.sort) || "name") as "name",
    dir: "asc",
    page,
    pageSize: 15,
  });
  const payers = listPayers(ctx);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Patients"
        description="Synthetic demographics for authorization operations."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(ctx.role, "data.import") ? <Link className={buttonVariants({ variant: "outline" })} href="/import?kind=patients">Import CSV</Link> : null}
            {can(ctx.role, "patients.write") ? <Link className={buttonVariants()} href="/patients/new">New patient</Link> : null}
          </div>
        }
      />
      <form className="flex flex-wrap gap-2" method="get">
        <Input name="q" defaultValue={one(params.q)} placeholder="Search name, MRN, member ID" aria-label="Search patients" className="max-w-sm" />
        <select name="payerId" defaultValue={one(params.payerId)} aria-label="Payer" className={fieldClass + " w-auto"}>
          <option value="">All payers</option>
          {payers.map((payer) => <option key={payer.id} value={payer.id}>{payer.name}</option>)}
        </select>
        <button className={buttonVariants({ variant: "outline" })} type="submit">Apply</button>
      </form>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>MRN</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>DOB</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead>Member ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.length === 0 ? <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No patients match.</TableCell></TableRow> : null}
            {result.items.map((patient) => (
              <TableRow key={patient.id}>
                <TableCell><Link className="text-primary" href={`/patients/${patient.id}`}>{patient.mrn}</Link></TableCell>
                <TableCell>{patient.lastName}, {patient.firstName}</TableCell>
                <TableCell>{formatDate(patient.dateOfBirth)}</TableCell>
                <TableCell>{patient.payerName}</TableCell>
                <TableCell>{patient.memberId}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-sm text-muted-foreground">Page {page} of {pages} · {result.total} patients</p>
    </div>
  );
}
