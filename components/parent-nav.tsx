"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Baby,
  List,
  PlayCircle,
  SignOut,
  Users,
  X,
} from "@phosphor-icons/react";
import { Button } from "./ui/button";
import { SubmitButton } from "./submit-button";
import { logoutAction } from "@/app/actions/auth";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/parent/dashboard", label: "Dashboard", icon: PlayCircle },
  { href: "/parent/profiles", label: "Manage Kids", icon: Users },
  { href: "/kids", label: "Kids Corner", icon: Baby },
];

interface ParentNavProps {
  userName?: string | null;
}

export function ParentNav({ userName }: ParentNavProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const linkClass = (href: string) =>
    cn(
      "inline-flex h-11 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors",
      pathname.startsWith(href)
        ? "bg-muted text-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    );

  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur pt-[env(safe-area-inset-top)]">
      <div className="container mx-auto flex h-14 items-center justify-between gap-3 px-4">
        <Link
          href="/parent/dashboard"
          className="flex items-center gap-2"
          onClick={() => setOpen(false)}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <PlayCircle size={20} weight="fill" />
          </div>
          <span className="text-lg font-black tracking-tight text-foreground">
            NibrasTube
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={linkClass(href)}>
              <Icon size={18} weight="bold" />
              {label}
            </Link>
          ))}
          <form action={logoutAction} className="ml-1">
            <SubmitButton
              variant="ghost"
              size="touch"
              pendingLabel="Logging out…"
            >
              <SignOut size={18} weight="bold" />
              Logout
            </SubmitButton>
          </form>
        </nav>

        {/* Mobile menu toggle */}
        <Button
          variant="ghost"
          size="icon-touch"
          className="sm:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={24} /> : <List size={24} />}
        </Button>
      </div>

      {/* Mobile nav panel */}
      {open && (
        <nav className="flex flex-col gap-1 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={linkClass(href)}
              onClick={() => setOpen(false)}
            >
              <Icon size={18} weight="bold" />
              {label}
            </Link>
          ))}
          <form action={logoutAction} className="mt-1">
            <SubmitButton
              variant="ghost"
              className="h-11 w-full justify-start px-4 text-sm"
              pendingLabel="Logging out…"
            >
              <SignOut size={18} weight="bold" />
              Logout
            </SubmitButton>
          </form>
          {userName && (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              Signed in as {userName}
            </p>
          )}
        </nav>
      )}
    </header>
  );
}
