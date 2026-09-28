import { PageHeader } from "@/components/page-header";
import { AssistantPanel } from "@/components/ai/assistant-panel";

export const metadata = { title: "AI Assistant" };

export default function AiAssistantPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="AI assistant"
        description="Administrative questions over this organization’s queue. The assistant cannot approve, deny, submit, or query the database in natural language."
      />
      <AssistantPanel />
    </div>
  );
}
