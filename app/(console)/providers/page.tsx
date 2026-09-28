import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ProviderDialog } from "@/components/directory/record-dialogs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/domain/permissions";
import { listProviders } from "@/lib/services/directory";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Providers" };

export default async function ProvidersPage() {
  const ctx = await getRequestContext();
  const providers = listProviders(ctx);
  const writable = can(ctx.role, "providers.write");
  return (
    <div className="space-y-5">
      <PageHeader
        title="Providers"
        description="Ordering and rendering clinicians. NPIs are checked for a valid check digit."
        actions={
          writable ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/import?kind=providers" className="inline-flex h-8 items-center rounded-lg border px-3 text-sm hover:bg-muted">Import CSV</Link>
              <ProviderDialog />
            </div>
          ) : null
        }
      />
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>NPI placeholder</TableHead>
              <TableHead>Specialty</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Organization</TableHead>
              {writable ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {providers.map((provider) => (
              <TableRow key={provider.id}>
                <TableCell>{provider.name}</TableCell>
                <TableCell>{provider.npi}</TableCell>
                <TableCell>{provider.specialty}</TableCell>
                <TableCell>{provider.phone}</TableCell>
                <TableCell>{provider.email}</TableCell>
                <TableCell>{provider.status}</TableCell>
                <TableCell>{provider.organizationName}</TableCell>
                {writable ? (
                  <TableCell>
                    <ProviderDialog id={provider.id} label="Edit" values={provider} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
