"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DotsSixVertical } from "@phosphor-icons/react";
import { setPlaylistOrder } from "@/app/actions/playlists";
import { cn } from "@/lib/utils";
import { VideoCardMenu } from "./video-card-menu";
import type { FeedRow } from "./kids-video-grid";

function formatDuration(seconds: number | null) {
  if (!seconds) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SortableRow({
  row,
  index,
  profileId,
  playlistId,
  feedQuery,
}: {
  row: FeedRow;
  index: number;
  profileId: string;
  playlistId: string;
  feedQuery: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.video.id });

  const pct = row.progress?.completed
    ? 100
    : row.progress && row.video.durationSeconds
      ? Math.min(
          100,
          Math.round(
            (row.progress.positionSeconds / row.video.durationSeconds) * 100
          )
        )
      : 0;
  const duration = formatDuration(row.video.durationSeconds);

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(isDragging && "relative z-20")}
    >
      <div
        className={cn(
          "relative flex items-center gap-3 sm:gap-4 rounded-3xl bg-white p-3 pr-14 sm:p-4 sm:pr-16 shadow-md transition-shadow",
          isDragging && "shadow-xl ring-4 ring-primary/20"
        )}
      >
        {/* Drag handle — the only drag activator, so vertical scrolling and
            taps elsewhere on the row don't fight drag initiation. */}
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          type="button"
          aria-label={`Move ${row.video.title}`}
          className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
        >
          <DotsSixVertical size={28} weight="bold" />
        </button>
        <span className="w-7 shrink-0 text-center text-xl font-black text-slate-300">
          {index + 1}
        </span>
        <Link
          href={`/kids/${profileId}/watch/${row.video.id}${feedQuery}`}
          className="group flex min-w-0 flex-1 items-center gap-3 sm:gap-4"
        >
          <span className="relative w-24 sm:w-32 shrink-0">
            <img
              src={row.video.thumbnail}
              alt={row.video.title}
              className="aspect-video w-full rounded-2xl object-cover"
            />
            {duration && (
              <span className="absolute bottom-1 right-1 rounded-lg bg-black/70 px-1.5 py-0.5 text-xs font-bold text-white">
                {duration}
              </span>
            )}
            {pct > 0 && (
              <span
                className="absolute bottom-0 left-0 h-1 rounded-full bg-red-600"
                style={{ width: `${pct}%` }}
              />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base sm:text-lg font-bold text-slate-900 group-hover:underline">
              {row.video.title}
            </span>
            <span className="mt-0.5 block truncate text-sm font-medium text-slate-500">
              {row.video.channelTitle}
            </span>
          </span>
        </Link>
        <VideoCardMenu
          profileId={profileId}
          videoId={row.video.id}
          playlistId={playlistId}
        />
      </div>
    </li>
  );
}

// Kid-ordered playlist detail: drag the handle to reorder (optimistic,
// reverts if the exact-set server check rejects it), tap a row to play it.
export function PlaylistSortableList({
  profileId,
  playlistId,
  rows,
  feedQuery,
}: {
  profileId: string;
  playlistId: string;
  rows: FeedRow[];
  feedQuery: string;
}) {
  const [items, setItems] = useState(rows);
  // Server rows are the source of truth — resync when a revalidation lands
  // (add/remove/unpin/cross-device reorder). Adjusting state during render
  // is React's replacement for a syncing useEffect.
  const [prevRows, setPrevRows] = useState(rows);
  if (prevRows !== rows) {
    setPrevRows(rows);
    setItems(rows);
  }

  const sensors = useSensors(useSensor(PointerSensor));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const prev = items;
    const from = items.findIndex((r) => r.video.id === active.id);
    const to = items.findIndex((r) => r.video.id === over.id);
    if (from === -1 || to === -1) return;
    const next = arrayMove(items, from, to);
    setItems(next);
    setPlaylistOrder(
      profileId,
      playlistId,
      next.map((r) => r.video.id)
    ).catch(() => setItems(prev));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={items.map((r) => r.video.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex flex-col gap-4">
          {items.map((row, i) => (
            <SortableRow
              key={row.video.id}
              row={row}
              index={i}
              profileId={profileId}
              playlistId={playlistId}
              feedQuery={feedQuery}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
