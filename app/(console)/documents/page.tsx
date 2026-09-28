import { PageHeader, fieldClass } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DOCUMENT_CATEGORIES } from "@/lib/domain/types";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/domain/labels";
import { formatBytes, formatDateTime } from "@/lib/format";
import { can } from "@/lib/domain/permissions";
import { listDocuments } from "@/lib/services/collaboration";
import { getRequestContext } from "@/lib/services/context";
import { uploadDocumentFormAction } from "@/app/actions/workflow";

export const metadata = { title: "Documents" };

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const ctx = await getRequestContext();
  const documents = listDocuments(ctx, { q: one(params.q), category: one(params.category) });
  return (
    <div className="space-y-5">
      <PageHeader title="Documents" description="Files stay private to this organization. Downloads use an authenticated route, not a public URL." />
      <form className="flex flex-wrap gap-2" method="get">
        <Input name="q" defaultValue={one(params.q)} placeholder="Search filename or case" aria-label="Search documents" />
        <select name="category" defaultValue={one(params.category)} className={fieldClass + " w-auto"} aria-label="Category">
          <option value="">All categories</option>
          {DOCUMENT_CATEGORIES.map((category) => <option key={category} value={category}>{DOCUMENT_CATEGORY_LABEL[category]}</option>)}
        </select>
        <button className={buttonVariants({ variant: "outline" })} type="submit">Apply</button>
      </form>
      {can(ctx.role, "documents.write") ? (
        <form action={uploadDocumentFormAction} className="grid gap-2 rounded-xl border bg-card p-4 md:grid-cols-4">
          <Input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.txt,.docx" aria-label="File" />
          <select name="category" className={fieldClass} defaultValue="OTHER" aria-label="Category">
            {DOCUMENT_CATEGORIES.map((category) => <option key={category} value={category}>{DOCUMENT_CATEGORY_LABEL[category]}</option>)}
          </select>
          <p className="text-xs text-muted-foreground md:col-span-2">10 MB max. PDF, PNG, JPEG, TIFF, TXT, DOCX. The server checks the file signature.</p>
          <button className={buttonVariants()} type="submit">Upload</button>
        </form>
      ) : null}
      <ul className="divide-y rounded-xl border bg-card">
        {documents.length === 0 ? <li className="p-6 text-sm text-muted-foreground">No documents match.</li> : null}
        {documents.map((document) => (
          <li key={document.id} className="flex flex-col gap-1 px-4 py-3 text-sm md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-medium">{document.filename}</p>
              <p className="text-muted-foreground">
                {DOCUMENT_CATEGORY_LABEL[document.category]} · {formatBytes(document.size)} · {document.authorizationNumber ?? "Unlinked"} · {document.patientName ?? "No patient"} · {document.uploaderName}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{formatDateTime(document.createdAt)} · {document.processingStatus}</span>
              <a className="text-primary" href={`/api/documents/${document.id}`}>Download</a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
