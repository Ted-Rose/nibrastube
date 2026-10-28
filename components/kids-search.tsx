"use client";

import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  MagnifyingGlass,
  SpinnerGap,
  X,
} from "@phosphor-icons/react";
import { Input } from "./ui/input";

// SSR-safe — layout effects don't run on the server.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface KidsSearchProps {
  query: string;
  placeholder: string;
  // Params the navigation drops before setting q (e.g. "song" on
  // /songs — an overlay id that must close when the feed changes).
  stripParams?: string[];
}

// Type-ahead search. Uses router.replace inside startTransition instead
// of a native <form method="GET"> submission — the latter is a full
// document navigation with no pending state and no loading.tsx
// fallback, which leaves the Android WebView looking frozen. The URL is
// rebuilt from the live search params so every other filter (view,
// channel, list, date, sort, dir, type) survives untouched, except the
// keys listed in stripParams.
export function KidsSearch({
  query,
  placeholder,
  stripParams,
}: KidsSearchProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(query);
  // Last q this component submitted or adopted — the intent the URL is
  // committed to or navigating towards. The committed URL alone can't
  // be the skip check: an in-flight navigation may be heading away from
  // it, so re-submitting its still-current q must re-navigate.
  const [submitted, setSubmitted] = useState(query);
  // Submitted q values whose navigations haven't committed yet. A
  // commit matching one is our own navigation resolving — a commit of
  // q implies every earlier entry resolved or was superseded, so drop
  // up to and including the match and keep the user's typing; any
  // other commit is external and adopted.
  const [pendingSubs, setPendingSubs] = useState<string[]>([]);
  const [prevQuery, setPrevQuery] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fresh pathname + params for the debounced callback, which fires
  // after the render that scheduled it. Synced in a layout effect —
  // commits run layout effects in the same task, so a timer scheduled
  // before this commit can't fire navigate() with the pre-commit URL
  // (a passive effect would leave that gap).
  const urlRef = useRef({ pathname, searchParams });
  useIsomorphicLayoutEffect(() => {
    urlRef.current = { pathname, searchParams };
  }, [pathname, searchParams]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (query !== prevQuery) {
    setPrevQuery(query);
    if (pendingSubs.includes(query)) {
      setPendingSubs((subs) => subs.slice(subs.indexOf(query) + 1));
    } else {
      setValue(query);
      setSubmitted(query);
      setPendingSubs([]);
    }
  }

  const navigate = (raw: string) => {
    const q = raw.trim();
    if (submitted === q) return;
    setSubmitted(q);
    setPendingSubs((subs) => [...subs, q]);
    const sp = new URLSearchParams(
      urlRef.current.searchParams.toString(),
    );
    for (const key of stripParams ?? []) sp.delete(key);
    if (q) sp.set("q", q);
    else sp.delete("q");
    const qs = sp.toString();
    const base = urlRef.current.pathname;
    const url = qs ? `${base}?${qs}` : base;
    startTransition(() => {
      router.replace(url, { scroll: false });
    });
  };

  const schedule = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      navigate(next);
    }, 300);
  };

  const cancelTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setValue(next);
    // Don't search on intermediate IME composition input.
    if ((e.nativeEvent as InputEvent).isComposing) return;
    schedule(next);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    cancelTimer();
    navigate(value);
  };

  const clear = () => {
    cancelTimer();
    setValue("");
    navigate("");
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full">
      <MagnifyingGlass
        className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
        size={24}
        weight="fill"
      />
      <form onSubmit={onSubmit}>
        <Input
          ref={inputRef}
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="h-11 rounded-full border-4 border-slate-50 bg-slate-50 pl-12 pr-12 text-base text-slate-900 shadow-inner transition-all focus:bg-white sm:h-14 sm:pl-14 sm:pr-14 sm:text-xl [&::-webkit-search-cancel-button]:appearance-none"
        />
        {isPending ? (
          <SpinnerGap
            className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
            size={24}
          />
        ) : (
          value !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clear}
              className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
            >
              <X size={22} weight="bold" />
            </button>
          )
        )}
      </form>
    </div>
  );
}
