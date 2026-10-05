import { SpinnerGap } from "@phosphor-icons/react/dist/ssr";

export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <SpinnerGap size={40} className="animate-spin text-primary" />
    </div>
  );
}
