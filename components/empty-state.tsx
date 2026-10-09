import Link from "next/link";
import type { ReactNode } from "react";
import { LinkPendingSpinner } from "./link-pending-spinner";

// Shared empty state for the kids feed views — big friendly card with an
// icon bubble, one line of copy and an optional pill CTA link.
export function EmptyState({
  icon,
  message,
  action,
}: {
  icon: ReactNode;
  message: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center bg-white rounded-[40px] shadow-sm border-4 border-slate-100">
      <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 mb-6">
        {icon}
      </div>
      <p className="text-2xl font-bold text-slate-400">{message}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3 text-lg font-black text-white shadow-md transition-transform hover:scale-105"
        >
          {action.label}
          <LinkPendingSpinner size={20} weight="bold" />
        </Link>
      )}
    </div>
  );
}
