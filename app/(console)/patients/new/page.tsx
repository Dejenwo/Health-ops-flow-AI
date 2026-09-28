import { PatientForm } from "@/components/patients/patient-form";
import { PageHeader } from "@/components/page-header";
import { listPayers } from "@/lib/services/directory";
import { getRequestContext } from "@/lib/services/context";

export const metadata = { title: "New patient" };

export default async function NewPatientPage() {
  const ctx = await getRequestContext();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New patient" description="Use synthetic identifiers. Do not enter real patient information." />
      <PatientForm payers={listPayers(ctx)} />
    </div>
  );
}
