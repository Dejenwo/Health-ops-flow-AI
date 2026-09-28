"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inviteAction, roleAction } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fieldClass } from "@/components/page-header";
import { ROLES, type Role } from "@/lib/domain/types";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { canAssignRole } from "@/lib/domain/permissions";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  lastActiveAt: string | null;
  userId: string;
}

export function TeamManager({
  members,
  invitations,
  actorRole,
  actorId,
  canInvite,
  canChange,
}: {
  members: MemberRow[];
  invitations: { email: string; role: Role; expiresAt: string }[];
  actorRole: Role;
  actorId: string;
  canInvite: boolean;
  canChange: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inviteRoles = ROLES.filter((role) => canAssignRole(actorRole, role));

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {canInvite ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const result = await inviteAction({ email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "VIEWER") });
            if (!result.ok) setError(result.error);
            else {
              setError(null);
              setToken(result.data?.token ?? null);
              setNotice(result.data?.emailed ? "Invitation emailed. The link expires in 7 days." : null);
              router.refresh();
            }
          }}
        >
          <Input name="email" type="email" required placeholder="Email" aria-label="Invite email" />
          <select name="role" className={fieldClass + " w-auto"} aria-label="Role">
            {inviteRoles.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
          </select>
          <Button type="submit">Invite</Button>
        </form>
      ) : null}
      {notice ? <p className="text-sm" role="status">{notice}</p> : null}
      {token ? (
        <p className="rounded-lg border bg-card p-3 text-sm">
          Email is not sent in this demo. Share this invite path: <code>/invite/{token}</code>
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Name</th>
              <th className="p-3 font-medium">Email</th>
              <th className="p-3 font-medium">Role</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="border-b last:border-0">
                <td className="p-3">{member.name}</td>
                <td className="p-3">{member.email}</td>
                <td className="p-3">
                  {canChange && member.userId !== actorId ? (
                    <select
                      className={fieldClass}
                      defaultValue={member.role}
                      aria-label={`Role for ${member.name}`}
                      onChange={(event) => {
                        void roleAction({ memberId: member.id, role: event.target.value }).then((result) => {
                          if (!result.ok) setError(result.error);
                          router.refresh();
                        });
                      }}
                    >
                      {ROLES.filter((role) => canAssignRole(actorRole, role) || role === member.role).map((role) => (
                        <option key={role} value={role}>{ROLE_LABEL[role]}</option>
                      ))}
                    </select>
                  ) : ROLE_LABEL[member.role]}
                </td>
                <td className="p-3">{member.status}</td>
                <td className="p-3">{member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invitations.length ? (
        <div>
          <h2 className="text-sm font-medium">Open invitations</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {invitations.map((invite) => (
              <li key={invite.email}>{invite.email} · {ROLE_LABEL[invite.role]} · expires {new Date(invite.expiresAt).toLocaleDateString()}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
