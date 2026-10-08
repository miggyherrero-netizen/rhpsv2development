"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Root error boundary]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink text-paper p-6">
      <div className="max-w-md w-full space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="text-subtle">
          The application encountered an error. This might be a temporary issue.
        </p>
        {error.digest && (
          <p className="text-xs text-subtle font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center pt-4">
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-paper text-ink rounded hover:bg-linen transition-colors"
          >
            Try again
          </button>
          <a
            href="/login"
            className="px-4 py-2 bg-transparent border border-paper/30 rounded hover:border-paper/50 transition-colors"
          >
            Return to login
          </a>
        </div>
      </div>
    </div>
  );
}
