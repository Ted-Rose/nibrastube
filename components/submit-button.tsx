"use client";

import { useFormStatus } from "react-dom";
import { SpinnerGap } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import type { ComponentProps } from "react";

interface SubmitButtonProps extends ComponentProps<typeof Button> {
  pendingLabel?: string;
}

// Submit button that disables itself and shows a spinner while the
// enclosing <form>'s server action is running — must be rendered inside
// a <form> for useFormStatus to see the pending state.
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (
        <>
          <SpinnerGap className="animate-spin" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
