"use client";

import { useActionState, useState } from "react";
import { Check } from "@phosphor-icons/react";
import { updateKidAvatar } from "@/app/actions/profiles";
import { KID_AVATARS, isKidAvatar } from "@/lib/kid-avatars";
import { SubmitButton } from "@/components/submit-button";
import { cn } from "@/lib/utils";

interface AvatarPickerProps {
  profileId: string;
  currentAvatar: string;
}

// Emoji grid + save for the kid settings page. The big preview shows
// the tapped emoji immediately; the form posts it as a hidden field to
// updateKidAvatar. After the action runs the route re-renders, so
// `currentAvatar` catching up to `selected` is what confirms the save.
export function AvatarPicker({
  profileId,
  currentAvatar,
}: AvatarPickerProps) {
  // A parent-set avatar outside the preset list can't be re-saved —
  // start unselected so the hidden input never carries a non-preset
  // value (the server would reject it anyway).
  const [selected, setSelected] = useState<string | null>(
    isKidAvatar(currentAvatar) ? currentAvatar : null
  );
  const [state, formAction] = useActionState(updateKidAvatar, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="profileId" value={profileId} />
      <input type="hidden" name="avatar" value={selected ?? ""} />

      <div className="mb-6 flex justify-center">
        <div
          className={cn(
            "flex h-24 w-24 items-center justify-center",
            "rounded-[28px] border-4 border-primary bg-[#F0F4FF]",
            "text-6xl shadow-sm"
          )}
        >
          {selected ?? currentAvatar}
        </div>
      </div>

      <p
        className={cn(
          "mb-3 text-sm font-black uppercase",
          "tracking-wide text-slate-400"
        )}
      >
        Pick your avatar
      </p>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-6 sm:gap-3">
        {KID_AVATARS.map((emoji) => {
          const active = selected === emoji;
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => setSelected(emoji)}
              aria-pressed={active}
              aria-label={`Choose avatar ${emoji}`}
              className={cn(
                "flex aspect-square items-center justify-center",
                "rounded-2xl border-4 text-3xl transition-transform",
                "hover:scale-105 focus-visible:outline-none",
                "focus-visible:ring-4 focus-visible:ring-primary/40",
                "sm:text-4xl",
                active
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-transparent bg-slate-50 hover:bg-slate-100"
              )}
            >
              {emoji}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <SubmitButton
          size="touch"
          disabled={!selected}
          pendingLabel="Saving…"
        >
          Save avatar
        </SubmitButton>
        {state?.saved && selected === currentAvatar && (
          <p
            className={cn(
              "flex items-center gap-1 text-sm",
              "font-bold text-emerald-600"
            )}
          >
            <Check weight="bold" />
            Saved!
          </p>
        )}
        {state?.error && (
          <p className="text-sm font-medium text-destructive">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
