import { redirect } from "next/navigation";
import { getSession, parentSession } from "@/lib/auth";
import { ParentNav } from "@/components/parent-nav";

export default async function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = parentSession(await getSession());
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-background">
      <ParentNav userName={user.name} />
      <main>{children}</main>
    </div>
  );
}
