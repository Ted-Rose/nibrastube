import { redirect } from "next/navigation";

// The landing page was removed; proxy.ts routes `/` to
// /kids/<activeProfileId> (kid-locked), /parent/dashboard (signed in)
// or /signup (signed out). This stub is a safety net.
export default function RootPage() {
  redirect("/signup");
}
