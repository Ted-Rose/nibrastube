"use client";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useState, useTransition } from "react";
import { SpinnerGap, Timer } from "@phosphor-icons/react";
import { Slider } from "./ui/slider";

// Track positions are whole minutes, 0..30. The LEFT thumb sets the
// minimum length (0 = no minimum, ?min= omitted); the RIGHT thumb sets
// the maximum (30 = "30m+", no cap, ?max= omitted). In-between
// positions bound duration_seconds at N·60.
const SLIDER_MAX = 30;

// "How long?" dual-thumb length slider — sits next to KidsTypeFilter
// in each video-listing view's FeedHeader. Dragging only stages a
// local draft; the ?min=/?max= rewrite commits on release
// (Radix onValueCommit covers pointer, touch and keyboard) so a drag
// can't spam router.replace. The URL is rebuilt from the live search
// params like KidsSearch, so every other feed param survives.
export function KidsLengthFilter({
  minLen,
  maxLen,
}: {
  minLen: number | null;
  maxLen: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Committed thumb positions from the URL. A hand-edited param snaps
  // to whole minutes and clamps to the ends.
  const committed: [number, number] = [
    minLen === null
      ? 0
      : Math.min(SLIDER_MAX - 1, Math.max(0, Math.round(minLen / 60))),
    maxLen === null
      ? SLIDER_MAX
      : Math.min(SLIDER_MAX, Math.max(1, Math.round(maxLen / 60))),
  ];
  // An inverted hand-edited URL (min above max) snaps the min thumb
  // under the max — the params still govern the query.
  committed[0] = Math.min(committed[0], Math.max(0, committed[1] - 1));

  const [draft, setDraft] = useState<[number, number] | null>(null);
  // Clear a staged draft once the navigation it triggered commits.
  const [prevCommitted, setPrevCommitted] = useState(committed);
  if (
    committed[0] !== prevCommitted[0] ||
    committed[1] !== prevCommitted[1]
  ) {
    setPrevCommitted(committed);
    setDraft(null);
  }
  const shown = draft ?? committed;

  const commit = ([minPos, maxPos]: [number, number]) => {
    if (!Number.isFinite(minPos) || !Number.isFinite(maxPos)) return;
    if (minPos === committed[0] && maxPos === committed[1]) return;
    const sp = new URLSearchParams(searchParams.toString());
    if (minPos <= 0) sp.delete("min");
    else sp.set("min", String(minPos * 60));
    if (maxPos >= SLIDER_MAX) sp.delete("max");
    else sp.set("max", String(maxPos * 60));
    const qs = sp.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, {
        scroll: false,
      });
    });
  };

  const maxText = (p: number) => (p >= SLIDER_MAX ? "30m+" : `${p}m`);
  const label =
    shown[0] === 0 && shown[1] === SLIDER_MAX
      ? "Any"
      : `${shown[0]}m–${maxText(shown[1])}`;

  return (
    <div
      className="inline-flex h-11 shrink-0 items-center gap-2.5 rounded-full bg-white px-4 shadow-sm"
      title="Video length range"
    >
      <Timer size={16} weight="bold" className="shrink-0 text-slate-400" />
      <span className="shrink-0 text-[11px] font-bold text-slate-400">
        0m
      </span>
      <Slider
        min={0}
        max={SLIDER_MAX}
        step={1}
        minStepsBetweenThumbs={1}
        value={shown}
        onValueChange={(v) => setDraft(v as [number, number])}
        onValueCommit={(v) => commit(v as [number, number])}
        thumbLabels={["Minimum video length", "Maximum video length"]}
        className="w-28 sm:w-36"
      />
      <span className="shrink-0 text-[11px] font-bold text-slate-400">
        30m+
      </span>
      {isPending ? (
        <SpinnerGap
          size={16}
          weight="bold"
          className="w-12 animate-spin text-primary"
        />
      ) : (
        <span className="w-12 shrink-0 text-right text-sm font-black text-primary">
          {label}
        </span>
      )}
    </div>
  );
}
