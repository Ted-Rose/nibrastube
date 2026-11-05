"use client";

import { useTransition } from "react";
import { Check, X } from "@phosphor-icons/react";
import { setSongFlag } from "@/app/actions/songs";
import { cn } from "@/lib/utils";

// Song / not-a-song pill toggle for the import card's song rows.
// ON = the row is a song; OFF = might_not_be_song (hidden from shared
// /songs surfaces). Presentational — callers own the state: the
// preview keeps local overrides that serialize into the import form,
// the imported list uses SongFlagToggleAction to write through.
export function SongFlagToggle({
  flagged,
  onToggle,
  disabled,
}: {
  flagged: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={flagged}
      title={
        flagged
          ? "Marked not a song — tap to mark as song"
          : "A song — tap to mark as not a song"
      }
      disabled={disabled}
      onClick={() => onToggle(!flagged)}
      className={cn(
        "ml-2 inline-flex shrink-0 items-center gap-1 rounded-full",
        "px-2 py-0.5 font-bold transition-colors disabled:opacity-50",
        flagged
          ? "bg-amber-100 text-amber-700"
          : "bg-primary/10 text-primary"
      )}
    >
      {flagged ? (
        <X size={11} weight="bold" />
      ) : (
        <Check size={11} weight="bold" />
      )}
      {flagged ? "not a song" : "song"}
    </button>
  );
}

// Post-import variant: writes songs.might_not_be_song straight through
// the owner-gated action; revalidatePath refreshes the row's state. A
// failed write snaps the pill back on re-render.
export function SongFlagToggleAction({
  songId,
  flagged,
}: {
  songId: string;
  flagged: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <SongFlagToggle
      flagged={flagged}
      disabled={pending}
      onToggle={(next) =>
        startTransition(async () => {
          await setSongFlag(songId, next);
        })
      }
    />
  );
}
