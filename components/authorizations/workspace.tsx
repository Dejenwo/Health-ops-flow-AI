"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "cn";
import { AiDisclaimer, PriorityBadge, StatusBadge, TaskStatusBadge } from "@/components/status-badge";
import { CaseAlerts, DetailCard, PacketChecklist, StageTracker, type ChecklistItem } from "@/components/authorizations/case-panels";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown, CircleSlash, Loader2, MinusCircle, Pencil, Upload } from "lucide-react";
import type { CaseAlert } from "@/lib/domain/sla";
import type { EligibilityCheck, PayerAuthRule } from "@/lib/domain/types";
import { EligibilityCard } from "@/components/authorizations/eligibility-card";
import { authRequirement } from "@/lib/domain/auth-rules";
import { RequirementBadge } from "@/components/imports/requirement-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fieldClass } from "@/components/page-header";
import {
  analyzeAction,
  assignAction,
  attachLetterAction,
  decisionAction,
  followupDraftAction,
  noteAction,
  payerResponseAction,
  peerToPeerAction,
  rescheduleAction,
  supersedeAction,
  taskAction,
  transitionAction,
  uploadDocumentAction,
} from "@/app/actions/workflow";
import {
  DECISION_OUTCOMES,
  DENIAL_REASONS,
  DOCUMENT_CATEGORIES,
  PEER_TO_PEER_STATUSES,
  PRIORITIES,
  type AiAnalysis,
  type AuthStatus,
  type DecisionOutcome,
} from "@/lib/domain/types";
import {
  DENIAL_REASON_LABEL,
  DOCUMENT_CATEGORY_LABEL,
  LINE_DECISION_LABEL,
  PEER_TO_PEER_LABEL,
  PRIORITY_LABEL,
  REVIEW_TYPE_LABEL,
  SITE_OF_CARE_LABEL,
  STATUS_LABEL,
  UNIT_TYPE_LABEL,
} from "@/lib/domain/labels";
import { PLACE_OF_SERVICE } from "@/lib/domain/codes";
import { canRecordDecision, nextStatuses, TERMINAL_STATUSES } from "@/lib/domain/transitions";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import type { getAuthorizationWorkspace } from "@/lib/services/authorizations";

type Workspace = NonNullable<ReturnType<typeof getAuthorizationWorkspace>>;

function isAnalysis(value: unknown): value is AiAnalysis {
  return typeof value === "object" && value !== null && "caseSummary" in value;
}

/** Dialogs stay centered on phones, use the full width and scroll when tall. */
const SHEET = "sm:max-w-lg max-sm:max-h-[85vh] max-sm:overflow-y-auto";

