import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  estimateMadinahTimings,
  riyadhWallDate,
  wallDateKey,
  type DayData,
  type DayTimings,
  type HijriDate,
  type PrayerKey,
  type WallDate,
} from '@/lib/timeEngine';

const PRAYER_KEYS: PrayerKey[] = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

/** Strict "HH:MM" with real hour/minute ranges. */
const TIMING_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const CACHE_KEY = 'madinah-clock.timings.v1';
/** A full month of cached days (plus overlap) — deep offline resilience. */
const CACHE_MAX_ENTRIES = 45;
const FETCH_TIMEOUT_MS = 10_000;
/** Extra attempts after the first failure (so 2 => 3 total tries). */
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 700;

export interface DayEntry {
  wall: WallDate;
  data: DayData;
}

export interface PrayerTimesState {
  days: Map<string, DayEntry>;
  /** True when any shown day is stale (cache) or estimated (solar fallback). */
  offline: boolean;
  /** True when any shown day is a solar ESTIMATE (not API/cache data). */
  estimated: boolean;
  loading: boolean;
  /** Timestamp of the last successful API refresh, or null if never. */
  lastRefreshMs: number | null;
  /** Manual retry — re-runs the refresh immediately. */
  refresh: () => void;
}

interface AladhanDay {
  timings: Record<string, string>;
  date: {
    gregorian: { date: string }; // "DD-MM-YYYY"
    hijri: { day: string; month: { en: string; ar: string }; year: string };
  };
}

interface AladhanCalendarResponse {
  code: number;
  data: AladhanDay[];
}

/**
 * Lenient Hijri parsing: the Hijri date is display-only metadata, so a
 * malformed Hijri payload must NEVER discard valid prayer timings (fix 1.2).
 * Returns null on any irregularity.
 */
function parseHijri(h: AladhanDay['date']['hijri'] | undefined): HijriDate | null {
  const day = String(h?.day ?? '').trim();
  const monthAr = String(h?.month?.ar ?? '').trim();
  const monthEn = String(h?.month?.en ?? '').trim();
  const year = String(h?.year ?? '').trim();
  if (!/^(0?[1-9]|[12]\d|30)$/.test(day)) return null;
  if (!monthAr || !monthEn) return null;
  if (!/^\d{3,4}$/.test(year)) return null;
  return { day, monthAr, monthEn, year };
}

/** Validate one calendar day entry. Returns null (skip that day) if its timings are unusable. */
function parseCalendarDay(entry: AladhanDay): DayData | null {
  const greg = entry?.date?.gregorian?.date;
  const gregMatch = typeof greg === 'string' ? greg.match(/^(\d{2})-(\d{2})-(\d{4})$/) : null;
  if (!gregMatch || !entry.timings || typeof entry.timings !== 'object') return null;
  const gregKey = `${gregMatch[3]}-${gregMatch[2]}-${gregMatch[1]}`; // YYYY-MM-DD
  const timings = {} as DayTimings;
  for (const key of PRAYER_KEYS) {
    const raw = entry.timings[key];
    if (typeof raw !== 'string') return null;
    // Lenient extraction: tolerate single-digit hours, whitespace and
    // Aladhan's "(+03)" suffix; normalize to zero-padded "HH:MM".
    const m = raw.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) return null;
    timings[key] = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return { gregKey, timings, hijri: parseHijri(entry.date?.hijri) };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** One HTTP request = a whole month of Madinah timings (fix 1.3). */
async function fetchMonthOnce(year: number, month: number, outerSignal: AbortSignal): Promise<DayData[]> {
  const url = `https://api.aladhan.com/v1/calendarByCity/${year}/${month}?city=Madinah&country=Saudi%20Arabia&method=4`;
  // The timeout covers the FULL exchange — headers AND body download/parse —
  // so a stalled response body can never hang the refresh.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Aladhan HTTP ${res.status}`);
    const json = (await res.json()) as AladhanCalendarResponse;
    if (json?.code !== 200 || !Array.isArray(json.data)) {
      throw new Error('Aladhan: malformed calendar response');
    }
    const days: DayData[] = [];
    for (const entry of json.data) {
      const parsed = parseCalendarDay(entry);
      if (parsed) days.push(parsed);
    }
    if (days.length === 0) throw new Error('Aladhan: no usable days in calendar');
    return days;
  } finally {
    clearTimeout(timeout);
    outerSignal.removeEventListener('abort', onOuterAbort);
  }
}

