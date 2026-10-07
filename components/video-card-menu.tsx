"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import {
  DotsThreeVertical,
  Playlist,
  SpinnerGap,
  XCircle,
} from "@phosphor-icons/react";
import {
  addToPlaylist,
  removeFromPlaylist,
} from "@/app/actions/playlists";
import type { KidsPlaylist } from "@/lib/kids-feed";
import { cn } from "@/lib/utils";
import { useSaveToPlaylist } from "./save-to-playlist-dialog";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none data-[highlighted]:bg-slate-100";

// ⋮ menu overlaid on a video card's thumbnail (and on playlist rows).
// `playlistId` set = rendered inside that playlist's detail view, so it
// also offers "Remove from this playlist". "overlay" draws bare white
// dots over a thumbnail; "inline" is for rows on a white background.
export function VideoCardMenu({
  profileId,
  videoId,
  playlistId,
  variant = "overlay",
}: {
  profileId: string;
  videoId: string;
  playlistId?: string;
  variant?: "overlay" | "inline";
}) {
  const saveTo = useSaveToPlaylist();
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Name of the playlist a quick-add failed on — non-null opens the error
  // dialog. Success shows no UI; the menu just closes and revalidation
  // refreshes the grid.
  const [addError, setAddError] = useState<string | null>(null);

  // The playlist this card is already inside is pointless to offer.
  const recents =
    saveTo?.recentPlaylists.filter((p) => p.id !== playlistId) ?? [];

  const quickAdd = async (playlist: KidsPlaylist) => {
    try {
      await addToPlaylist(profileId, playlist.id, videoId);
    } catch {
      setAddError(playlist.name);
    }
  };

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
    <>
      <Menu.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <Menu.Trigger
          aria-label="Video options"
          className={cn(
            "absolute top-2 right-0.5 z-10 flex h-10 w-10 items-center justify-center rounded-full transition-all",
            variant === "overlay"
              ? "text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)] hover:scale-110"
              : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          )}
        >
          <DotsThreeVertical size={26} weight="bold" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-50">
            <Menu.Popup className="min-w-56 rounded-2xl border-2 border-slate-100 bg-white p-2 shadow-xl">
              {recents.map((p) => (
                <Menu.Item
                  key={p.id}
                  className={itemClass}
                  onClick={() => quickAdd(p)}
                >
                  <Playlist
                    size={18}
                    weight="bold"
                    className="shrink-0 text-primary"
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </Menu.Item>
              ))}
              {recents.length > 0 && (
                <Menu.Separator className="mx-2 my-1 h-0.5 bg-slate-100" />
              )}
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

      <Dialog.Root
        open={addError !== null}
        onOpenChange={(next) => {
          if (!next) setAddError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[32px] bg-white p-6 sm:p-8 shadow-2xl">
            <Dialog.Title className="text-2xl font-black text-slate-900">
              Couldn&apos;t save
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-base font-medium text-slate-500">
              Adding to &quot;{addError}&quot; didn&apos;t work — try again.
            </Dialog.Description>
            <button
              type="button"
              onClick={() => setAddError(null)}
              className="mt-6 flex h-14 w-full items-center justify-center rounded-2xl bg-slate-100 text-lg font-black text-slate-700 transition-colors hover:bg-slate-200"
            >
              OK
            </button>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
