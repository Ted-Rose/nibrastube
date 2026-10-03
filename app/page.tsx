import { redirect } from "next/navigation";

// The landing page was removed; proxy.ts routes `/` to /kids
// (signed in) or /signup (signed out). This stub is a safety net.
export default function RootPage() {
  redirect("/signup");
}
