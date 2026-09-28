import { PageHeader } from "@/components/page-header";
import { TaskBoard } from "@/components/tasks/task-board";
import { can } from "@/lib/domain/permissions";
import { activeMembers } from "@/lib/services/directory";
import { listTasks } from "@/lib/services/tasks";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  const ctx = await getRequestContext();
  const tasks = listTasks(ctx);
  return (
    <div className="space-y-5">
      <PageHeader title="Tasks" description={`${tasks.openCount} open items across overdue, today, and upcoming work.`} />
      <TaskBoard
        canWrite={can(ctx.role, "tasks.write")}
        members={activeMembers(ctx).map((member) => ({ id: member.userId, label: member.name }))}
        columns={[
          { key: "overdue", title: "Overdue", tasks: tasks.overdue },
          { key: "today", title: "Due today", tasks: tasks.dueToday },
          { key: "upcoming", title: "Upcoming", tasks: tasks.upcoming },
          { key: "completed", title: "Completed", tasks: tasks.completed },
        ]}
      />
    </div>
  );
}
