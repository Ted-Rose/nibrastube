import { SpinnerGap } from "@phosphor-icons/react/dist/ssr";

// Renders inside app/parent/layout.tsx below the sticky ParentNav, so this
// only fills the content area rather than the whole viewport.
export default function Loading() {
  return (
    <div className="min-h-[50vh] py-32 flex items-center justify-center">
      <SpinnerGap size={40} className="animate-spin text-primary" />
    </div>
  );
}
