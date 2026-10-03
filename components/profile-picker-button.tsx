"use client";

import { useFormStatus } from "react-dom";
import { SpinnerGap } from "@phosphor-icons/react";
import { Card, CardContent } from "@/components/ui/card";

interface ProfilePickerButtonProps {
  name: string;
  avatar: string | null;
}

// Submit button for the /kids "Who's watching?" grid — must stay inside
// the enclosing <form> (rendered by the server page) for useFormStatus to
// see the selectProfile action's pending state.
export function ProfilePickerButton({ name, avatar }: ProfilePickerButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full text-left bg-transparent border-0 p-0 hover:scale-105 transition-transform duration-300"
    >
      <Card className="border-0 shadow-none bg-transparent overflow-visible">
        <CardContent className="p-0 flex flex-col items-center">
          <div className="relative w-full aspect-square bg-white rounded-3xl shadow-xl border-4 border-transparent group-hover:border-primary flex items-center justify-center text-7xl md:text-8xl transition-colors">
            {avatar || "👶"}
            {pending && (
              <div className="absolute inset-0 rounded-3xl bg-white/70 flex items-center justify-center">
                <SpinnerGap size={48} className="animate-spin text-primary" />
              </div>
            )}
          </div>
          <h2 className="mt-6 text-3xl font-black text-slate-800 group-hover:text-primary transition-colors">
            {name}
          </h2>
        </CardContent>
      </Card>
    </button>
  );
}
