"use client";

import { logoutAction } from "@/app/actions/auth";
import { Button } from "./ui/button";
import { SignOut } from "@phosphor-icons/react";

// Log out control for the kids feed header — only rendered for
// kid-session devices (a picker-locked tablet shouldn't be one tap
// away from losing its lock).
export function KidLogoutButton() {
  return (
    <form action={logoutAction}>
      <Button
        variant="ghost"
        size="icon-touch"
        aria-label="Log out"
        className="text-slate-400 hover:text-primary"
      >
        <SignOut size={24} weight="bold" className="size-6" />
      </Button>
    </form>
  );
}