export function AuthorizationWorkspace({
  data,
  members,
  canWrite,
  canAssign,
  canTransition,
  canAi,
  authRules = [],
  eligibility = [],
  eligibilityAvailable = false,
}: {
  authRules?: PayerAuthRule[];
  eligibility?: EligibilityCheck[];
  eligibilityAvailable?: boolean;
  data: Workspace;
  members: { id: string; label: string }[];
  canWrite: boolean;
  canAssign: boolean;
  canTransition: boolean;
  canAi: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string | null>(null);
  const [preset, setPreset] = useState<AuthStatus | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState("overview");
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const auth = data.authorization;
  const allowed = nextStatuses(auth.status);
  const decisionOpen = canRecordDecision(auth.status);
  const terminal = TERMINAL_STATUSES.has(auth.status);
  const letters = data.documents.filter((document) => document.category === "PAYER_CORRESPONDENCE");
  const p2pAllowed = ["PENDING", "SUBMITTED", "ADDITIONAL_INFORMATION_REQUESTED", "DENIED", "PARTIALLY_APPROVED", "APPEALED"].includes(auth.status);

  const wasAppealed = data.history.some((item) => item.newStatus === "APPEALED");
  const stoppedAt = auth.status === "WITHDRAWN" ? data.history.find((item) => item.newStatus === "WITHDRAWN")?.previousStatus ?? null : null;
  const packetReady = data.readiness.every((item) => item.ok);
  const appealOpen = !auth.appealDeadline || auth.appealDeadline >= new Date().toISOString().slice(0, 10);

  function openDialog(name: string | null) {
    setError(null);
    setFieldErrors({});
    setDialog(name);
  }

  function openStatus(status: AuthStatus | null) {
    setPreset(status);
    openDialog("status");
  }

  function focusChecklist() {
    setTab("overview");
    requestAnimationFrame(() => {
      const element = document.getElementById("packet-checklist");
      element?.scrollIntoView({ behavior: "smooth", block: "start" });
      element?.focus({ preventScroll: true });
    });
  }

  /** The obvious next step for this status, using only existing actions and permissions. */
  function primaryAction(): { label: string; onClick: () => void } | null {
    switch (auth.status) {
      case "DRAFT":
      case "NEEDS_INFORMATION":
        if (!canTransition) return null;
        return packetReady
          ? { label: "Mark ready for review", onClick: () => openStatus("READY_FOR_REVIEW") }
          : { label: "Finish packet", onClick: focusChecklist };
      case "READY_FOR_REVIEW":
        return canTransition ? { label: "Submit to payer", onClick: () => openStatus("SUBMITTED") } : null;
      case "SUBMITTED":
      case "PENDING":
      case "APPEALED":
        return canTransition ? { label: "Record decision", onClick: () => openDialog("decision") } : null;
      case "ADDITIONAL_INFORMATION_REQUESTED":
        return canWrite ? { label: "Upload requested info", onClick: () => openDialog("upload") } : null;
      case "DENIED":
      case "PARTIALLY_APPROVED":
        if (!canTransition) return null;
        return appealOpen
          ? { label: "File appeal", onClick: () => openStatus("APPEALED") }
          : { label: "Close case", onClick: () => openStatus("CLOSED") };
      case "APPROVED":
        return canTransition ? { label: "Close case", onClick: () => openStatus("CLOSED") } : null;
      default:
        return null;
    }
  }

  function alertAction(alert: CaseAlert): { label: string; onClick: () => void } | null {
    switch (alert.kind) {
      case "PAYER_OVERDUE":
      case "PAYER_DUE_SOON":
        return canTransition && decisionOpen ? { label: "Record decision", onClick: () => openDialog("decision") } : null;
      case "SERVICE_OUTSIDE_WINDOW":
      case "AUTH_EXPIRING":
        return canWrite ? { label: "Reschedule", onClick: () => openDialog("reschedule") } : null;
      case "AUTH_EXPIRED":
        return canTransition ? { label: "Close case", onClick: () => openStatus("CLOSED") } : null;
      case "APPEAL_DEADLINE_SOON":
        return canTransition ? { label: "File appeal", onClick: () => openStatus("APPEALED") } : null;
      case "INFO_REQUESTED":
        return canWrite ? { label: "Upload info", onClick: () => openDialog("upload") } : null;
      case "URGENT_NOT_SUBMITTED":
        return { label: "Open checklist", onClick: focusChecklist };
      case "DETERMINATION_LETTER_MISSING":
        if (!canWrite) return null;
        return letters.length ? { label: "Attach letter", onClick: () => openDialog("letter") } : { label: "Upload letter", onClick: () => openDialog("upload") };
      default:
        return null;
    }
  }

  function checklistFix(item: ChecklistItem): { label: string; href?: string; onClick?: () => void } | null {
    if (!canWrite) return null;
    if (item.key === "clinical" || item.key.startsWith("payer-doc-")) return { label: "Upload", onClick: () => openDialog("upload") };
    if (item.key === "npi") return { label: "Fix provider", href: "/providers" };
    return { label: "Edit", href: `/authorizations/${auth.id}/edit` };
  }

  const primary = primaryAction();
  const moreItems: { label: string; onClick: () => void }[] = [
    ...(canAi ? [{ label: "Run AI analysis", onClick: () => void run(() => analyzeAction(auth.id)) }] : []),
    ...(canTransition && decisionOpen && primary?.label !== "Record decision" ? [{ label: "Record decision", onClick: () => openDialog("decision") }] : []),
    ...(canWrite && !terminal ? [{ label: "Reschedule", onClick: () => openDialog("reschedule") }] : []),
    ...(canWrite && p2pAllowed ? [{ label: "Peer-to-peer", onClick: () => openDialog("p2p") }] : []),
    ...(canWrite && auth.decisionOutcome && !auth.determinationDocumentId && letters.length ? [{ label: "Attach letter", onClick: () => openDialog("letter") }] : []),
    ...(canWrite && data.locked && !data.supersededBy ? [{ label: "Start replacement request", onClick: () => openDialog("supersede") }] : []),
    ...(canAssign ? [{ label: "Assign", onClick: () => openDialog("assign") }] : []),
    ...(canWrite ? [{ label: "Add task", onClick: () => openDialog("task") }, { label: "Add note", onClick: () => openDialog("note") }] : []),
    ...(canWrite ? [{ label: "Record payer response", onClick: () => openDialog("payer") }] : []),
  ];

  async function run(fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string> } | void>) {
    setPending(true);
    setError(null);
    setFieldErrors({});
    const result = await fn();
    setPending(false);
    if (result && "ok" in result && !result.ok) {
      setError(result.error ?? "Request failed.");
      setFieldErrors(result.fieldErrors ?? {});
      return;
    }
    setDialog(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm text-muted-foreground">
            <Link href={`/patients/${auth.patientId}`} className="font-medium text-foreground hover:underline">{auth.patientName}</Link>
            <span className="mx-1.5" aria-hidden>/</span>
            MRN {auth.patientMrn}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{auth.authorizationNumber}</h1>
            <StatusBadge status={auth.status} />
            <PriorityBadge priority={auth.priority} />
          </div>
          <p className="text-sm">
            {auth.procedure}
            <span className="text-muted-foreground"> for {auth.payerName}, assigned to {auth.assigneeName}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Opened {formatDateTime(auth.createdAt)}, {REVIEW_TYPE_LABEL[auth.reviewType].toLowerCase()} review
            {auth.payerDueAt && ["SUBMITTED", "PENDING", "APPEALED"].includes(auth.status) ? `. Payer decision due ${formatDateTime(auth.payerDueAt)}` : ""}
          </p>
          {data.supersedes ? (
            <p className="text-xs">Replaces <Link className="text-primary hover:underline" href={`/authorizations/${data.supersedes.id}`}>{data.supersedes.authorizationNumber}</Link></p>
          ) : null}
          {data.supersededBy ? (
            <p className="text-xs">Replaced by <Link className="text-primary hover:underline" href={`/authorizations/${data.supersededBy.id}`}>{data.supersededBy.authorizationNumber}</Link></p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {primary ? <Button onClick={primary.onClick} disabled={pending}>{primary.label}</Button> : null}
          {canTransition && allowed.length ? <Button variant="outline" onClick={() => openStatus(null)}>Change status</Button> : null}
          {canWrite ? (
            <Button variant="outline" onClick={() => openDialog("upload")}>
              <Upload aria-hidden /> Upload document
            </Button>
          ) : null}
          {canWrite && !data.locked ? (
            <Link href={`/authorizations/${auth.id}/edit`} className={cn(buttonVariants({ variant: "outline" }))}>
              <Pencil aria-hidden /> Edit
            </Link>
          ) : null}
          {moreItems.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                More actions <ChevronDown aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {moreItems.map((item, index) => (
                  <div key={item.label}>
                    {index > 0 && ["Assign", "Record payer response"].includes(item.label) ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuItem onClick={item.onClick}>{item.label}</DropdownMenuItem>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>
      {pending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Working…
        </p>
      ) : null}
      {error && !dialog ? <p className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm" role="alert">{error}</p> : null}
      <StageTracker status={auth.status} wasAppealed={wasAppealed} stoppedAt={stoppedAt} />
      <CaseAlerts alerts={auth.alerts} actionFor={alertAction} />
      {(() => {
        if (data.locked || terminal || auth.lines.length === 0) return null;
        const results = auth.lines.map((line) => authRequirement(authRules, auth.payerId, line.codeType, line.code).requirement);
        if (results.every((value) => value === "NOT_REQUIRED")) {
          return (
            <p className="rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-sm" role="note">
              Your payer rules say {auth.payerName} doesn&apos;t require prior auth for these codes. Confirm with the payer; if so, this request can be withdrawn.
            </p>
          );
        }
        const unknown = auth.lines.filter((_, index) => results[index] === "UNKNOWN").map((line) => line.code);
        return unknown.length ? (
          <p className="rounded-lg border bg-muted px-3 py-2 text-sm" role="note">
            No payer rule on file for {unknown.join(", ")}. Check {auth.payerName}&apos;s prior-auth list and <Link className="font-medium text-primary hover:underline" href="/payers/rules">add a rule</Link>.
          </p>
        ) : null;
      })()}
      {!data.locked && !terminal ? <PacketChecklist items={data.readiness} fixFor={checklistFix} /> : null}
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList className="flex h-auto w-full flex-wrap">
          {["overview", "documents", "ai", "tasks", "notes", "activity", "audit"].map((tab) => (
            <TabsTrigger key={tab} value={tab} className="capitalize">{tab === "ai" ? "AI analysis" : tab}</TabsTrigger>
          ))}
        </TabsList>
        {/* grid-cols-1 is minmax(0, 1fr): without it, the wide lines table stretches the column past the phone screen. */}
        <TabsContent value="overview" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="min-w-0 rounded-xl border bg-card p-4 text-sm md:col-span-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">Service lines</h2>
              <p className="text-xs text-muted-foreground">
                {PLACE_OF_SERVICE[auth.placeOfService] ? `${auth.placeOfService} ${PLACE_OF_SERVICE[auth.placeOfService]}` : "Place of service not set"}, {SITE_OF_CARE_LABEL[auth.siteOfCare].toLowerCase()}
                {auth.facilityName ? ` at ${auth.facilityName}` : ""}
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Code</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Description</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Approved / requested</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Payer rule</th>
                    <th scope="col" className="py-1.5 font-medium">Line decision</th>
                  </tr>
                </thead>
                <tbody>
                  {auth.lines.map((line) => {
                    const reduced = line.decision === "PARTIALLY_APPROVED";
                    const denied = line.decision === "DENIED";
                    return (
                      <tr key={line.id} className="border-b last:border-0">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className="mr-1 text-xs text-muted-foreground">{line.codeType}</span>
                          <span className="font-medium tabular-nums">{line.code}</span>
                          {line.modifiers.length ? <span className="text-muted-foreground">-{line.modifiers.join("-")}</span> : null}
                        </td>
                        <td className="py-2 pr-3">{line.description}</td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                          <span className={cn("font-medium", reduced && "text-warning", denied && "text-critical")}>{line.approvedUnits ?? "—"}</span>
                          <span className="text-muted-foreground"> / {line.requestedUnits} {UNIT_TYPE_LABEL[line.unitType].toLowerCase()}</span>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <RequirementBadge requirement={authRequirement(authRules, auth.payerId, line.codeType, line.code).requirement} />
                        </td>
                        <td className="py-2 whitespace-nowrap">
                          <span className={cn("inline-flex items-center gap-1", reduced && "text-warning", denied && "text-critical")}>
                            {reduced ? <MinusCircle className="size-3.5" aria-hidden /> : denied ? <CircleSlash className="size-3.5" aria-hidden /> : null}
                            {LINE_DECISION_LABEL[line.decision]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <h3 className="mt-4 font-medium">Diagnoses</h3>
            <ul className="mt-1.5 space-y-1">
              {auth.diagnoses.map((entry, index) => (
                <li key={entry.code}>
                  <span className="font-medium tabular-nums">{entry.code}</span> <span className="text-muted-foreground">{entry.description}</span>
                  {index === 0 ? <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Primary</span> : null}
                </li>
              ))}
            </ul>
          </section>
          <EligibilityCard authorizationId={auth.id} history={eligibility} available={eligibilityAvailable} canRun={canWrite} />
          <DetailCard title="Payer decision" rows={[
            ["Outcome", auth.decisionOutcome ? <StatusBadge key="o" status={auth.decisionOutcome} /> : "Not decided"],
            ["Payer reference", auth.payerReference || "—"],
            ["Denial reason", auth.denialReason ? DENIAL_REASON_LABEL[auth.denialReason] : "—"],
            ["Peer-to-peer", `${PEER_TO_PEER_LABEL[auth.peerToPeerStatus]}${auth.peerToPeerAt ? `, ${formatDateTime(auth.peerToPeerAt)}` : ""}`],
            ["Determination letter", auth.determinationDocumentId ? data.documents.find((document) => document.id === auth.determinationDocumentId)?.filename ?? "On file" : auth.decisionOutcome ? "Not attached" : "—"],
          ]} />
          <DetailCard title="Dates" rows={[
            ["Service date", formatDate(auth.requestedServiceDate)],
            ["Submitted", formatDateTime(auth.submissionDate)],
            ["Payer due", formatDateTime(auth.payerDueAt)],
            ["Decision date", formatDate(auth.decisionDate)],
            ["Approved window", auth.validFrom ? `${formatDate(auth.validFrom)} to ${formatDate(auth.validTo)}` : "—"],
            ["Appeal deadline", formatDate(auth.appealDeadline)],
          ]} />
          <DetailCard title="People" rows={[
            ["Patient", auth.patientName],
            ["Ordering provider", auth.providerName],
            ["Rendering provider", auth.renderingProviderName ?? "Same as ordering"],
            ["Assignee", auth.assigneeName],
          ]} />
          <DetailCard title="Coverage" rows={[
            ["Payer", auth.payerName],
            ["Member ID", auth.memberId || "Missing"],
            ["Group number", auth.groupNumber || "—"],
            ["Review type", REVIEW_TYPE_LABEL[auth.reviewType]],
          ]} />
          {auth.closedReason ? <DetailCard title="Closed" className="md:col-span-2" rows={[["Reason", auth.closedReason]]} /> : null}
          <div className="md:col-span-2 rounded-xl border bg-card p-4 text-sm">
            <h2 className="font-semibold">Reason for request</h2>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{auth.clinicalReason || "None recorded."}</p>
            <h2 className="mt-4 font-medium">Internal notes</h2>
            <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{auth.internalNotes || "None recorded."}</p>
          </div>
          <div className="md:col-span-2">
            <h2 className="mb-2 font-medium">Status history</h2>
            <ol className="space-y-2 text-sm">
              {data.history.map((item) => (
                <li key={item.id} className="rounded-lg border px-3 py-2">
                  <span className="font-medium">{item.previousStatus ? STATUS_LABEL[item.previousStatus] : "Created"} → {STATUS_LABEL[item.newStatus]}</span>
                  <span className="text-muted-foreground"> · {item.actorName} · {formatDateTime(item.createdAt)}</span>
                  <p>{item.reason}</p>
                </li>
              ))}
            </ol>
          </div>
        </TabsContent>
        <TabsContent value="documents" className="mt-4 space-y-3">
          {data.documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents yet.</p> : null}
          {data.documents.map((document) => (
            <div key={document.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{document.filename}</p>
                <p className="text-muted-foreground">{DOCUMENT_CATEGORY_LABEL[document.category]} · {formatBytes(document.size)} · {document.processingStatus}</p>
              </div>
              <a className="text-primary" href={`/api/documents/${document.id}`}>Download</a>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="ai" className="mt-4 space-y-4">
          <AiDisclaimer />
          <div className="flex flex-wrap gap-2">
            {canAi ? <Button onClick={() => void run(() => analyzeAction(auth.id))} disabled={pending}>Run AI analysis</Button> : null}
            {canAi ? <Button variant="outline" onClick={() => void run(async () => {
              const result = await followupDraftAction(auth.id);
              if (result.ok && result.data?.text) setDraft(result.data.text);
              return result;
            })}>Draft payer follow-up</Button> : null}
          </div>
          {draft ? (
            <div className="rounded-xl border p-4">
              <h2 className="font-medium">Follow-up draft</h2>
              <AiDisclaimer className="mt-2" />
              <pre className="mt-3 whitespace-pre-wrap text-sm">{draft}</pre>
              <p className="mt-2 text-xs text-muted-foreground">Saving this as a note keeps it internal. It does not send anything to the payer.</p>
              {canWrite ? <Button className="mt-3" variant="outline" onClick={() => void run(() => noteAction({ authorizationId: auth.id, content: `Staff saved an AI follow-up draft after review.\n\n${draft}` }))}>Save as internal note</Button> : null}
            </div>
          ) : null}
          {data.aiRuns.length === 0 ? <p className="text-sm text-muted-foreground">No analysis has been run.</p> : null}
          {data.aiRuns.map((run) => (
            <article key={run.id} className="rounded-xl border p-4 text-sm">
              <p className="text-xs text-muted-foreground">{run.provider} · {run.model} · {run.operation} · {run.status} · {formatDateTime(run.createdAt)}</p>
              <AiDisclaimer className="mt-2" />
              {run.error ? <p className="mt-2 text-destructive">{run.error}</p> : null}
              {isAnalysis(run.output) ? (
                <div className="mt-3 space-y-3">
                  <p>{run.output.caseSummary}</p>
                  <List title="Available information" items={run.output.availableInformation} />
                  <List title="Potentially missing information" items={run.output.potentiallyMissingInformation} />
                  <List title="Documentation checklist" items={run.output.documentationChecklist} />
                  <List title="Administrative next steps" items={run.output.administrativeNextSteps} />
                  <List title="Questions for human review" items={run.output.questionsForHumanReview} />
                  <List title="Limitations" items={run.output.limitations} />
                </div>
              ) : run.output && "text" in run.output ? <pre className="mt-3 whitespace-pre-wrap">{run.output.text}</pre> : null}
            </article>
          ))}
        </TabsContent>
        <TabsContent value="tasks" className="mt-4 space-y-2">
          {canWrite ? (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => openDialog("task")}>Add task</Button>
            </div>
          ) : null}
          {data.tasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{task.title}</p>
                <p className="text-muted-foreground">Due {formatDate(task.dueDate)}</p>
              </div>
              <TaskStatusBadge status={task.status} />
            </div>
          ))}
          {data.tasks.length === 0 ? <p className="text-sm text-muted-foreground">No tasks on this case.</p> : null}
        </TabsContent>
        <TabsContent value="notes" className="mt-4 space-y-3">
          {canWrite ? (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => openDialog("note")}>Add note</Button>
            </div>
          ) : null}
          {data.notes.map((note) => (
            <article key={note.id} className="rounded-lg border px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap">{note.content}</p>
              <p className="mt-1 text-xs text-muted-foreground">{note.authorName} · {formatDateTime(note.createdAt)}</p>
            </article>
          ))}
          {data.notes.length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : null}
        </TabsContent>
        <TabsContent value="activity" className="mt-4 space-y-3">
          {data.activity.map((item) => (
            <div key={item.id} className="text-sm">
              <p>{item.summary}</p>
              <p className="text-xs text-muted-foreground">{item.actorName} · {formatDateTime(item.createdAt)}</p>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="audit" className="mt-4 space-y-3">
          {data.audit.length === 0 ? <p className="text-sm text-muted-foreground">No audit events for this case, or your role cannot view the organization audit log. Case activity remains available on the Activity tab.</p> : null}
          {data.audit.map((item) => (
            <div key={item.id} className="text-sm">
              <p className="font-medium">{item.event}</p>
              <p className="text-xs text-muted-foreground">{item.actorName} · {formatDateTime(item.createdAt)}</p>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <Dialog open={dialog === "status"} onOpenChange={(open) => openDialog(open ? "status" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Change status</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <StatusForm
            key={`${preset ?? "any"}-${dialog === "status"}`}
            initial={preset}
            reasonError={fieldErrors.reason}
            allowed={allowed}
            pending={pending}
            onSubmit={(status, reason) => void run(() => transitionAction({ authorizationId: auth.id, status, reason }))}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "decision"} onOpenChange={(open) => openDialog(open ? "decision" : null)}>
        <DialogContent className={cn(SHEET, "max-h-[90vh] overflow-y-auto")}>
          <DialogHeader><DialogTitle>Record payer decision</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <DecisionForm
            lines={auth.lines.map((line) => ({ id: line.id, label: `${line.code} ${line.description}`, requested: line.requestedUnits }))}
            letters={letters.map((document) => ({ id: document.id, label: document.filename }))}
            submissionDate={auth.submissionDate?.slice(0, 10) ?? ""}
            pending={pending}
            fieldErrors={fieldErrors}
            onSubmit={(payload) => void run(() => decisionAction({ authorizationId: auth.id, ...payload }))}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "reschedule"} onOpenChange={(open) => openDialog(open ? "reschedule" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Reschedule service</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          {auth.validFrom ? <p className="text-sm text-muted-foreground">Approved window: {formatDate(auth.validFrom)} – {formatDate(auth.validTo)}.</p> : null}
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(() => rescheduleAction({
              authorizationId: auth.id,
              requestedServiceDate: String(form.get("date") ?? ""),
              reason: String(form.get("reason") ?? ""),
            }));
          }}>
            <Label htmlFor="reschedule-date">New service date</Label>
            <Input id="reschedule-date" name="date" type="date" required defaultValue={auth.requestedServiceDate} />
            <FieldMessage message={fieldErrors.requestedServiceDate ?? fieldErrors["requestedServiceDate"]} />
            <Label htmlFor="reschedule-reason">Reason</Label>
            <Textarea id="reschedule-reason" name="reason" required minLength={3} />
            <FieldMessage message={fieldErrors.reason ?? fieldErrors["reason"]} />
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save date</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "p2p"} onOpenChange={(open) => openDialog(open ? "p2p" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Peer-to-peer review</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(() => peerToPeerAction({
              authorizationId: auth.id,
              status: String(form.get("status") ?? ""),
              scheduledAt: String(form.get("scheduledAt") ?? ""),
              notes: String(form.get("notes") ?? ""),
            }));
          }}>
            <Label htmlFor="p2p-status">Status</Label>
            <select id="p2p-status" name="status" className={fieldClass} defaultValue={auth.peerToPeerStatus}>
              {PEER_TO_PEER_STATUSES.map((status) => <option key={status} value={status}>{PEER_TO_PEER_LABEL[status]}</option>)}
            </select>
            <Label htmlFor="p2p-when">Scheduled for</Label>
            <Input id="p2p-when" name="scheduledAt" type="datetime-local" />
            <FieldMessage message={fieldErrors.scheduledAt ?? fieldErrors["scheduledAt"]} />
            <Label htmlFor="p2p-notes">Notes</Label>
            <Textarea id="p2p-notes" name="notes" defaultValue={auth.peerToPeerNotes} />
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "letter"} onOpenChange={(open) => openDialog(open ? "letter" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Attach determination letter</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const documentId = String(new FormData(event.currentTarget).get("documentId") ?? "");
            void run(() => attachLetterAction(auth.id, documentId));
          }}>
            <Label htmlFor="letter-doc">Payer correspondence on this case</Label>
            <select id="letter-doc" name="documentId" className={fieldClass}>
              {letters.map((document) => <option key={document.id} value={document.id}>{document.filename}</option>)}
            </select>
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Attach</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "supersede"} onOpenChange={(open) => openDialog(open ? "supersede" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Start a replacement request</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <p className="text-sm text-muted-foreground">
            Submitted requests cannot be edited. This copies the request into a new draft you can change.
            {auth.decisionOutcome ? "" : " The current request will be marked withdrawn. Tell the payer if it is still open with them."}
          </p>
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
            setPending(true);
            setError(null);
            void supersedeAction({ authorizationId: auth.id, reason }).then((result) => {
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setDialog(null);
              router.push(`/authorizations/${result.data?.id}/edit`);
            });
          }}>
            <Label htmlFor="supersede-reason">What needs to change?</Label>
            <Textarea id="supersede-reason" name="reason" required minLength={3} />
            <FieldMessage message={fieldErrors.reason ?? fieldErrors["reason"]} />
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Create replacement draft</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "assign"} onOpenChange={(open) => openDialog(open ? "assign" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Assign case</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const selected = new FormData(event.currentTarget).get("assignedUserId");
            void run(() => assignAction(auth.id, typeof selected === "string" && selected ? selected : null));
          }}>
            <select name="assignedUserId" className={fieldClass} defaultValue={auth.assignedUserId ?? ""}>
              <option value="">Unassigned</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
            </select>
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save assignment</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "note"} onOpenChange={(open) => openDialog(open ? "note" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Add note</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const content = String(new FormData(event.currentTarget).get("content") ?? "");
            void run(() => noteAction({ authorizationId: auth.id, content }));
          }}>
            <Textarea name="content" required minLength={1} rows={4} />
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save note</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "task"} onOpenChange={(open) => openDialog(open ? "task" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Add task</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(() => taskAction({
              title: String(form.get("title") ?? ""),
              description: String(form.get("description") ?? ""),
              authorizationId: auth.id,
              patientId: auth.patientId,
              assignedUserId: String(form.get("assignedUserId") ?? ""),
              dueDate: String(form.get("dueDate") ?? ""),
              priority: String(form.get("priority") ?? "NORMAL"),
            }));
          }}>
            <Input name="title" required placeholder="Title" />
            <Textarea name="description" placeholder="Description" />
            <Input name="dueDate" type="date" />
            <select name="priority" className={fieldClass} defaultValue="NORMAL">
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
            </select>
            <select name="assignedUserId" className={fieldClass}>
              <option value="">Unassigned</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}
            </select>
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Create task</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "upload"} onOpenChange={(open) => openDialog(open ? "upload" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Upload document</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            form.set("authorizationId", auth.id);
            form.set("patientId", auth.patientId);
            void run(async () => uploadDocumentAction(form));
          }}>
            <Input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.txt,.docx" />
            <select name="category" className={fieldClass} defaultValue="CLINICAL_NOTE">
              {DOCUMENT_CATEGORIES.map((category) => <option key={category} value={category}>{DOCUMENT_CATEGORY_LABEL[category]}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">PDF, PNG, JPEG, TIFF, TXT, or DOCX. 10 MB maximum.</p>
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Upload</Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={dialog === "payer"} onOpenChange={(open) => openDialog(open ? "payer" : null)}>
        <DialogContent className={SHEET}>
          <DialogHeader><DialogTitle>Record payer response</DialogTitle></DialogHeader>
          {error ? <DialogError message={error} /> : null}
          <p className="text-sm text-muted-foreground">This stores a staff note and reference number. It does not change status or contact the payer.</p>
          <form className="space-y-3" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(() => payerResponseAction({
              authorizationId: auth.id,
              payerReference: String(form.get("payerReference") ?? ""),
              summary: String(form.get("summary") ?? ""),
            }));
          }}>
            <Input name="payerReference" required placeholder="Payer reference" />
            <Textarea name="summary" required minLength={3} placeholder="What did staff learn?" />
            <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save response</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusForm({
  allowed,
  initial,
  reasonError,
  pending,
  onSubmit,
}: {
  allowed: AuthStatus[];
  initial: AuthStatus | null;
  reasonError?: string;
  pending: boolean;
  onSubmit: (status: AuthStatus, reason: string) => void;
}) {
  if (allowed.length === 0) return <p className="text-sm text-muted-foreground">This case is closed to further status changes.</p>;
  return (
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onSubmit(String(form.get("status")) as AuthStatus, String(form.get("reason") ?? ""));
    }}>
      <div className="space-y-1.5">
        <Label htmlFor="status">Next status</Label>
        <select id="status" name="status" className={fieldClass} defaultValue={initial && allowed.includes(initial) ? initial : allowed[0]}>
          {allowed.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Textarea id="reason" name="reason" required minLength={3} aria-invalid={reasonError ? true : undefined} />
        <FieldMessage message={reasonError} />
      </div>
      <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Update status</Button>
    </form>
  );
}

function DecisionForm({
  lines,
  letters,
  submissionDate,
  pending,
  fieldErrors,
  onSubmit,
}: {
  lines: { id: string; label: string; requested: number }[];
  letters: { id: string; label: string }[];
  submissionDate: string;
  pending: boolean;
  fieldErrors: Record<string, string>;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [outcome, setOutcome] = useState<DecisionOutcome>("APPROVED");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form className="space-y-3 text-sm" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      onSubmit({
        outcome,
        payerReference: String(form.get("payerReference") ?? ""),
        decisionDate: String(form.get("decisionDate") ?? ""),
        validFrom: String(form.get("validFrom") ?? ""),
        validTo: String(form.get("validTo") ?? ""),
        lines: outcome === "DENIED" ? [] : lines.map((line) => ({ id: line.id, approvedUnits: String(form.get(`units-${line.id}`) ?? line.requested) })),
        denialReason: String(form.get("denialReason") ?? ""),
        denialDetail: String(form.get("denialDetail") ?? ""),
        determinationDocumentId: String(form.get("documentId") ?? ""),
        reason: String(form.get("reason") ?? ""),
      });
    }}>
      <p className="text-muted-foreground">Enter the decision exactly as the payer issued it. HealthFlow does not make coverage decisions.</p>
      <Label htmlFor="decision-outcome">Outcome</Label>
      <select id="decision-outcome" className={fieldClass} value={outcome} onChange={(event) => setOutcome(event.target.value as DecisionOutcome)}>
        {DECISION_OUTCOMES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="decision-ref">Payer reference</Label>
          <Input id="decision-ref" name="payerReference" required />
            <FieldMessage message={fieldErrors.payerReference ?? fieldErrors["payerReference"]} />
        </div>
        <div>
          <Label htmlFor="decision-date">Decision date</Label>
          <Input id="decision-date" name="decisionDate" type="date" required max={today} min={submissionDate || undefined} defaultValue={today} />
        </div>
      </div>
      {outcome !== "DENIED" ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="decision-from">Approved from</Label>
              <Input id="decision-from" name="validFrom" type="date" required />
            <FieldMessage message={fieldErrors.validFrom ?? fieldErrors["validFrom"]} />
            </div>
            <div>
              <Label htmlFor="decision-to">Approved through</Label>
              <Input id="decision-to" name="validTo" type="date" required />
            <FieldMessage message={fieldErrors.validTo ?? fieldErrors["validTo"]} />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="font-medium">Approved units per line</legend>
            {lines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3">
                <Label htmlFor={`units-${line.id}`} className="font-normal">{line.label} (requested {line.requested})</Label>
                <Input id={`units-${line.id}`} name={`units-${line.id}`} type="number" min={0} max={line.requested} defaultValue={line.requested} className="w-24" />
              </div>
            ))}
          </fieldset>
        </>
      ) : null}
      {outcome !== "APPROVED" ? (
        <>
          <Label htmlFor="decision-reason-code">Payer&apos;s reason</Label>
          <select id="decision-reason-code" name="denialReason" className={fieldClass} required defaultValue="">
            <option value="" disabled>Choose the reason on the letter</option>
            {DENIAL_REASONS.map((reason) => <option key={reason} value={reason}>{DENIAL_REASON_LABEL[reason]}</option>)}
          </select>
          <Label htmlFor="decision-detail">Details from the letter</Label>
          <Textarea id="decision-detail" name="denialDetail" rows={2} />
        </>
      ) : null}
      <Label htmlFor="decision-letter">Determination letter {outcome === "APPROVED" ? "(optional now, a task is created if missing)" : "(required)"}</Label>
      <select id="decision-letter" name="documentId" className={fieldClass} defaultValue="" required={outcome !== "APPROVED"}>
        <option value="">{letters.length ? "Select the letter" : "Upload it as Payer correspondence first"}</option>
        {letters.map((letter) => <option key={letter.id} value={letter.id}>{letter.label}</option>)}
      </select>
      <p className="rounded-md bg-muted px-3 py-2 text-xs" role="status">
        {outcome === "APPROVED"
          ? `Approval: ${lines.length} line${lines.length === 1 ? "" : "s"} at the units entered above. A letter task is created if none is attached.`
          : outcome === "PARTIALLY_APPROVED"
            ? `Partial approval: ${lines.length} line${lines.length === 1 ? "" : "s"}, at least one reduced. The appeal deadline will be set from this payer's appeal window.`
            : `Denial: all ${lines.length} line${lines.length === 1 ? "" : "s"} set to 0 units. The appeal deadline will be set from this payer's appeal window.`}
      </p>
      <Label htmlFor="decision-note">Note for the history</Label>
      <Textarea id="decision-note" name="reason" required minLength={3} rows={2} />
            <FieldMessage message={fieldErrors.reason ?? fieldErrors["reason"]} />
      <Button type="submit" disabled={pending} className="max-sm:w-full">{pending ? <Loader2 className="animate-spin" aria-hidden /> : null}Save decision</Button>
    </form>
  );
}


function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="font-medium">{title}</h3>
      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}
function DialogError({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm" role="alert">
      {message}
    </p>
  );
}

function FieldMessage({ message }: { message?: string }) {
  return message ? <span className="block text-xs text-destructive">{message}</span> : null;
}
