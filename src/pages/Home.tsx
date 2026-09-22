import { useEffect, useMemo, useRef, useState } from 'react';
import AnalogDial from '@/components/AnalogDial';
import DigitalPanel from '@/components/DigitalPanel';
import { useNowSecond } from '@/hooks/useNow';
import { usePrayerTimes } from '@/hooks/usePrayerTimes';
import {
  addDays,
  buildIslamicDaySchedule,
  riyadhWallDate,
  wallDateKey,
  wallToUtcMs,
} from '@/lib/timeEngine';

/** Minimal Wake Lock typing (TS dom lib may lag). */
interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/** Screen keep-awake toggle: holds a screen wake lock while enabled (desk-clock mode). */
function useWakeLock() {
  const [active, setActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const supported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;

  useEffect(() => {
    if (!supported) return;
    const nav = navigator as unknown as {
      wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
    };
    // Guard against the async race: an in-flight request must be released if
    // the user toggles off (or unmounts) before it resolves.
    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await nav.wakeLock.request('screen');
        if (cancelled) {
          void sentinel.release();
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null;
        });
      } catch {
        if (!cancelled) setActive(false);
      }
    };

    if (active) void acquire();
    else {
      void sentinelRef.current?.release();
      sentinelRef.current = null;
    }

    // Wake locks auto-release when the page is hidden; re-acquire on return.
    const onVisible = () => {
      if (active && document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinelRef.current?.release();
      sentinelRef.current = null;
    };
  }, [active, supported]);

  return { supported, active, toggle: () => setActive((v) => !v) };
}

function CrescentOrnament() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <path
        d="M23.5 5.5A12.5 12.5 0 1 0 23.5 28.5 10.2 10.2 0 1 1 23.5 5.5Z"
        fill="#B99A45"
      />
      <path
        d="M25.4 12.2l1.1 2.4 2.6.3-1.9 1.8.5 2.6-2.3-1.3-2.3 1.3.5-2.6-1.9-1.8 2.6-.3 1.1-2.4z"
        fill="#C9A96A"
      />
    </svg>
  );
}

