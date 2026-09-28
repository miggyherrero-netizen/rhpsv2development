"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { login } from "@/server/auth-actions";
import { Spinner } from "@/components/ui";

export default function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await login(email, password);
    if (res.ok) {
      router.push("/admin");
      router.refresh();
    } else {
      setError(res.error ?? "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-coal text-chrome flex">
      <div className="hidden lg:block relative w-[46%] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/hero.jpg" alt="Herrero Pianos atelier" className="absolute inset-0 h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/25 to-coal" />
        <div className="absolute bottom-10 left-10 right-10">
          <p className="text-[10px] uppercase tracking-[0.3em] text-white/50 mb-3">The Herrero Atelier</p>
          <p className="font-serif text-2xl text-white/90 leading-snug max-w-md">
            “Every instrument that leaves this room carries our signature.”
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm anim-fade-up">
          <Link href="/" className="block text-center mb-10">
            <p className="font-serif text-3xl text-white tracking-wide">HERRERO</p>
            <p className="text-[10px] uppercase tracking-[0.42em] text-mist mt-1.5">Pianos · Command Center</p>
          </Link>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-[11px] uppercase tracking-[0.16em] text-mist mb-1.5">Email</label>
              <input
                type="email" required autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-dark" placeholder="you@herrero.ph"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.16em] text-mist mb-1.5">Password</label>
              <input
                type="password" required autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-dark" placeholder="••••••••"
              />
            </div>
            {error && <p className="text-rose-400 text-xs anim-shake">{error}</p>}
            <button
              type="submit" disabled={busy}
              className="w-full mt-2 bg-white text-black font-medium text-sm rounded-xl py-3 hover:bg-chrome transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy && <Spinner className="text-black" />}
              Enter the atelier
            </button>
          </form>
          <p className="text-center text-[11px] text-mist/70 mt-8">
            Staff working today? <Link href="/workshop" className="text-chrome underline underline-offset-4">Open the workshop kiosk</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
