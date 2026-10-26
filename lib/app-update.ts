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
  | { kind: "skipped" } // web platform, or throttled
  | { kind: "error" };

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
export async function checkForAppUpdate(): Promise<UpdateCheck> {
  if (!Capacitor.isNativePlatform()) return { kind: "skipped" };

  try {
    const last = Number(localStorage.getItem(THROTTLE_KEY) ?? 0);
    if (Date.now() - last < THROTTLE_MS) return { kind: "skipped" };
  } catch {
    // localStorage unavailable — check anyway.
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
  try {
    const info = await App.getInfo();
    installed = parseInt(info.build, 10);
  } catch {
    return { kind: "error" };
  }
  if (!Number.isInteger(installed) || installed <= 0) {
    return { kind: "error" };
  }

  // Every error path above returns before this point, so stamping
  // here marks only a fully-validated check as consumed.
  try {
    localStorage.setItem(THROTTLE_KEY, String(Date.now()));
  } catch {
    // Non-fatal: next launch just checks again.
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
