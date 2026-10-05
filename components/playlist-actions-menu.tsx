"use client";

import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Dialog } from "@base-ui/react/dialog";
import {
  DotsThreeVertical,
  PencilSimple,
  SpinnerGap,
  Trash,
  X,
} from "@phosphor-icons/react";
import { deletePlaylist, renamePlaylist } from "@/app/actions/playlists";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none data-[highlighted]:bg-slate-100";

const popupClass =
  "fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[32px] bg-white p-6 sm:p-8 shadow-2xl";

// ⋮ menu on the playlist detail header: rename (inline input dialog) or
// delete (confirm). After delete the revalidated page redirects to the
// playlists list, so no client-side navigation is needed.
export function PlaylistActionsMenu({
  profileId,
  playlistId,
  name,
}: {
  profileId: string;
  playlistId: string;
  name: string;
}) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newName, setNewName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rename = async () => {
    const trimmed = newName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await renamePlaylist(profileId, playlistId, trimmed);
      setRenaming(false);
    } catch {
      setError("Couldn't rename — try again");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deletePlaylist(profileId, playlistId);
      setDeleting(false);
    } catch {
      setError("Couldn't delete — try again");
      setBusy(false);
    }
  };

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Playlist options"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-100"
        >
          <DotsThreeVertical size={24} weight="bold" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={8} align="end" className="z-50">
            <Menu.Popup className="min-w-56 rounded-2xl border-2 border-slate-100 bg-white p-2 shadow-xl">
              <Menu.Item
                className={itemClass}
                onClick={() => {
                  setNewName(name);
                  setError(null);
                  setRenaming(true);
                }}
              >
                <PencilSimple size={18} weight="bold" className="text-primary" />
                Rename playlist
              </Menu.Item>
              <Menu.Item
                className={itemClass}
                onClick={() => {
                  setError(null);
                  setDeleting(true);
                }}
              >
                <Trash size={18} weight="bold" className="text-red-500" />
                Delete playlist
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog.Root open={renaming} onOpenChange={setRenaming}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Popup className={popupClass}>
            <div className="mb-6 flex items-center justify-between gap-3">
              <Dialog.Title className="text-2xl font-black text-slate-900">
                Rename playlist
              </Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
              >
                <X size={20} weight="bold" />
              </Dialog.Close>
            </div>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                rename();
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={60}
                autoFocus
                className="h-14 w-full rounded-2xl border-4 border-slate-100 bg-white px-4 text-lg font-bold text-slate-800 transition-colors focus:border-primary focus:outline-none"
              />
              {error && (
                <p className="text-sm font-bold text-red-500">{error}</p>
              )}
              <button
                type="submit"
                disabled={!newName.trim() || busy}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-black text-white transition-opacity disabled:opacity-40"
              >
                {busy && (
                  <SpinnerGap size={22} weight="bold" className="animate-spin" />
                )}
                Save
              </button>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={deleting} onOpenChange={setDeleting}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Popup className={popupClass}>
            <Dialog.Title className="text-2xl font-black text-slate-900">
              Delete playlist?
            </Dialog.Title>
            <Dialog.Description className="mt-3 text-base font-medium text-slate-500">
              &quot;{name}&quot; will be gone forever. The videos stay
              approved.
            </Dialog.Description>
            {error && (
              <p className="mt-3 text-sm font-bold text-red-500">{error}</p>
            )}
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setDeleting(false)}
                className="flex h-14 items-center justify-center rounded-2xl bg-slate-100 text-lg font-black text-slate-700 transition-colors hover:bg-slate-200"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-red-500 text-lg font-black text-white transition-opacity disabled:opacity-40"
              >
                {busy && (
                  <SpinnerGap size={22} weight="bold" className="animate-spin" />
                )}
                Delete
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
