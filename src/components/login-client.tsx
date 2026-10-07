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
      router.push("/start");
      router.refresh();
    } else {
      setError(res.error ?? "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <div className="adm-shell min-h-screen bg-coal text-chrome flex">
      <div className="hidden lg:block relative w-[46%] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/hero.jpg" alt="Herrero Pianos atelier" className="absolute inset-0 h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/25 to-coal" />
        <div className="absolute bottom-10 left-10 right-10">
          <p className="text-xs uppercase tracking-[0.24em] text-white/80 mb-3">The Herrero Atelier</p>
          <p className="font-serif text-2xl text-white leading-snug max-w-md">
            “Every instrument that leaves this room carries our signature.”
          </p>
        </div>
      </div>

      <main id="main" className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm anim-fade-up card-dark p-7 sm:p-8 shadow-2xl shadow-black/40">
          <Link href="/" className="block text-center mb-8">
            <h1 className="font-serif text-3xl text-white tracking-[0.14em]">HERRERO</h1>
            <p className="text-xs uppercase tracking-[0.3em] text-mist mt-2">Pianos · Command Center</p>
          </Link>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-xs font-medium uppercase tracking-[0.08em] text-mist mb-1.5">Email</label>
              <input
                id="login-email"
                type="email" required autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-dark" placeholder="you@herrero.ph"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-xs font-medium uppercase tracking-[0.08em] text-mist mb-1.5">Password</label>
              <input
                id="login-password"
                type="password" required autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-dark" placeholder="••••••••"
              />
            </div>
            {error && <p role="alert" className="text-red-400 text-sm anim-shake">{error}</p>}
            <button
              type="submit" disabled={busy}
              className="btn-brass w-full mt-2 min-h-12 font-semibold text-base rounded-[10px] disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {busy && <Spinner className="text-[#04210F]" />}
              Enter the atelier
            </button>
          </form>
          <p className="text-center text-sm text-mist mt-8">
            Staff working today? <Link href="/workshop" className="inline-flex items-center min-h-11 text-chrome underline underline-offset-4 hover:text-white">Open the workshop kiosk</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
