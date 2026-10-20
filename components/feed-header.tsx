import type { ReactNode } from "react";

// View title row — the page's single h1 with per-view actions (date
// picker, Play all + playlist menu, sort) on the right. flex-wrap lets a
// wide action like the sort chips drop to their own row on phones,
// where each action group scrolls horizontally instead of clipping.
export function FeedHeader({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
      <h1 className="text-3xl font-black text-slate-900 tracking-tight">
        {title}
      </h1>
      {actions}
    </div>
  );
}
