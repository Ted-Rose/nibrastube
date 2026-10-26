"use client";

import { Menu } from "@base-ui/react/menu";
import { AndroidLogo, CaretDown, GithubLogo } from "@phosphor-icons/react";
import { Button } from "./ui/button";

// Every main push republishes the signed APK on the rolling
// `continuous` prerelease under a fixed name, so this URL always
// serves the newest build. releases/latest stays on v* milestones.
const APK_URL =
  "https://github.com/Ted-Rose/nibrastube/releases/download/" +
  "continuous/nibrastube.apk";
const RELEASES_URL = "https://github.com/Ted-Rose/nibrastube/releases";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 " +
  "text-sm font-bold text-slate-700 outline-none " +
  "data-[highlighted]:bg-slate-100";

// Shared by both AndroidLogo uses; spreading keeps the className'd
// one inside the 79-col limit.
const logoProps = { size: 18, weight: "fill" } as const;

export function AppInstallMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button variant="outline" size="touch" className="gap-2">
            <AndroidLogo {...logoProps} />
            Get the app
            <CaretDown size={14} weight="bold" />
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup
            className={
              "min-w-56 rounded-2xl border-2 border-slate-100 " +
              "bg-white p-2 shadow-xl"
            }
          >
            <Menu.LinkItem
              href={APK_URL}
              closeOnClick
              label="Install Android app"
              className={itemClass}
            >
              <AndroidLogo {...logoProps} className="text-green-600" />
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
