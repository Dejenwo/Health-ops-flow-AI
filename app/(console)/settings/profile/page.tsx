import { PageHeader } from "@/components/page-header";
import { ProfileForm } from "@/components/settings/forms";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Profile" };

export default async function ProfileSettingsPage() {
  const ctx = await getRequestContext();
  return (
    <div className="space-y-5">
      <PageHeader title="Profile" description={ctx.email} />
      <ProfileForm values={{ fullName: ctx.profile.fullName, jobTitle: ctx.profile.jobTitle, phone: ctx.profile.phone }} />
    </div>
  );
}