export default function Home() {
  const nowMs = useNowSecond();
  const { days, offline, estimated, loading, lastRefreshMs, refresh } = usePrayerTimes(nowMs);
  const wakeLock = useWakeLock();
  const [lowPower, setLowPower] = useState(false);

  // Opening-Maghrib timestamp of the current Islamic day. This is a PRIMITIVE
  // (number), so it only changes identity when the day rolls over at Maghrib
  // or when timings data changes — unlike buildIslamicDaySchedule, which
  // allocates a fresh events array on every call (fix: 1Hz re-render storm).
  const dayStartMs = useMemo(() => {
    const today = riyadhWallDate(nowMs);
    const todayEntry = days.get(wallDateKey(today));
    const yesterdayEntry = days.get(wallDateKey(addDays(today, -1)));
    if (!todayEntry || !yesterdayEntry) return 0;
    const todayMaghrib = wallToUtcMs(today, todayEntry.data.timings.Maghrib);
    const yesterdayMaghrib = wallToUtcMs(addDays(today, -1), yesterdayEntry.data.timings.Maghrib);
    return nowMs >= todayMaghrib ? todayMaghrib : yesterdayMaghrib;
  }, [nowMs, days]);

  // Rebuilt only when dayStartMs or days changes — the memoized AnalogDial
  // therefore re-renders at most once per Islamic day, not once per second.
  const schedule = useMemo(
    () => (dayStartMs ? buildIslamicDaySchedule(dayStartMs + 1, days) : null),
    [days, dayStartMs],
  );

  // Elapsed time since the current Islamic day's opening Maghrib.
  const elapsedMs = schedule ? Math.max(0, nowMs - schedule.startMs) : 0;

  // The Islamic date advances at Maghrib: after today's Maghrib the displayed
  // Hijri date is the one belonging to the new Islamic day (tomorrow's entry).
  const hijri = useMemo(() => {
    const today = riyadhWallDate(nowMs);
    const todayEntry = days.get(wallDateKey(today));
    if (!todayEntry) return null;
    const maghribMs = wallToUtcMs(today, todayEntry.data.timings.Maghrib);
    if (nowMs >= maghribMs) {
      const tomorrowEntry = days.get(wallDateKey(addDays(today, 1)));
      if (tomorrowEntry?.data.hijri) return tomorrowEntry.data.hijri;
    }
    return todayEntry.data.hijri;
  }, [nowMs, days]);

  return (
    <div
      className="min-h-[100dvh] bg-[#FAF7F2] font-sans text-[#3A352C]"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* header */}
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-8 md:px-10">
        <div className="flex items-center gap-3">
          <CrescentOrnament />
          <div>
            <h1 className="font-arabic text-2xl font-bold leading-tight text-[#1F5C4D] md:text-3xl">
              ساعة المدينة المنورة
            </h1>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#8A8172]">
              Al-Madinah al-Munawwarah clock
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {wakeLock.supported && (
            <button
              type="button"
              onClick={wakeLock.toggle}
              aria-pressed={wakeLock.active}
              className={
                wakeLock.active
                  ? 'rounded-full border border-[#1F5C4D]/30 bg-[#1F5C4D]/10 px-3 py-1.5 font-arabic text-sm text-[#1F5C4D]'
                  : 'rounded-full border border-[#E8E0D2] bg-white px-3 py-1.5 font-arabic text-sm text-[#8A8172]'
              }
              title="Keep the screen awake (desk-clock mode)"
            >
              {wakeLock.active ? 'الشاشة مضاءة' : 'إبقاء الشاشة مضاءة'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setLowPower((v) => !v)}
            aria-pressed={lowPower}
            className={
              lowPower
                ? 'rounded-full border border-[#B99A45]/40 bg-[#B99A45]/10 px-3 py-1.5 font-arabic text-sm text-[#8A6D2F]'
                : 'rounded-full border border-[#E8E0D2] bg-white px-3 py-1.5 font-arabic text-sm text-[#8A8172]'
            }
            title="Low-power mode: hands update once per second, no second hand"
          >
            توفير الطاقة
          </button>
          <p className="hidden text-right text-sm text-[#8A8172] sm:block">
            <span className="font-arabic text-base text-[#3A352C]">المدينة المنورة</span>
            <br />
            Madinah al-Munawwarah
          </p>
        </div>
      </header>

      {/* main — side-by-side on landscape phones and up */}
      <main className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-8 px-6 py-10 md:grid-cols-2 md:px-10 lg:grid-cols-[1.1fr_1fr]">
        {/* dial card */}
        <section className="flex flex-col items-center rounded-3xl bg-white p-6 shadow-[0_10px_40px_rgba(90,70,40,0.08)] md:p-8 motion-safe:animate-[clockin_0.6s_ease-out_both]">
          {schedule ? (
            <AnalogDial events={schedule.events} startMs={schedule.startMs} lowPower={lowPower} />
          ) : (
            <div className="flex aspect-square w-full max-w-[460px] items-center justify-center text-sm text-[#8A8172]">
              {loading ? 'Loading prayer times…' : 'Prayer times unavailable'}
            </div>
          )}
          <p className="mt-4 text-center text-xs text-[#8A8172]">
            <span className="font-arabic text-sm">اليوم يبدأ عند المغرب</span>
          </p>
        </section>

        {/* digital panel card */}
        <section className="rounded-3xl bg-white p-6 shadow-[0_10px_40px_rgba(90,70,40,0.08)] md:p-8 motion-safe:animate-[clockin_0.6s_ease-out_0.12s_both]">
          {schedule ? (
            <DigitalPanel
              nowMs={nowMs}
              elapsedMs={elapsedMs}
              events={schedule.events}
              hijri={hijri}
              offline={offline}
              estimated={estimated}
              lastRefreshMs={lastRefreshMs}
              onRetry={refresh}
            />
          ) : (
            <p className="py-20 text-center text-sm text-[#8A8172]">
              {loading ? 'Loading prayer times…' : 'Prayer times unavailable'}
            </p>
          )}
        </section>
      </main>

      {/* footer */}
      <footer className="mx-auto w-full max-w-6xl px-6 pb-8 md:px-10">
        <p className="border-t border-[#E8E0D2] pt-4 text-center text-xs text-[#8A8172]">
          Timings: Aladhan API · Umm al-Qura (method 4) ·{' '}
          <span className="font-arabic text-sm">المدينة المنورة</span> · Madinah al-Munawwarah
        </p>
      </footer>
    </div>
  );
}
