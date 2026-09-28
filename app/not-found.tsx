import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">That page is missing, or it belongs to another organization.</p>
      <Link href="/dashboard" className="mt-4 inline-block text-sm text-primary">Back to dashboard</Link>
    </main>
  );
}
