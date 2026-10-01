"use client";

import { Menu } from "@base-ui/react/menu";
import { AndroidLogo, CaretDown, GithubLogo } from "@phosphor-icons/react";
import { Button } from "./ui/button";

// android-release.yml attaches the signed APK to the latest GitHub
// release under a fixed name, so this URL always serves the newest build.
const APK_URL =
  "https://github.com/Ted-Rose/nibrastube/releases/latest/download/nibrastube.apk";
const RELEASES_URL = "https://github.com/Ted-Rose/nibrastube/releases";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none data-[highlighted]:bg-slate-100";

export function AppInstallMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button variant="outline" className="gap-2">
            <AndroidLogo size={18} weight="fill" />
            Get the app
            <CaretDown size={14} weight="bold" />
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup className="min-w-56 rounded-2xl border-2 border-slate-100 bg-white p-2 shadow-xl">
            <Menu.LinkItem
              href={APK_URL}
              closeOnClick
              label="Install Android app"
              className={itemClass}
            >
              <AndroidLogo size={18} weight="fill" className="text-green-600" />
              Install Android app
            </Menu.LinkItem>
            <Menu.LinkItem
              href={RELEASES_URL}
              closeOnClick
              label="All releases on GitHub"
              className={itemClass}
            >
              <GithubLogo size={18} className="text-slate-500" />
              All releases on GitHub
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
