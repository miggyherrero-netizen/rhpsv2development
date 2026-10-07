import Link from "next/link";
import { Lock } from "lucide-react";
import { unlockLoginForm } from "@/server/auth-actions";
import { PUB_ROOT } from "@/lib/pub-fonts";

export default async function LoginGatePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <main className={`${PUB_ROOT} pub-dark min-h-screen bg-paper text-ink flex items-center justify-center px-5`}>
      <div className="w-full max-w-sm anim-fade-up">
        <Link href="/" className="block text-center mb-10 rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky">
          <h1 className="text-3xl font-semibold text-ink tracking-[0.2em]">HERRERO</h1>
          <p className="text-[13px] text-subtle mt-2 tracking-wide">Private login access</p>
        </Link>
        <form action={unlockLoginForm} className="rounded-[14px] border border-white/10 bg-white/5 p-6">
          <label htmlFor="gate-pin" className="text-[14px] text-subtle flex items-center justify-center gap-2">
            <Lock size={16} aria-hidden="true" /> Enter PIN to open login
          </label>
          <input
            id="gate-pin"
            name="pin"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            required
            autoFocus
            autoComplete="one-time-code"
            className="input-dark text-center text-2xl tracking-[0.45em] mt-5"
            placeholder="••••"
          />
          {params.error && <p role="alert" className="text-red-300 text-[14px] anim-shake mt-4 text-center">Incorrect PIN.</p>}
          <button
            type="submit"
            className="btn-brass w-full mt-5 font-semibold text-[15.5px] rounded-full min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky"
          >
            Open login
          </button>
        </form>
      </div>
    </main>
  );
}
