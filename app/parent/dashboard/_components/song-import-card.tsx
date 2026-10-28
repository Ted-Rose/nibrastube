import { asc, eq } from "drizzle-orm";
import { MusicNotes } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/lib/db";
import { songs, users } from "@/lib/db/schema";
import { formatDuration } from "@/lib/format";
import { SongImportForm } from "./song-import-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Songs are a global registry, not profile-scoped — this card takes no
// profileId. The imported list renders when importSongs redirects back
// with ?songsVideo=<id>.
export async function SongImportCard({
  userId,
  songsVideo,
  returnTo,
}: {
  userId: string;
  songsVideo: string | undefined;
  returnTo: string;
}) {
  const [user, importedSongs] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { songCommenterHandle: true },
    }),
    songsVideo
      ? db
          .select()
          .from(songs)
          .where(eq(songs.videoId, songsVideo))
          .orderBy(asc(songs.startSeconds))
      : Promise.resolve([]),
  ]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center">
          <MusicNotes size={20} className="mr-2 text-primary" /> Import Songs
        </CardTitle>
        <CardDescription>
          Turn a commenter&apos;s timestamped tracklist into songs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SongImportForm
          storedHandle={user?.songCommenterHandle ?? null}
          returnTo={returnTo}
        />
        {importedSongs.length > 0 && (
          <div className="border-t pt-3">
            <p className="pb-2 text-xs text-muted-foreground">
              {importedSongs.length} song
              {importedSongs.length === 1 ? "" : "s"}
              {importedSongs[0].sourceHandle &&
                ` from @${importedSongs[0].sourceHandle}`}
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
              {importedSongs.map((song) => (
                <li key={song.id}>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
