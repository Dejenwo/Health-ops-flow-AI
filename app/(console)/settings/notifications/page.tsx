import { PageHeader } from "@/components/page-header";
import { NotificationForm } from "@/components/settings/forms";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const ctx = await getRequestContext();
  return (
    <div className="space-y-5">
      <PageHeader title="Notifications" description="In-app notifications respect these switches. Email is stored as a preference only." />
      <NotificationForm values={ctx.profile.notificationPreferences} />
    </div>
  );
}
