"use client";

import { Menu } from "@base-ui/react/menu";
import { AndroidLogo, CaretDown, GithubLogo } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

// Fallback href — the fixed-name asset every main publish still
// re-uploads. The resolved link prefers the newest never-re-uploaded
// versioned asset (nibrastube-<run>.apk) so a tap mid-publish can't
// catch the fixed file half-replaced ("problem parsing the package").
const FALLBACK_APK_URL =
  "https://github.com/Ted-Rose/nibrastube/releases/download/" +
  "continuous/nibrastube.apk";
// api.github.com is the one GitHub host that sends ACAO — a browser
// fetch can list release assets; the browser_download_url it returns
// is only navigated to, so no CORS on the APK itself is needed.
const RELEASE_API_URL =
  "https://api.github.com/repos/Ted-Rose/nibrastube/releases/tags/" +
  "continuous";
const RELEASES_URL = "https://github.com/Ted-Rose/nibrastube/releases";

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 " +
  "text-sm font-bold text-slate-700 outline-none " +
  "data-[highlighted]:bg-slate-100";

// Shared by both AndroidLogo uses; spreading keeps the className'd
// one inside the 79-col limit.
const logoProps = { size: 18, weight: "fill" } as const;

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

// Picks the versioned asset with the highest run number.
function newestApkUrl(assets: ReleaseAsset[]): string | null {
  let best: ReleaseAsset | null = null;
  let bestRun = -1;
  for (const asset of assets) {
    const run = Number(/^nibrastube-(\d+)\.apk$/.exec(asset.name ?? "")?.[1]);
    if (Number.isInteger(run) && run > bestRun) {
      best = asset;
      bestRun = run;
    }
  }
  return typeof best?.browser_download_url === "string"
    ? best.browser_download_url
    : null;
}

export function AppInstallMenu() {
  const [apkUrl, setApkUrl] = useState(FALLBACK_APK_URL);

  useEffect(() => {
    let cancelled = false;
    fetch(RELEASE_API_URL)
      .then((res) => (res.ok ? res.json() : null))
      .then((release) => {
        if (cancelled || !Array.isArray(release?.assets)) return;
        const url = newestApkUrl(release.assets);
        if (url) setApkUrl(url);
      })
      .catch(() => {
        // Offline / rate-limited — the fixed-name fallback stays.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
              href={apkUrl}
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
