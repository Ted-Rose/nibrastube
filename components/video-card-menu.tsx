"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  DotsThreeVertical,
  Playlist,
  SpinnerGap,
  XCircle,
} from "@phosphor-icons/react";
import { removeFromPlaylist } from "@/app/actions/playlists";
import { useSaveToPlaylist } from "./save-to-playlist-dialog";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none data-[highlighted]:bg-slate-100";

// ⋮ menu overlaid on a video card's thumbnail (and on playlist rows).
// `playlistId` set = rendered inside that playlist's detail view, so it
// also offers "Remove from this playlist".
export function VideoCardMenu({
  profileId,
  videoId,
  playlistId,
}: {
  profileId: string;
  videoId: string;
  playlistId?: string;
}) {
  const saveTo = useSaveToPlaylist();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!playlistId || removing) return;
    setRemoving(true);
    setError(null);
    try {
      await removeFromPlaylist(profileId, playlistId, videoId);
      setOpen(false);
    } catch {
      setError("Couldn't remove — try again");
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
        aria-label="Video options"
        className="absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow transition-colors hover:bg-white"
      >
        <DotsThreeVertical size={20} weight="bold" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup className="min-w-56 rounded-2xl border-2 border-slate-100 bg-white p-2 shadow-xl">
            <Menu.Item
              className={itemClass}
              onClick={() => saveTo?.openFor(videoId)}
            >
              <Playlist size={18} weight="bold" className="text-primary" />
              Save to playlist
            </Menu.Item>
            {playlistId && (
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
                  <XCircle size={18} weight="bold" className="text-red-500" />
                )}
                Remove from this playlist
              </Menu.Item>
            )}
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
