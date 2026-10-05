"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  CheckCircle,
  Playlist,
  Plus,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import {
  addToPlaylist,
  createPlaylist,
  getVideoPlaylistIds,
  removeFromPlaylist,
} from "@/app/actions/playlists";
import type { KidsPlaylist } from "@/lib/kids-feed";

interface SaveToPlaylistContextValue {
  openFor: (videoId: string) => void;
}

const SaveToPlaylistContext =
  createContext<SaveToPlaylistContextValue | null>(null);

// Null when a card renders outside the provider — the ⋮ menu keeps working,
// its "Save to playlist" item just no-ops.
export function useSaveToPlaylist() {
  return useContext(SaveToPlaylistContext);
}

// One dialog + one playlists snapshot shared by every video card's ⋮ menu
// on the portal grid. Wrap it around anything rendering VideoCardMenu.
export function SaveToPlaylistProvider({
  profileId,
  playlists,
  children,
}: {
  profileId: string;
  playlists: KidsPlaylist[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  // Playlist ids containing videoId; null while loading.
  const [members, setMembers] = useState<Set<string> | null>(null);
  // Playlists created from this dialog before the revalidated prop lands.
  const [extra, setExtra] = useState<KidsPlaylist[]>([]);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openFor = useCallback(
    (id: string) => {
      setVideoId(id);
      setOpen(true);
      setMembers(null);
      setNewName("");
      setError(null);
      getVideoPlaylistIds(profileId, id)
        .then((ids) => setMembers(new Set(ids)))
        .catch(() => setMembers(new Set()));
    },
    [profileId]
  );

  const all = [
    ...playlists,
    ...extra.filter((p) => !playlists.some((q) => q.id === p.id)),
  ];

  const toggle = async (playlistId: string) => {
    if (!videoId || !members || busy) return;
    const wasMember = members.has(playlistId);
    const next = new Set(members);
    if (wasMember) next.delete(playlistId);
    else next.add(playlistId);
    setMembers(next);
    setBusy(true);
    setError(null);
    try {
      if (wasMember) {
        await removeFromPlaylist(profileId, playlistId, videoId);
      } else {
        await addToPlaylist(profileId, playlistId, videoId);
      }
    } catch {
      setMembers(members); // revert the optimistic toggle
      setError("Couldn't save — try again");
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!videoId || !name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const playlist = await createPlaylist(profileId, name);
      setExtra((prev) => [
        ...prev,
        {
          id: playlist.id,
          name: playlist.name,
          videoCount: 0,
          coverThumbnail: null,
        },
      ]);
      setNewName("");
      await addToPlaylist(profileId, playlist.id, videoId);
      setMembers((prev) => new Set(prev).add(playlist.id));
    } catch {
      setError("Couldn't create — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SaveToPlaylistContext.Provider value={{ openFor }}>
      {children}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[80vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[32px] bg-white p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center justify-between gap-3 mb-6">
              <Dialog.Title className="text-2xl font-black text-slate-900">
                Save to playlist
              </Dialog.Title>
              <Dialog.Close
                aria-label="Close"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
              >
                <X size={20} weight="bold" />
              </Dialog.Close>
            </div>

            {all.length === 0 && (
              <p className="mb-4 text-lg font-bold text-slate-400">
                No playlists yet — make one below!
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {all.map((p) => {
                const isMember = members?.has(p.id) ?? false;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={!members || busy}
                      onClick={() => toggle(p.id)}
                      className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-100 disabled:opacity-60"
                    >
                      <CheckCircle
                        size={28}
                        weight={isMember ? "fill" : "bold"}
                        className={
                          isMember ? "shrink-0 text-primary" : "shrink-0 text-slate-300"
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-lg font-bold text-slate-800">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-sm font-bold text-slate-400">
                        {p.videoCount}{" "}
                        {p.videoCount === 1 ? "video" : "videos"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {members === null && (
              <div className="mt-4 flex justify-center text-slate-300">
                <SpinnerGap size={28} className="animate-spin" />
              </div>
            )}

            {/* New playlist — creates it and adds the video in one tap */}
            <form
              className="mt-4 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                createAndAdd();
              }}
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Playlist size={24} weight="bold" />
              </div>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New playlist name"
                maxLength={60}
                className="h-12 min-w-0 flex-1 rounded-2xl border-4 border-slate-100 bg-white px-4 text-base font-bold text-slate-800 transition-colors focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={!newName.trim() || busy}
                aria-label="Create playlist"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-white transition-opacity disabled:opacity-40"
              >
                <Plus size={24} weight="bold" />
              </button>
            </form>

            {error && (
              <p className="mt-3 text-center text-sm font-bold text-red-500">
                {error}
              </p>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </SaveToPlaylistContext.Provider>
  );
}
