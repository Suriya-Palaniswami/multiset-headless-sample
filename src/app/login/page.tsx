"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const expected = process.env.NEXT_PUBLIC_EDITOR_PASSWORD ?? "multiset-demo";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password === expected) {
      localStorage.setItem("editorUnlocked", "true");
      router.replace("/maps");
    } else {
      setError("Incorrect password");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Multiset AR Editor</h1>
      <p className="mb-8 max-w-md text-center text-sm text-zinc-400">
        Prototype login — password is set via <code className="text-zinc-300">NEXT_PUBLIC_EDITOR_PASSWORD</code>
      </p>
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-100 outline-none ring-violet-500 focus:ring-2"
          autoComplete="current-password"
        />
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button
          type="submit"
          className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white transition hover:bg-violet-500"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
