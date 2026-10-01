import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ParentNav } from "@/components/parent-nav";

export default async function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-background">
      <ParentNav userName={session.user?.name ?? null} />
      <main>{children}</main>
    </div>
  );
}
