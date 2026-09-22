/**
 * Pure, testable time engine for the Madinah Islamic prayer clock.
 *
 * The Islamic day begins at Maghrib. The clock shows elapsed time since the most
 * recent Maghrib in Madinah (Asia/Riyadh, fixed UTC+3, no DST), so all prayer
 * instants are computed as absolute UTC timestamps from Madinah wall time and the
 * clock is correct in any device timezone.
 */

export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export type PrayerKey = 'Fajr' | 'Sunrise' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';

export interface PrayerMeta {
  key: PrayerKey;
  ar: string;
  en: string;
}

export const PRAYER_META: Record<PrayerKey, PrayerMeta> = {
  Maghrib: { key: 'Maghrib', ar: 'المغرب', en: 'Maghrib' },
  Isha: { key: 'Isha', ar: 'العشاء', en: 'ʿIshāʾ' },
  Fajr: { key: 'Fajr', ar: 'الفجر', en: 'Fajr' },
  Sunrise: { key: 'Sunrise', ar: 'الشروق', en: 'Shurūq' },
  Dhuhr: { key: 'Dhuhr', ar: 'الظهر', en: 'Ẓuhr' },
  Asr: { key: 'Asr', ar: 'العصر', en: 'ʿAṣr' },
};

/** Chronological order of prayers inside one Islamic day (starts at Maghrib). */
export const ISLAMIC_DAY_ORDER: PrayerKey[] = ['Maghrib', 'Isha', 'Fajr', 'Sunrise', 'Dhuhr', 'Asr'];

/** Six wall-clock timings ("HH:MM", Madinah local) for one Gregorian date. */
export type DayTimings = Record<PrayerKey, string>;

export interface HijriDate {
  day: string;
  monthAr: string;
  monthEn: string;
  year: string;
}

export interface DayData {
  /** Gregorian date key in Riyadh, "YYYY-MM-DD". */
  gregKey: string;
  timings: DayTimings;
  hijri: HijriDate | null;
}

export interface PrayerEvent {
  meta: PrayerMeta;
  /** Absolute UTC timestamp (ms). */
  timeMs: number;
  /** Hours since the start of the current Islamic day (dial position). */
  hoursSinceStart: number;
}

/* ------------------------------------------------------------------ */
/* Riyadh wall-time helpers                                            */
/* ------------------------------------------------------------------ */

