import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PayerDialog } from "@/components/directory/record-dialogs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/domain/permissions";
import { PAYER_TYPE_LABEL } from "@/lib/domain/labels";
import { listPayers } from "@/lib/services/directory";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Payers" };

export default async function PayersPage() {
  const ctx = await getRequestContext();
  const payers = listPayers(ctx);
  const writable = can(ctx.role, "payers.write");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Payers"
        description="Insurance plans you submit to, with their decision timeframes and appeal windows. Not connected to a live payer API."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/payers/rules" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted">Prior-auth rules</Link>
            {writable ? <Link href="/import?kind=payers" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted">Import CSV</Link> : null}
            {writable ? <PayerDialog /> : null}
          </div>
        }
      />
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Identifier</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Fax</TableHead>
              <TableHead>Website</TableHead>
              {writable ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {payers.map((payer) => (
              <TableRow key={payer.id}>
                <TableCell>
                  <p>{payer.name}</p>
                  <p className="text-xs text-muted-foreground">{payer.notes}</p>
                </TableCell>
                <TableCell>{PAYER_TYPE_LABEL[payer.type]}</TableCell>
                <TableCell>{payer.identifier}</TableCell>
                <TableCell>{payer.phone}</TableCell>
                <TableCell>{payer.fax}</TableCell>
                <TableCell>{payer.website}</TableCell>
                {writable ? <TableCell><PayerDialog id={payer.id} label="Edit" values={{ ...payer, website: payer.website }} /></TableCell> : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
