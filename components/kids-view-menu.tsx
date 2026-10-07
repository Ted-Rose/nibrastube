"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "@base-ui/react/menu";
import {
  CaretDown,
  ClockCounterClockwise,
  Heart,
  List,
  MonitorPlay,
  Play,
  Playlist,
  SpinnerGap,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export interface KidsViewMenuItem {
  key: string;
  label: string;
  href: string;
  active: boolean;
}

const iconFor = (key: string, active: boolean): ReactNode => {
  switch (key) {
    case "videos":
      return <Play size={22} weight="fill" />;
    case "channels":
      return <MonitorPlay size={22} weight="bold" />;
    case "liked":
      return <Heart size={22} weight={active ? "fill" : "bold"} />;
    case "playlists":
      return <Playlist size={22} weight={active ? "fill" : "bold"} />;
    case "history":
      return <ClockCounterClockwise size={22} weight="bold" />;
    default:
      return null;
  }
};

// The kids feed's view picker — Videos/Channels/Liked/Playlists/History —
// collapsed into a burger menu so five tabs don't cram a phone-width row.
// Items navigate via router.push inside a transition so the trigger can
// swap its caret for a spinner (param-only navigations never fire
// loading.tsx). hrefs arrive prebuilt from the server.
export function KidsViewMenu({ items }: { items: KidsViewMenuItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const active = items.find((i) => i.active);

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Pick a view"
        className="flex w-full items-center gap-3 rounded-full bg-white px-5 py-2.5 text-lg font-black text-slate-800 shadow-sm transition-colors hover:bg-slate-50 sm:w-auto sm:px-6 sm:py-3 sm:text-xl"
      >
        <List size={26} weight="bold" className="text-slate-500" />
        {active && (
          <>
            <span className="text-primary">
              {iconFor(active.key, true)}
            </span>
            {active.label}
          </>
        )}
        {isPending ? (
          <SpinnerGap
            size={20}
            weight="bold"
            className="ml-auto animate-spin text-slate-400 sm:ml-2"
          />
        ) : (
          <CaretDown
            size={20}
            weight="bold"
            className="ml-auto text-slate-400 sm:ml-2"
          />
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="start" className="z-50">
          <Menu.Popup className="min-w-60 rounded-3xl border-4 border-slate-100 bg-white p-2 shadow-xl">
            {items.map((item) => (
              <Menu.Item
                key={item.key}
                onClick={() =>
                  startTransition(() => router.push(item.href))
                }
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3.5 text-lg font-black outline-none",
                  item.active
                    ? "bg-primary text-white"
                    : "text-slate-600 data-[highlighted]:bg-slate-100"
                )}
              >
                {iconFor(item.key, item.active)}
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
