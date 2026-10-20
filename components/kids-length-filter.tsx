"use client";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useState, useTransition } from "react";
import { SpinnerGap, Timer } from "@phosphor-icons/react";

// Slider extremes: position 1 = "≤1 min" cap; position SLIDER_MAX =
// the "30m+" resting state, meaning no cap (the ?max= param is
// omitted). Positions in between cap duration_seconds at N·60.
const SLIDER_MAX = 30;

// "How long?" length slider — sits next to KidsTypeFilter in each
// video-listing view's FeedHeader. Dragging only stages a local draft;
// the ?max= rewrite commits on release (pointerup/keyup/blur) so a
// drag can't spam router.replace. URL is rebuilt from the live search
// params like KidsSearch, so every other feed param survives.
export function KidsLengthFilter({ maxLen }: { maxLen: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Committed slider position from the URL: 1..30 minutes, 30 = no cap.
  // A hand-edited ?max= snaps to whole minutes and clamps to the ends.
  const committed =
    maxLen === null
      ? SLIDER_MAX
      : Math.min(SLIDER_MAX, Math.max(1, Math.round(maxLen / 60)));

  const [draft, setDraft] = useState<number | null>(null);
  // Clear a staged draft once the navigation it triggered commits.
  const [prevCommitted, setPrevCommitted] = useState(committed);
  if (committed !== prevCommitted) {
    setPrevCommitted(committed);
    setDraft(null);
  }
  const shown = draft ?? committed;

  const commit = (v: number) => {
    if (v === committed) return;
    const sp = new URLSearchParams(searchParams.toString());
    if (v >= SLIDER_MAX) sp.delete("max");
    else sp.set("max", String(v * 60));
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, {
        scroll: false,
      });
    });
  };
  // Read the input's own value — draft state may lag a final move
  // when pointerup lands in the same event batch.
  const release = (e: React.SyntheticEvent<HTMLInputElement>) =>
    commit(Number(e.currentTarget.value));

  const label = shown >= SLIDER_MAX ? "30m+" : `≤${shown}m`;

  return (
    <div
      className="inline-flex h-11 shrink-0 items-center gap-2.5 rounded-full bg-white px-4 shadow-sm"
      title="Maximum video length"
    >
      <Timer size={16} weight="bold" className="shrink-0 text-slate-400" />
      <span className="shrink-0 text-[11px] font-bold text-slate-400">
        1m
      </span>
      <input
        type="range"
        min={1}
        max={SLIDER_MAX}
        step={1}
        value={shown}
        aria-label="Maximum video length"
        aria-valuetext={
          shown >= SLIDER_MAX
            ? "30 minutes or more"
            : `${shown} minutes or less`
        }
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={release}
        onPointerCancel={() => setDraft(null)}
        onKeyUp={(e) => {
          if (
            e.key.startsWith("Arrow") ||
            e.key === "Home" ||
            e.key === "End"
          ) {
            release(e);
          }
        }}
        onBlur={release}
        className="w-24 accent-primary sm:w-32"
      />
      <span className="shrink-0 text-[11px] font-bold text-slate-400">
        30m+
      </span>
      {isPending ? (
        <SpinnerGap
          size={16}
          weight="bold"
          className="w-9 animate-spin text-primary"
        />
      ) : (
        <span className="w-9 shrink-0 text-right text-sm font-black text-primary">
          {label}
        </span>
      )}
    </div>
  );
}