/** Bounded retries with linear backoff; honours cancellation. */
async function withRetry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let lastError: unknown = new Error('unreachable');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (signal.aborted) throw err;
      if (attempt < MAX_RETRIES) await delay(RETRY_BASE_DELAY_MS * (attempt + 1), signal);
    }
  }
  throw lastError;
}

/* ------------------------------ localStorage cache ------------------------------ */

function loadCache(): Map<string, DayData> {
  const map = new Map<string, DayData>();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return map;
    const obj = JSON.parse(raw) as Record<string, DayData>;
    for (const [key, value] of Object.entries(obj)) {
      // Re-validate cached timings before use; hijri may legitimately be null.
      if (
        value &&
        typeof value.gregKey === 'string' &&
        value.timings &&
        PRAYER_KEYS.every((k) => typeof value.timings[k] === 'string' && TIMING_RE.test(value.timings[k]))
      ) {
        map.set(key, value);
      }
    }
  } catch {
    /* corrupted cache -> start empty */
  }
  return map;
}

/** Merge into the existing cache (never purge fresh history) and prune oldest-first. */
function saveCache(cache: Map<string, DayData>): void {
  try {
    const entries = [...cache.entries()].sort(([a], [b]) => a.localeCompare(b));
    const pruned = entries.slice(Math.max(0, entries.length - CACHE_MAX_ENTRIES));
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(pruned)));
  } catch {
    /* storage full/blocked -> non-fatal */
  }
}

/* ------------------------------ static estimate ------------------------------ */

/** Hijri date (Umm al-Qura) for a specific Madinah wall date, via Intl. */
function fallbackHijriForWall(wall: WallDate): HijriDate | null {
  try {
    // Noon in Madinah on that date — safely inside the day for both calendars.
    const ms = Date.UTC(wall.year, wall.month - 1, wall.day, 9); // 12:00 Asia/Riyadh
    const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const arParts = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      timeZone: 'Asia/Riyadh',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(new Date(ms));
    const enParts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      timeZone: 'Asia/Riyadh',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(new Date(ms));
    const get = (parts: Intl.DateTimeFormatPart[], t: string) =>
      parts.find((p) => p.type === t)?.value ?? '';
    return {
      day: toLatin(get(arParts, 'day')),
      monthAr: get(arParts, 'month'),
      monthEn: get(enParts, 'month'),
      year: toLatin(get(arParts, 'year')).replace(/[^\d]/g, ''),
    };
  } catch {
    return null;
  }
}

/** Date-aware solar estimate, one entry per date, each with its own Hijri date. */
function buildEstimateDays(walls: WallDate[]): Map<string, DayEntry> {
  const map = new Map<string, DayEntry>();
  for (const wall of walls) {
    map.set(wallDateKey(wall), {
      wall,
      data: {
        gregKey: wallDateKey(wall),
        timings: estimateMadinahTimings(wall),
        hijri: fallbackHijriForWall(wall),
      },
    });
  }
  return map;
}

/* --------------------------------- the hook --------------------------------- */

/** Distinct Gregorian (year, month) pairs spanned by the wanted days. */
function wantedMonths(today: WallDate): Array<{ year: number; month: number }> {
  const seen = new Map<string, { year: number; month: number }>();
  for (const w of [addDays(today, -2), today, addDays(today, 2)]) {
    seen.set(`${w.year}-${w.month}`, { year: w.year, month: w.month });
  }
  return [...seen.values()];
}

/**
 * Synchronous initial state built from the persistent cache (plus per-date
 * estimates for gaps): the clock renders on the FIRST FRAME for returning
 * users — no loading flash — while the network refresh runs in the background
 * (stale-while-revalidate). Everything shown before fresh data arrives is
 * flagged offline.
 */
