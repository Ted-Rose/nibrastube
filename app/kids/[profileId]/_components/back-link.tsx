import Link from "next/link";
import { ArrowLeft } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { LinkPendingSpinner } from "@/components/link-pending-spinner";

// "All channels" / "All playlists" link that backs out of a drill-in.
export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-6">
      <Link
        href={href}
        className="inline-flex items-center gap-2 text-lg font-bold text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft size={20} weight="bold" />
        {children}
        <LinkPendingSpinner size={20} weight="bold" />
      </Link>
    </div>
  );
}
