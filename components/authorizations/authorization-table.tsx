"use client";

import Link from "next/link";
import { cn } from "cn";
import { useState } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type VisibilityState } from "@tanstack/react-table";
import { ALERT_SHORT_LABEL, AlertBadge, PriorityBadge, SeverityIcon, StatusBadge } from "@/components/status-badge";
import { FileSearch } from "lucide-react";
import type { CaseAlert } from "@/lib/domain/sla";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatRelative } from "@/lib/format";
import type { AuthStatus, Priority } from "@/lib/domain/types";

export interface AuthorizationRow {
  id: string;
  authorizationNumber: string;
  patientName: string;
  payerName: string;
  procedure: string;
  codesSummary: string;
  alerts: CaseAlert[];
  priority: Priority;
  status: AuthStatus;
  assigneeName: string;
  requestedServiceDate: string;
  ageDays: number;
  updatedAt: string;
}

const columns: ColumnDef<AuthorizationRow>[] = [
  { accessorKey: "authorizationNumber", header: "Authorization #" },
  { accessorKey: "patientName", header: "Patient" },
  { accessorKey: "payerName", header: "Payer" },
  {
    accessorKey: "procedure",
    header: "Request",
    cell: ({ row }) => (
      <div>
        <p>{row.original.procedure}</p>
        <p className="font-mono text-xs text-muted-foreground">{row.original.codesSummary}</p>
      </div>
    ),
  },
  {
    id: "alerts",
    header: "Alerts",
    cell: ({ row }) =>
      row.original.alerts.length ? (
        <span title={row.original.alerts.map((alert) => alert.message).join("\n")} className="inline-flex items-center gap-1">
          <AlertBadge severity={row.original.alerts[0].severity}>{ALERT_SHORT_LABEL[row.original.alerts[0].kind]}</AlertBadge>
          {row.original.alerts.length > 1 ? (
            <span className="text-xs text-muted-foreground">
              +{row.original.alerts.length - 1}
              <span className="sr-only">: {row.original.alerts.slice(1).map((alert) => ALERT_SHORT_LABEL[alert.kind]).join(", ")}</span>
            </span>
          ) : null}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">None</span>
      ),
  },
  { accessorKey: "priority", header: "Priority", cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  { accessorKey: "assigneeName", header: "Assigned to" },
  { accessorKey: "requestedServiceDate", header: "Requested date", cell: ({ row }) => formatDate(row.original.requestedServiceDate) },
  { accessorKey: "ageDays", header: "Age", cell: ({ row }) => `${row.original.ageDays}d` },
  { accessorKey: "updatedAt", header: "Last updated", cell: ({ row }) => formatRelative(row.original.updatedAt) },
];

export function AuthorizationTable({ rows }: { rows: AuthorizationRow[] }) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <FileSearch className="mx-auto size-7 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">No authorizations match these filters</p>
          <p className="text-sm text-muted-foreground">Clear a filter above, or start a new request.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/authorizations" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Clear filters</Link>
            <Link href="/authorizations/new" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90">New authorization</Link>
          </div>
        </div>
      ) : null}
      <ul className={cn("space-y-2 md:hidden", rows.length === 0 && "hidden")} aria-label="Authorizations">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`/authorizations/${row.id}`} className="block rounded-xl border bg-card p-3 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{row.authorizationNumber}</span>
                <StatusBadge status={row.status} />
              </div>
              <p className="mt-1 text-sm">{row.patientName}</p>
              <p className="text-sm text-muted-foreground">{row.payerName}, service {formatDate(row.requestedServiceDate)}</p>
              {row.alerts[0] ? (
                <p className="mt-2 flex items-start gap-1.5 text-sm">
                  <SeverityIcon severity={row.alerts[0].severity} className="mt-0.5 size-3.5" />
                  {row.alerts[0].message}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      <div className={cn("hidden justify-end md:flex", rows.length === 0 && "md:hidden")}>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>Columns</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table.getAllLeafColumns().map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
              >
                {String(column.columnDef.header)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className={cn("hidden rounded-xl border bg-card md:block", rows.length === 0 && "md:hidden")}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>
                ))}
                <TableHead>Actions</TableHead>
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer">
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <Link href={`/authorizations/${row.original.id}`} className="block">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Link>
                  </TableCell>
                ))}
                <TableCell>
                  <Link href={`/authorizations/${row.original.id}`} className="text-sm font-medium text-primary hover:underline">Open</Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
