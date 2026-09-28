import { PageHeader } from "@/components/page-header";
import { PERMISSIONS } from "@/lib/domain/permissions";
import { ROLE_LABEL } from "@/lib/domain/labels";
import { ROLES } from "@/lib/domain/types";

export const metadata = { title: "Roles and permissions" };

export default function RolesPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Roles and permissions" description="Hiding a button is not authorization. These checks run in services before any write." />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b">
              <th className="p-2">Permission</th>
              {ROLES.map((role) => <th key={role} className="p-2">{ROLE_LABEL[role]}</th>)}
            </tr>
          </thead>
          <tbody>
            {Object.entries(PERMISSIONS).map(([permission, roles]) => (
              <tr key={permission} className="border-b last:border-0">
                <td className="p-2 font-medium">{permission}</td>
                {ROLES.map((role) => <td key={role} className="p-2">{(roles as readonly string[]).includes(role) ? "Yes" : "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
