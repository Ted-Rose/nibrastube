import Link from "next/link";
import { Playlist } from "@phosphor-icons/react/dist/ssr";
import { Card, CardContent } from "@/components/ui/card";
import { LinkPendingSpinner } from "./link-pending-spinner";

// Shared channel/playlist tile: thumbnail or fallback, title and a
// "N videos" count. `variant` keeps the two original layouts — "cover" is
// the playlist card (aspect-video image on top), "avatar" the channel
// card (centered round thumbnail).
export function KidsTileCard({
  href,
  title,
  count,
  thumbnail,
  variant,
}: {
  href: string;
  title: string;
  count: number;
  thumbnail?: string | null;
  variant: "cover" | "avatar";
}) {
  const caption = (
    <>
      {count} {count === 1 ? "video" : "videos"}
    </>
  );

  if (variant === "avatar") {
    return (
      <Link href={href} className="group">
        <Card className="relative overflow-hidden border-0 shadow-lg rounded-[32px] group-hover:-translate-y-2 transition-transform duration-300 bg-white">
          <LinkPendingSpinner
            size={24}
            weight="bold"
            className="absolute right-5 top-5 text-slate-400"
          />
          <CardContent className="p-8 flex flex-col items-center text-center gap-4">
            {thumbnail ? (
              <img
                src={thumbnail}
                className="w-24 h-24 rounded-full object-cover border-4 border-slate-100"
                alt={title}
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-primary/10 text-primary border-4 border-slate-100 flex items-center justify-center text-4xl font-black">
                {title.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h3 className="text-xl font-bold line-clamp-2 leading-tight text-slate-900 group-hover:underline">
                {title}
              </h3>
              <p className="text-slate-500 mt-2 font-medium">{caption}</p>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <Link href={href} className="group">
      <Card className="relative overflow-hidden border-0 shadow-lg rounded-[32px] group-hover:-translate-y-2 transition-transform duration-300 bg-white">
        <LinkPendingSpinner
          size={24}
          weight="bold"
          className="absolute right-5 top-5 z-10 text-slate-400"
        />
        {thumbnail ? (
          <div className="aspect-video">
            <img
              src={thumbnail}
              className="w-full h-full object-cover"
              alt={title}
            />
          </div>
        ) : (
          <div className="aspect-video bg-primary/10 flex items-center justify-center text-primary">
            <Playlist size={56} weight="fill" />
          </div>
        )}
        <CardContent className="p-6">
          <h3 className="text-xl font-bold line-clamp-2 leading-tight text-slate-900 group-hover:underline">
            {title}
          </h3>
          <p className="text-slate-500 mt-2 font-medium">{caption}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
