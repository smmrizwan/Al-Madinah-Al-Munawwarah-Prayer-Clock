import {
  currentPeriod,
  formatElapsed,
  formatHijriArabic,
  formatHijriLatin,
  formatWallTime,
  nextPrayer,
  toArabicDigits,
  type HijriDate,
  type PrayerEvent,
} from '@/lib/timeEngine';

export interface DigitalPanelProps {
  nowMs: number;
  elapsedMs: number;
  events: PrayerEvent[];
  hijri: HijriDate | null;
  offline: boolean;
  /** True when any shown day is a solar estimate rather than API/cache data. */
  estimated: boolean;
  /** Timestamp of the last successful API refresh, or null. */
  lastRefreshMs: number | null;
  /** Manual refresh trigger. */
  onRetry: () => void;
}

export default function DigitalPanel({
  nowMs,
  elapsedMs,
  events,
  hijri,
  offline,
  estimated,
  lastRefreshMs,
  onRetry,
}: DigitalPanelProps) {
  const current = currentPeriod(events, nowMs);
  const upcoming = nextPrayer(events, nowMs);
  const countdown = upcoming ? upcoming.timeMs - nowMs : 0;
  const isNextKey = (key: string) => upcoming?.meta.key === key;

  // The six prayers of the current Islamic day (exclude the closing Maghrib duplicate).
  const dayPrayers = events.slice(0, -1);
  const closingMaghrib = events[events.length - 1];
  // Between Asr and Maghrib, "next prayer" is the CLOSING Maghrib (tonight's
  // sunset), while the list's Maghrib row is the OPENING one (yesterday's). In
  // that window the row must show tonight's time and take the green highlight.
  const upcomingIsMaghrib = upcoming?.meta.key === 'Maghrib';

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Islamic clock time */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8A8172]">
          <span className="font-arabic normal-case tracking-normal text-[13px]">الوقت منذ المغرب</span>
          {' · '}Time since Maghrib
        </p>
        <p
          dir="ltr"
          className="mt-2 font-arabic text-6xl font-semibold tracking-[0.02em] text-[#3A352C] tabular-nums md:text-7xl"
        >
          {toArabicDigits(formatElapsed(elapsedMs))}
        </p>
        <p className="mt-1 text-xs text-[#8A8172]">
          <span className="font-arabic text-[13px]">التوقيت المدني</span>
          {' · '}
          <span dir="ltr" className="font-arabic text-[13px] tabular-nums">
            {toArabicDigits(formatWallTime(nowMs))}
          </span>
        </p>
      </div>

      <div className="h-px bg-[#E8E0D2]" />

      {/* current period + countdown */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8A8172]">Current period</p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#1F5C4D]/10 px-4 py-2">
            <span className="font-arabic text-xl leading-none text-[#1F5C4D]">{current.meta.ar}</span>
            <span className="text-sm font-medium text-[#1F5C4D]">· {current.meta.en}</span>
          </div>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8A8172]">
            {upcoming ? (
              <>
                <span className="font-arabic normal-case tracking-normal text-[13px]">
                  المتبقي حتى {upcoming.meta.ar}
                </span>
                {` · until ${upcoming.meta.en}`}
              </>
            ) : (
              'Next prayer'
            )}
          </p>
          <p dir="ltr" className="mt-2 font-arabic text-4xl font-semibold tabular-nums text-[#B99A45]">
            {toArabicDigits(formatElapsed(Math.max(0, countdown)))}
          </p>
        </div>
      </div>

      <div className="h-px bg-[#E8E0D2]" />

      {/* dates */}
      <div className="grid grid-cols-1 gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#8A8172]">Hijri</p>
          {hijri ? (
            <>
              <p className="mt-1 font-arabic text-2xl leading-snug text-[#3A352C]">{formatHijriArabic(hijri)}</p>
              <p className="text-xs text-[#8A8172]">{formatHijriLatin(hijri)}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-[#8A8172]">—</p>
          )}
        </div>
      </div>

      <div className="h-px bg-[#E8E0D2]" />

      {/* prayer list — vertical, Islamic day order: المغرب، العشاء، الفجر، الشروق، الظهر، العصر */}
      <div>
        <div className="flex flex-col gap-2">
          {dayPrayers.map((e) => {
            const showClosing = e.meta.key === 'Maghrib' && upcomingIsMaghrib;
            const active = showClosing || (isNextKey(e.meta.key) && e.timeMs > nowMs);
            const isCurrent = current.meta.key === e.meta.key && e.timeMs <= nowMs;
            const displayMs = showClosing ? closingMaghrib.timeMs : e.timeMs;
            return (
              <div
                key={`${e.meta.key}-${e.timeMs}`}
                className={
                  // Unified semantics: current period = mosque green, next prayer = warm gold
                  active
                    ? 'flex items-center justify-between rounded-xl border border-[#B99A45]/30 bg-[#B99A45]/10 px-4 py-2.5'
                    : isCurrent
                      ? 'flex items-center justify-between rounded-xl border border-[#1F5C4D]/30 bg-[#1F5C4D]/10 px-4 py-2.5'
                      : 'flex items-center justify-between rounded-xl border border-[#E8E0D2] bg-[#FAF7F2] px-4 py-2.5'
                }
              >
                <p className="font-arabic text-lg leading-tight text-[#3A352C]">
                  {e.meta.ar}
                  {isCurrent && !active && (
                    <span className="ms-2 rounded-full bg-[#1F5C4D]/15 px-2 py-0.5 align-middle text-[11px] text-[#1F5C4D]">
                      الآن
                    </span>
                  )}
                  {active && (
                    <span className="ms-2 rounded-full bg-[#B99A45]/15 px-2 py-0.5 align-middle text-[11px] text-[#B99A45]">
                      القادم
                    </span>
                  )}
                </p>
                <p
                  dir="ltr"
                  className="font-arabic text-base font-semibold tabular-nums text-[#3A352C]"
                >
                  {toArabicDigits(formatWallTime(displayMs))}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {offline && (
        <p className="rounded-lg bg-[#B99A45]/10 px-3 py-2 text-center text-xs text-[#8A8172]">
          {estimated ? (
            <>
              <span className="font-arabic">تقدير تقريبي بالحساب الفلكي</span>
              {' · '}solar estimate — no live or saved data
            </>
          ) : (
            <>
              <span className="font-arabic">مواقيت محفوظة</span>
              {' · '}saved timings — live update unavailable
            </>
          )}
        </p>
      )}

      {/* data source + last refresh + manual retry */}
      <p className="flex items-center justify-center gap-2 text-center text-[11px] text-[#8A8172]">
        <span className="font-arabic">المصدر: Aladhan (أم القرى)</span>
        {lastRefreshMs && (
          <>
            {' · '}
            <span className="font-arabic">آخر تحديث</span>{' '}
            <span dir="ltr" className="font-arabic tabular-nums">
              {toArabicDigits(formatWallTime(lastRefreshMs))}
            </span>
          </>
        )}
        {' · '}
        <button
          type="button"
          onClick={onRetry}
          className="font-arabic text-[#1F5C4D] underline underline-offset-2"
        >
          تحديث
        </button>
      </p>
    </div>
  );
}
