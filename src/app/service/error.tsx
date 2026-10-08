"use client";

import { useEffect } from "react";

export default function ServiceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Service workspace error boundary]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-svc-bg text-paper p-6">
      <div className="max-w-md w-full space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Service Error</h1>
        <p className="text-svc-muted">
          Unable to load the service workspace. This might be a temporary connection issue.
        </p>
        {error.digest && (
          <p className="text-xs text-svc-muted font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex gap-3 justify-center pt-4">
          <button
            onClick={() => reset()}
            className="btn-svc-primary"
          >
            Try again
          </button>
          <a
            href="/"
            className="px-4 py-2 bg-transparent border border-svc-accent/30 rounded hover:border-svc-accent/50 transition-colors"
          >
            Return home
          </a>
        </div>
      </div>
    </div>
  );
}
