import type { CapacitorConfig } from "@capacitor/cli";

// The app is server-rendered (Next.js), so the APK has no bundled web
// assets: the WebView loads the deployed site directly. Set
// CAPACITOR_SERVER_URL before `npx cap sync` / CI builds.
const config: CapacitorConfig = {
  appId: "com.nibrastube.app",
  appName: "NibrasTube",
  webDir: "capacitor-www",
  server: {
    url:
      process.env.CAPACITOR_SERVER_URL || "https://nibrastube.example.com",
    androidScheme: "https",
  },
};

export default config;
