import { SpinnerGap } from "@phosphor-icons/react/dist/ssr";

export default function Loading() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <SpinnerGap size={48} className="animate-spin text-white" />
    </div>
  );
}
