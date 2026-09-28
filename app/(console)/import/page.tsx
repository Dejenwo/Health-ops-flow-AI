import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "@/components/imports/import-wizard";
import { can } from "@/lib/domain/permissions";
import { getRequestContext } from "@/lib/services/context";
import { IMPORT_KINDS, templateCsv, type ImportKind } from "@/lib/services/imports";

export const metadata = { title: "Import data" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const ctx = await getRequestContext();
  if (!can(ctx.role, "data.import")) {
    return <PageHeader title="Import data" description="Only owners, admins and managers can import data. Ask one of them to run the import." />;
  }
  const { kind } = await searchParams;
  const initialKind = (IMPORT_KINDS as readonly string[]).includes(kind ?? "") ? (kind as ImportKind) : "payers";
  const templates = Object.fromEntries(IMPORT_KINDS.map((item) => [item, templateCsv(item)])) as Record<ImportKind, string>;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Import data"
        description="Load payers, providers, patients and payer prior-auth rules from a CSV export. Import payers first, since patients and rules refer to them."
      />
      <ImportWizard templates={templates} initialKind={initialKind} />
    </div>
  );
}
