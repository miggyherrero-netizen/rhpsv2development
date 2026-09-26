import Link from "next/link";
import { Lock } from "lucide-react";
import { unlockLoginForm } from "@/server/auth-actions";

export default async function LoginGatePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <div className="min-h-screen bg-coal text-chrome flex items-center justify-center px-6">
      <div className="w-full max-w-sm anim-fade-up">
        <Link href="/" className="block text-center mb-10">
          <p className="font-serif text-3xl text-white tracking-wide">HERRERO</p>
          <p className="text-[10px] uppercase tracking-[0.42em] text-mist mt-1.5">Private login access</p>
        </Link>
        <form action={unlockLoginForm} className="rounded-3xl border border-white/10 bg-white/[0.035] p-6">
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-mist flex items-center justify-center gap-2">
            <Lock size={12} /> Enter PIN to open login
          </p>
          <input
            name="pin"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            required
            autoFocus
            className="input-dark text-center text-2xl tracking-[0.45em] mt-5"
            placeholder="0000"
          />
          {params.error && <p className="text-rose-400 text-xs anim-shake mt-4 text-center">Incorrect PIN.</p>}
          <button
            type="submit"
            className="w-full mt-5 bg-white text-black font-medium text-sm rounded-xl py-3 hover:bg-chrome transition"
          >
            Open login
          </button>
        </form>
      </div>
    </div>
  );
}
