"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PUBLIC = ["/", "/login"];

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (PUBLIC.includes(pathname)) {
      if (pathname === "/login" && localStorage.getItem("editorUnlocked") === "true") {
        router.replace("/maps");
        return;
      }
      setReady(true);
      return;
    }
    const unlocked = localStorage.getItem("editorUnlocked") === "true";
    if (!unlocked) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [pathname, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading…
      </div>
    );
  }

  return <>{children}</>;
}