function getInitialState(): Omit<PrayerTimesState, 'refresh'> {
  try {
    const today = riyadhWallDate(Date.now());
    const wanted = [-1, 0, 1].map((d) => addDays(today, d));
    const cache = loadCache();
    const map = new Map<string, DayEntry>();
    for (const wall of wanted) {
      const key = wallDateKey(wall);
      const cached = cache.get(key);
      if (cached) map.set(key, { wall, data: cached });
    }
    let usedEstimate = false;
    if (wanted.some((w) => !map.has(wallDateKey(w)))) {
      const estimates = buildEstimateDays(wanted);
      for (const wall of wanted) {
        const key = wallDateKey(wall);
        if (!map.has(key)) {
          map.set(key, estimates.get(key)!);
          usedEstimate = true;
        }
      }
    }
    return { days: map, offline: true, estimated: usedEstimate, loading: false, lastRefreshMs: null };
  } catch {
    return { days: new Map(), offline: false, estimated: false, loading: true, lastRefreshMs: null };
  }
}

/**
 * Madinah prayer times (Umm al-Qura, method 4) via Aladhan's monthly calendar
 * endpoint: one HTTP request per month instead of one per day. Fetched days
 * are merged into a persistent per-date localStorage cache (~45 days), giving
 * weeks of accurate offline timings. Per-day validation is independent — one
 * malformed day never discards the others. Refetches on Riyadh date rollover,
 * network reconnect, and app foregrounding. Priority per day: fresh API >
 * validated cache > per-date static estimate (flagged offline).
 */
export function usePrayerTimes(nowMs: number): PrayerTimesState {
  const todayKey = wallDateKey(riyadhWallDate(nowMs));
  const [state, setState] = useState<Omit<PrayerTimesState, 'refresh'>>(getInitialState);
  // Bump token to force a manual retry.
  const [retryNonce, setRetryNonce] = useState(0);
  const refresh = useCallback(() => setRetryNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();

    const refreshDays = async () => {
      const today = riyadhWallDate(Date.now());
      const wanted = [-1, 0, 1].map((d) => addDays(today, d));
      const months = wantedMonths(today);

      const settled = await Promise.allSettled(
        months.map((m) =>
          withRetry(() => fetchMonthOnce(m.year, m.month, controller.signal), controller.signal),
        ),
      );
      if (controller.signal.aborted) return;

      // Merge every successfully fetched day into the persistent cache.
      const cache = loadCache();
      const freshDays = new Map<string, DayData>();
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        for (const day of result.value) {
          freshDays.set(day.gregKey, day);
          cache.set(day.gregKey, day);
        }
      }
      if (freshDays.size > 0) saveCache(cache);

      // Build the 3-day view the clock actually needs.
      const map = new Map<string, DayEntry>();
      let allFresh = true;
      for (const wall of wanted) {
        const key = wallDateKey(wall);
        const fresh = freshDays.get(key);
        if (fresh) {
          map.set(key, { wall, data: fresh });
          continue;
        }
        allFresh = false;
        const cached = cache.get(key);
        if (cached) map.set(key, { wall, data: cached });
      }

      // Fill any remaining gaps with the date-aware solar estimate.
      let usedEstimate = false;
      if (wanted.some((w) => !map.has(wallDateKey(w)))) {
        const estimates = buildEstimateDays(wanted);
        for (const wall of wanted) {
          const key = wallDateKey(wall);
          if (!map.has(key)) {
            map.set(key, estimates.get(key)!);
            usedEstimate = true;
          }
        }
      }

      setState({
        days: map,
        offline: !allFresh,
        estimated: usedEstimate,
        loading: false,
        lastRefreshMs: freshDays.size > 0 ? Date.now() : null,
      });
    };

    void refreshDays();

    const onOnline = () => void refreshDays();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshDays();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      controller.abort();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Refetch when the Riyadh Gregorian date changes, or on manual retry.
  }, [todayKey, retryNonce]);

  return useMemo(() => ({ ...state, refresh }), [state, refresh]);
}
