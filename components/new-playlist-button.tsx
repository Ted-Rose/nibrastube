"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Plus, SpinnerGap, X } from "@phosphor-icons/react";
import { createPlaylist } from "@/app/actions/playlists";

// "New playlist" card on the playlists tab — opens a name dialog, creates
// via the server action; the revalidated grid then shows the new card.
export function NewPlaylistButton({ profileId }: { profileId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createPlaylist(profileId, trimmed);
      setOpen(false);
      setName("");
    } catch {
      setError("Couldn't create — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setName("");
          setError(null);
          setOpen(true);
        }}
        className="group"
      >
        <div className="flex h-full min-h-44 flex-col items-center justify-center gap-3 rounded-[32px] border-4 border-dashed border-slate-200 bg-white/60 p-8 text-slate-400 transition-colors group-hover:border-primary/40 group-hover:text-primary">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 transition-colors group-hover:bg-primary/10">
            <Plus size={32} weight="bold" />
          </div>
          <span className="text-xl font-black">New playlist</span>
        </div>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[32px] bg-white p-6 sm:p-8 shadow-2xl">
            <div className="mb-6 flex items-center justify-between gap-3">
              <Dialog.Title className="text-2xl font-black text-slate-900">
                New playlist
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
                create();
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Playlist name"
                maxLength={60}
                autoFocus
                className="h-14 w-full rounded-2xl border-4 border-slate-100 bg-white px-4 text-lg font-bold text-slate-800 transition-colors focus:border-primary focus:outline-none"
              />
              {error && (
                <p className="text-sm font-bold text-red-500">{error}</p>
              )}
              <button
                type="submit"
                disabled={!name.trim() || busy}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-primary text-lg font-black text-white transition-opacity disabled:opacity-40"
              >
                {busy && (
                  <SpinnerGap size={22} weight="bold" className="animate-spin" />
                )}
                Create
              </button>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
