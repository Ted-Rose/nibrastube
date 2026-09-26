"use client";

import { useSyncExternalStore } from "react";
import { AndroidLogo } from "@phosphor-icons/react";

// Shown only on Android browsers — sideloads the signed release APK
// attached to the latest GitHub release by android-release.yml.
// useSyncExternalStore keeps SSR (false) and the first client render
// consistent without a setState-in-effect.
const emptySubscribe = () => () => {};
const isAndroidClient = () => /android/i.test(navigator.userAgent);
const isAndroidServer = () => false;

export function AndroidAppLink() {
  const isAndroid = useSyncExternalStore(
    emptySubscribe,
    isAndroidClient,
    isAndroidServer,
  );

  if (!isAndroid) return null;

  return (
    <a
      href="https://github.com/Ted-Rose/nibrastube/releases/latest/download/nibrastube.apk"
      className="inline-flex items-center gap-2 rounded-full border-2 border-slate-200 px-5 py-3 font-bold text-slate-600 transition-colors hover:border-primary/40 hover:text-primary"
    >
      <AndroidLogo size={20} weight="fill" />
      Get the Android app
    </a>
  );
}
