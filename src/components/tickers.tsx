"use client";

import { useEffect, useState } from "react";
import { earnedCents, earnedCentsWithBreaks, fmtClockDuration, peso } from "@/lib/format";

/** Live-updating earnings figure that recomputes every second — no sockets needed. */
export function LiveEarnings({
  clockIn, rateCents, className = "", breakMinutes = 0, breakStartedAt = null, initialNow,
}: {
  clockIn: string | Date; rateCents: number; className?: string;
  breakMinutes?: number; breakStartedAt?: string | Date | null; initialNow?: string | Date | null;
}) {
  const clockInMs = new Date(clockIn).getTime();
  const [now, setNow] = useState(() => (initialNow ? new Date(initialNow).getTime() : clockInMs));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const cents = breakMinutes || breakStartedAt
    ? earnedCentsWithBreaks(new Date(clockIn), rateCents, breakMinutes, breakStartedAt ? new Date(breakStartedAt) : null, now)
    : earnedCents(new Date(clockIn), rateCents, now);
  return (
    <span className={`tnum ${className}`} key={Math.floor(now / 60000)}>
      {peso(cents)}
    </span>
  );
}

export function DurationTicker({ clockIn, className = "", initialNow }: { clockIn: string | Date; className?: string; initialNow?: string | Date | null }) {
  const clockInMs = new Date(clockIn).getTime();
  const [now, setNow] = useState(() => (initialNow ? new Date(initialNow).getTime() : clockInMs));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className={`tnum ${className}`}>{fmtClockDuration(now - clockInMs)}</span>;
}
