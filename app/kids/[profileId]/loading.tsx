import { SpinnerGap } from "@phosphor-icons/react/dist/ssr";

export default function Loading() {
  return (
    <div className="min-h-screen bg-[#F0F4FF] flex items-center justify-center">
      <SpinnerGap size={64} weight="bold" className="animate-spin text-primary" />
    </div>
  );
}
