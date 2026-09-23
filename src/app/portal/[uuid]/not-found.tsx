import Link from "next/link";
import { ShieldOff } from "lucide-react";

export default function PortalNotFound() {
  return (
    <div className="min-h-screen bg-coal text-chrome flex flex-col items-center justify-center px-6 text-center">
      <ShieldOff size={30} strokeWidth={1.5} className="text-mist/50 mb-5" />
      <p className="text-[10px] uppercase tracking-[0.36em] text-mist/60">Herrero Pianos · Private exhibit</p>
      <h1 className="font-serif text-3xl text-white mt-3">This exhibit link isn&apos;t valid</h1>
      <p className="text-mist text-sm mt-3 max-w-sm leading-relaxed">
        Private restoration journals are shared through personal links. Please ask the atelier to reissue yours.
      </p>
      <Link href="/" className="mt-8 text-[12.5px] bg-white text-black rounded-full px-5 py-2.5 hover:bg-chrome transition">
        Visit Herrero Pianos
      </Link>
    </div>
  );
}
