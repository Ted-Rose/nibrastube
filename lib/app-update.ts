import { App } from "@capacitor/app";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

// Published by android-release.yml on every main push — fixed URL on
// the rolling `continuous` prerelease. WebView fetch() to github.com
// is CORS-blocked, so the manifest is read through CapacitorHttp
// (native network stack, no CORS).
const MANIFEST_URL =
  "https://github.com/Ted-Rose/nibrastube/releases/download/" +
  "continuous/update.json";

// Check at most once per hour per device; stamped ONLY once the
// check's outcome is known good ("update"/"current") — a fetch,
// validation, or version-read failure must not suppress retries.
const THROTTLE_KEY = "nibrastube:update-checked-at";
const THROTTLE_MS = 60 * 60 * 1000;

export type UpdateCheck =
  | {
      kind: "update";
      apkUrl: string;
      versionCode: number;
      versionName: string;
    }
  | { kind: "current" }
  // web platform, throttled, or a debug/dev build (auto checks only)
  | { kind: "skipped" }
  | { kind: "error" };

export type CheckOptions = {
  // Manual checks (the settings-page button) bypass the throttle
  // entirely — no read, no stamp — and report every outcome. The
  // debug-build skip stays an automatic-checks-only rule so a manual
  // check on a dev APK still runs.
  force?: boolean;
};

// A compromised or malformed manifest must not smuggle javascript:/
// intent: URLs into window.open — only https on GitHub hosts.
function isTrustedApkUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "github.com" ||
        u.hostname.endsWith(".githubusercontent.com"))
    );
  } catch {
    return false;
  }
}

// Never throws — callers render nothing on "skipped"/"error".
export async function checkForAppUpdate(
  options?: CheckOptions
): Promise<UpdateCheck> {
  if (!Capacitor.isNativePlatform()) return { kind: "skipped" };

  const force = options?.force === true;
  if (!force) {
    try {
      const last = Number(localStorage.getItem(THROTTLE_KEY) ?? 0);
      if (Date.now() - last < THROTTLE_MS) return { kind: "skipped" };
    } catch {
      // localStorage unavailable — check anyway.
    }
  }

  let manifest: unknown;
  try {
    const res = await CapacitorHttp.get({ url: MANIFEST_URL });
    if (res.status !== 200) return { kind: "error" };
    // Release assets serve as octet-stream, so res.data may be a raw
    // string needing a parse, or an already-parsed object.
    manifest =
      typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  } catch {
    return { kind: "error" };
  }

  const m = manifest as {
    versionCode?: unknown;
    versionName?: unknown;
    apkUrl?: unknown;
  };
  if (
    typeof m?.versionCode !== "number" ||
    !Number.isInteger(m.versionCode) ||
    m.versionCode <= 0 ||
    typeof m?.apkUrl !== "string" ||
    !isTrustedApkUrl(m.apkUrl)
  ) {
    return { kind: "error" };
  }

  // App.getInfo() rejects on APKs built before @capacitor/app shipped
  // (v0.1.0-era installs) — those need one manual sideload.
  let installed: number;
  let versionName: string;
  try {
    const info = await App.getInfo();
    installed = parseInt(info.build, 10);
    versionName = info.version;
  } catch {
    return { kind: "error" };
  }
  if (!Number.isInteger(installed) || installed <= 0) {
    return { kind: "error" };
  }

  // Debug/dev APKs carry a debug-* versionName (CI debug artifacts)
  // or the gradlew default "1.0" (local builds) — they skip the
  // automatic nag so a stale test build doesn't pester about the
  // release channel. Manual checks still run the full flow.
  if (
    !force &&
    (versionName === "1.0" || versionName.startsWith("debug-"))
  ) {
    return { kind: "skipped" };
  }

  // Every error path above returns before this point, so stamping
  // here marks only a fully-validated check as consumed. Force
  // checks never stamp — they leave the hourly cadence alone.
  if (!force) {
    try {
      localStorage.setItem(THROTTLE_KEY, String(Date.now()));
    } catch {
      // Non-fatal: next launch just checks again.
    }
  }

  if (m.versionCode > installed) {
    return {
      kind: "update",
      apkUrl: m.apkUrl,
      versionCode: m.versionCode,
      versionName:
        typeof m.versionName === "string" ? m.versionName : "",
    };
  }
  return { kind: "current" };
}