export interface WallDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Current Gregorian date on the wall in Madinah for a given UTC instant. */
export function riyadhWallDate(nowMs: number): WallDate {
  const d = new Date(nowMs + RIYADH_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function wallDateKey(w: WallDate): string {
  const mm = String(w.month).padStart(2, '0');
  const dd = String(w.day).padStart(2, '0');
  return `${w.year}-${mm}-${dd}`;
}

/** "DD-MM-YYYY" as expected by the Aladhan timingsByCity endpoint. */
export function apiDateParam(w: WallDate): string {
  const mm = String(w.month).padStart(2, '0');
  const dd = String(w.day).padStart(2, '0');
  return `${dd}-${mm}-${w.year}`;
}

export function addDays(w: WallDate, delta: number): WallDate {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Convert a Madinah wall time ("HH:MM" on a given Riyadh Gregorian date) to an
 * absolute UTC timestamp. Riyadh is fixed UTC+3.
 */
export function wallToUtcMs(w: WallDate, hhmm: string): number {
  const [hh, mm] = parseTiming(hhmm);
  return Date.UTC(w.year, w.month - 1, w.day, hh, mm) - RIYADH_OFFSET_MS;
}

/** Parse "HH:MM" or Aladhan-style "HH:MM (+03)" into [hours, minutes]. Throws on out-of-range values. */
export function parseTiming(raw: string): [number, number] {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) throw new Error(`Bad timing string: ${raw}`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) throw new Error(`Timing out of range: ${raw}`);
  return [hh, mm];
}

/* ------------------------------------------------------------------ */
/* Core Islamic-clock logic                                            */
/* ------------------------------------------------------------------ */

/**
 * Elapsed milliseconds since the most recent Maghrib.
 * If `nowMs` is before today's Maghrib, the Islamic day started at yesterday's
 * Maghrib; otherwise it started at today's Maghrib.
 */
export function getIslamicClockTime(
  nowMs: number,
  yesterdayMaghribMs: number,
  todayMaghribMs: number,
): number {
  const start = nowMs >= todayMaghribMs ? todayMaghribMs : yesterdayMaghribMs;
  return Math.max(0, nowMs - start);
}

/**
 * Build the ordered prayer events of the Islamic day that contains `nowMs`.
 *
 * The day runs Maghrib(D) → Isha(D) → Fajr(D+1) → Sunrise(D+1) → Dhuhr(D+1) →
 * Asr(D+1) → Maghrib(D+1), where D is the Gregorian date of the day's starting
 * Maghrib (yesterday if now is before today's Maghrib, else today).
 *
 * Requires timing data for yesterday, today and tomorrow (keyed by Riyadh
 * Gregorian date). Returns null if required days are missing.
 */
export function buildIslamicDaySchedule(
  nowMs: number,
  days: Map<string, { wall: WallDate; data: DayData }>,
): { startMs: number; endMs: number; events: PrayerEvent[] } | null {
  const today = riyadhWallDate(nowMs);
  const yesterday = addDays(today, -1);

  // Only require the entries actually used: today's (for the Maghrib
  // comparison), the start day's, and the closing day's. Requiring the day
  // BEFORE yesterday broke the clock for callers passing an instant that falls
  // in yesterday's evening (the whole midnight→Maghrib window).
  const todayData = days.get(wallDateKey(today));
  if (!todayData) return null;

  const todayMaghribMs = wallToUtcMs(today, todayData.data.timings.Maghrib);
  const startedToday = nowMs >= todayMaghribMs;
  const startWall = startedToday ? today : yesterday;
  const startEntry = days.get(wallDateKey(startWall));
  const nextWall = addDays(startWall, 1);
  const nextEntry = days.get(wallDateKey(nextWall));
  if (!startEntry || !nextEntry) return null;

  const startMs = wallToUtcMs(startWall, startEntry.data.timings.Maghrib);
  const endMs = wallToUtcMs(nextWall, nextEntry.data.timings.Maghrib);

  const events: PrayerEvent[] = ISLAMIC_DAY_ORDER.map((key) => {
    // Maghrib & Isha belong to the starting evening (startWall); the rest fall
    // on the following Gregorian date.
    const wall = key === 'Maghrib' || key === 'Isha' ? startWall : nextWall;
    const entry = days.get(wallDateKey(wall))!;
    const timeMs = wallToUtcMs(wall, entry.data.timings[key]);
    return {
      meta: PRAYER_META[key],
      timeMs,
      hoursSinceStart: (timeMs - startMs) / 3_600_000,
    };
  });
  // Closing boundary: next Maghrib (position ~24h, also labelled المغرب).
  events.push({
    meta: PRAYER_META.Maghrib,
    timeMs: endMs,
    hoursSinceStart: (endMs - startMs) / 3_600_000,
  });

  return { startMs, endMs, events };
}

/** The prayer period currently in effect (most recent event at or before now). */
export function currentPeriod(events: PrayerEvent[], nowMs: number): PrayerEvent {
  let current = events[0];
  for (const e of events) {
    if (e.timeMs <= nowMs) current = e;
    else break;
  }
  return current;
}

/** The next upcoming prayer event strictly after now. */
export function nextPrayer(events: PrayerEvent[], nowMs: number): PrayerEvent | null {
  for (const e of events) {
    if (e.timeMs > nowMs) return e;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

/** Elapsed ms → HH:MM:SS (HH may exceed 23 near the end of a long Islamic day). */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/** "HH:MM" 24h wall time from an absolute timestamp, shown in Madinah time. */
export function formatWallTime(ms: number): string {
  const d = new Date(ms + RIYADH_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Hijri date rendered in Arabic with Eastern Arabic digits, e.g. "٢٨ ربيع الأول ١٤٤٧هـ". */
export function formatHijriArabic(h: HijriDate): string {
  return `${toArabicDigits(h.day)} ${h.monthAr} ${toArabicDigits(h.year)}هـ`;
}

export function formatHijriLatin(h: HijriDate): string {
  return `${h.day} ${h.monthEn} ${h.year} AH`;
}

/* ------------------------------------------------------------------ */
/* Approximate solar fallback (date-aware, no network)                 */
/* ------------------------------------------------------------------ */

const MADINAH_LAT = 24.4672;
const MADINAH_LNG = 39.6111;

function dayOfYear(w: WallDate): number {
  return Math.round((Date.UTC(w.year, w.month - 1, w.day) - Date.UTC(w.year, 0, 1)) / 86_400_000) + 1;
}

/** NOAA-style solar approximation: equation of time (min) + declination (rad). */
function sunParams(doy: number): { eqtime: number; decl: number } {
  const g = ((2 * Math.PI) / 365) * (doy - 1);
  const eqtime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return { eqtime, decl };
}

/**
 * Date-aware estimate of the six Madinah prayer times (Umm al-Qura angles:
 * Fajr 18.5°, Maghrib = sunset, Isha = Maghrib + 90 min, Asr shadow factor 1).
 * Accurate to roughly ±2 minutes — used ONLY when neither the API nor the
 * cache has data for a date.
 */
export function estimateMadinahTimings(w: WallDate): DayTimings {
  const doy = dayOfYear(w);
  const { eqtime, decl } = sunParams(doy);
  const latRad = (MADINAH_LAT * Math.PI) / 180;
  const declDeg = (decl * 180) / Math.PI;

  // Solar noon in local (UTC+3) minutes.
  const noon = 720 - 4 * MADINAH_LNG - eqtime + 180;

  const crossing = (altDeg: number, rising: boolean): number => {
    const a = (altDeg * Math.PI) / 180;
    const cosH = (Math.sin(a) - Math.sin(latRad) * Math.sin(decl)) / (Math.cos(latRad) * Math.cos(decl));
    const H = (Math.acos(Math.min(1, Math.max(-1, cosH))) * 180) / Math.PI;
    return noon + (rising ? -4 * H : 4 * H);
  };

  // Asr: shadow = object length + noon shadow (standard/Shafi'i, factor 1).
  const asrAlt = (Math.atan(1 / (1 + Math.tan(((MADINAH_LAT - declDeg) * Math.PI) / 180))) * 180) / Math.PI;

  const fmt = (mins: number): string => {
    const rounded = ((Math.round(mins) % 1440) + 1440) % 1440;
    const h = Math.floor(rounded / 60);
    const m = rounded % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  const maghribMin = crossing(-0.833, false);
  return {
    Fajr: fmt(crossing(-18.5, true)),
    Sunrise: fmt(crossing(-0.833, true)),
    Dhuhr: fmt(noon + 2),
    Asr: fmt(crossing(asrAlt, false)),
    Maghrib: fmt(maghribMin),
    Isha: fmt(maghribMin + 90),
  };
}
