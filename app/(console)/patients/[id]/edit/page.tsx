import { notFound } from "next/navigation";
import { PatientForm } from "@/components/patients/patient-form";
import { PageHeader } from "@/components/page-header";
import { listPayers } from "@/lib/services/directory";
import { getPatientDetail, recordPatientView } from "@/lib/services/patients";
import { getRequestContext } from "@/lib/services/context";

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getRequestContext();
  const detail = getPatientDetail(ctx, id);
  if (!detail) notFound();
  recordPatientView(ctx, id);
  const patient = detail.patient;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Edit ${patient.lastName}, ${patient.firstName}`} />
      <PatientForm
        id={patient.id}
        payers={listPayers(ctx)}
        values={{
          mrn: patient.mrn,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          sex: patient.sex,
          phone: patient.phone,
          email: patient.email,
          address: patient.address,
          city: patient.city,
          state: patient.state,
          zip: patient.zip,
          primaryPayerId: patient.primaryPayerId ?? "",
          memberId: patient.memberId,
          groupNumber: patient.groupNumber,
        }}
      />
    </div>
  );
}
