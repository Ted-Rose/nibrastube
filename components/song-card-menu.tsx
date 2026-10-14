"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  DotsThreeVertical,
  SpinnerGap,
  Trash,
} from "@phosphor-icons/react";
import { deleteSong } from "@/app/actions/songs";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none data-[highlighted]:bg-slate-100";

// ⋮ menu overlaid on a song card's thumbnail — a single owner-only
// "Delete song" action. The card renders this only when
// importedBy === session.user.id; deleteSong re-checks it server-side.
export function SongCardMenu({ songId }: { songId: string }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    setError(null);
    try {
      const result = await deleteSong(songId);
      if (result && "error" in result) {
        setError(result.error ?? "Couldn't delete — try again");
      } else {
        setOpen(false);
      }
    } catch {
      setError("Couldn't delete — try again");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Menu.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <Menu.Trigger
        aria-label="Song options"
        className="absolute top-2 right-0.5 z-10 flex h-10 w-10 items-center justify-center rounded-full text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] transition-all hover:scale-110"
      >
        <DotsThreeVertical size={26} weight="bold" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup className="min-w-56 rounded-2xl border-2 border-slate-100 bg-white p-2 shadow-xl">
            <Menu.Item
              className={itemClass}
              disabled={removing}
              // Stays open while removing so a failure can show the
              // error below; success closes the menu explicitly.
              closeOnClick={false}
              onClick={remove}
            >
              {removing ? (
                <SpinnerGap
                  size={18}
                  weight="bold"
                  className="animate-spin text-red-500"
                />
              ) : (
                <Trash size={18} weight="bold" className="text-red-500" />
              )}
              Delete song
            </Menu.Item>
            {error && (
              <p className="px-4 py-2 text-sm font-bold text-red-500">
                {error}
              </p>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
