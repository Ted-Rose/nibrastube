"use client";

import { useActionState } from "react";
import { importSongs, previewSongImport } from "@/app/actions/songs";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDuration } from "@/lib/format";

// Two-stage import: "Find songs" dry-runs the pipeline and shows the
// parsed tracklist; only "Import N songs" writes. Comment formats
// drift, so a parent eyeballs the parse before anything lands.
export function SongImportForm({
  defaultHandle,
  returnTo,
}: {
  defaultHandle: string | null;
  returnTo: string;
}) {
  const [preview, previewAction] = useActionState(previewSongImport, null);
  const [importResult, importAction] = useActionState(importSongs, null);
  const ready = preview && "songs" in preview ? preview : null;
  const error =
    (preview && "error" in preview && preview.error) ||
    (importResult && "error" in importResult && importResult.error) ||
    null;

  return (
    <div className="space-y-4">
      <form action={previewAction} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="song-handle">Commenter handle</Label>
          <Input
            id="song-handle"
            name="handle"
            placeholder="@tedisrozenfelds7630"
            defaultValue={defaultHandle ?? ""}
            required
          />
        </div>
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
          <form action={importAction}>
            <input type="hidden" name="videoId" value={ready.video.id} />
            <input type="hidden" name="handle" value={ready.handle} />
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
