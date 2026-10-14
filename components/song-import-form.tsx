"use client";

import { useActionState, useState } from "react";
import {
  importSongs,
  previewSongImport,
  saveSongCommenterHandle,
} from "@/app/actions/songs";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDuration } from "@/lib/format";

// The commenter handle is a stored preference (users.song_commenter_
// handle), saved once via its own action — it isn't re-asked per import
// and never leaves the client as a form field. "Find songs" then
// dry-runs the pipeline against the stored handle and shows the parsed
// tracklist; only "Import N songs" writes. Comment formats drift, so a
// parent eyeballs the parse before anything lands.
export function SongImportForm({
  storedHandle,
  returnTo,
}: {
  storedHandle: string | null;
  returnTo: string;
}) {
  const [saved, saveAction] = useActionState(saveSongCommenterHandle, null);
  const [preview, previewAction] = useActionState(previewSongImport, null);
  const [importResult, importAction] = useActionState(importSongs, null);
  const handle = saved && "saved" in saved ? saved.saved : storedHandle;
  // "Change" tags the handle being edited — a successful save swaps
  // `handle` to the new value, which untags and closes the editor.
  const [editingHandle, setEditingHandle] = useState<string | null>(null);
  const showEditor = !handle || editingHandle === handle;

  const ready = preview && "songs" in preview ? preview : null;
  const saveError = saved && "error" in saved ? saved.error : null;
  const error =
    (preview && "error" in preview && preview.error) ||
    (importResult && "error" in importResult && importResult.error) ||
    null;

  return (
    <div className="space-y-4">
      {!showEditor && handle ? (
        <p className="text-xs text-muted-foreground">
          Song commenter:{" "}
          <span className="font-medium text-foreground">@{handle}</span>
          {" · "}
          <button
            type="button"
            onClick={() => setEditingHandle(handle)}
            className="font-medium text-primary underline underline-offset-2"
          >
            Change
          </button>
        </p>
      ) : (
        <form action={saveAction} className="space-y-1.5">
          <Label htmlFor="song-handle">Song commenter handle</Label>
          <div className="flex gap-2">
            <Input
              id="song-handle"
              name="handle"
              placeholder="@song-commenter"
              defaultValue={handle ?? ""}
              required
            />
            <SubmitButton
              variant="outline"
              pendingLabel="Saving…"
              className="shrink-0"
            >
              Save
            </SubmitButton>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Whose timestamped comments to read when importing songs.
          </p>
          {saveError && (
            <p className="text-sm font-medium text-destructive">
              {saveError}
            </p>
          )}
        </form>
      )}

      {handle && (
        <form action={previewAction} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="song-url">Compilation video link</Label>
            <Input
              id="song-url"
              name="url"
              placeholder="https://youtube.com/watch?v=…"
              required
            />
          </div>
          <SubmitButton
            variant="outline"
            size="touch"
            pendingLabel="Scanning comments…"
            className="w-full"
          >
            Find songs
          </SubmitButton>
        </form>
      )}

      {error && (
        <p className="text-sm font-medium text-destructive">{error}</p>
      )}

      {ready && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {ready.video.thumbnail && (
              <img
                src={ready.video.thumbnail}
                alt=""
                className="w-20 shrink-0 rounded-md object-cover"
              />
            )}
            <p className="min-w-0 text-xs font-medium leading-snug line-clamp-3">
              {ready.video.title}
            </p>
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
            {ready.songs.map((song) => (
              <li key={song.startSeconds}>
                <span className="tabular-nums text-muted-foreground">
                  {formatDuration(song.startSeconds)}
                  {" – "}
                  {song.endSeconds !== null
                    ? formatDuration(song.endSeconds)
                    : "end"}
                </span>{" "}
                {song.title}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            Tracklist by @{ready.handle}
          </p>
          <form action={importAction}>
            <input type="hidden" name="videoId" value={ready.video.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <SubmitButton
              size="touch"
              pendingLabel="Importing…"
              className="w-full"
            >
              Import {ready.songs.length} song
              {ready.songs.length === 1 ? "" : "s"}
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
