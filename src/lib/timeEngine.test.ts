import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildIslamicDaySchedule,
  estimateMadinahTimings,
  parseTiming,
  riyadhWallDate,
  wallDateKey,
  wallToUtcMs,
  type DayData,
  type WallDate,
} from './timeEngine';

/** Realistic Madinah timings (approximate late-September values). */
const TIMINGS = {
  Fajr: '04:55',
  Sunrise: '06:12',
  Dhuhr: '12:17',
  Asr: '15:37',
  Maghrib: '18:18',
  Isha: '19:48',
};

function day(y: number, m: number, d: number): WallDate {
  return { year: y, month: m, day: d };
}

function entry(wall: WallDate) {
  const data: DayData = { gregKey: wallDateKey(wall), timings: TIMINGS, hijri: null };
  return { wall, data };
}

/** 3-day window around a date, exactly what usePrayerTimes provides. */
function daysAround(center: WallDate): Map<string, { wall: WallDate; data: DayData }> {
  const map = new Map();
  for (const delta of [-1, 0, 1]) {
    const w = addDays(center, delta);
    map.set(wallDateKey(w), entry(w));
  }
  return map;
}

/** UTC ms for a Madinah wall time. */
function at(wall: WallDate, hhmm: string): number {
  return wallToUtcMs(wall, hhmm);
}

describe('parseTiming validation', () => {
  it('accepts normal and Aladhan-suffixed times', () => {
    expect(parseTiming('05:10')).toEqual([5, 10]);
    expect(parseTiming('17:55 (+03)')).toEqual([17, 55]);
  });
  it('rejects out-of-range and malformed times', () => {
    expect(() => parseTiming('99:99')).toThrow();
    expect(() => parseTiming('24:00')).toThrow();
    expect(() => parseTiming('12:60')).toThrow();
    expect(() => parseTiming('abc')).toThrow();
  });
});

describe('buildIslamicDaySchedule — Maghrib boundary', () => {
  const today = day(2026, 9, 23);
  const days = daysAround(today);

  it('before Maghrib: Islamic day started at YESTERDAY’s Maghrib (regression: must not return null)', () => {
    for (const hhmm of ['00:00', '06:00', '12:00', '17:00']) {
      const schedule = buildIslamicDaySchedule(at(today, hhmm), days);
      expect(schedule, `at ${hhmm}`).not.toBeNull();
      expect(schedule!.startMs).toBe(at(addDays(today, -1), TIMINGS.Maghrib));
      expect(schedule!.endMs).toBe(at(today, TIMINGS.Maghrib));
    }
  });

  it('at/after Maghrib: new Islamic day starts NOW', () => {
    for (const hhmm of ['18:18', '18:19', '23:59']) {
      const schedule = buildIslamicDaySchedule(at(today, hhmm), days);
      expect(schedule, `at ${hhmm}`).not.toBeNull();
      expect(schedule!.startMs).toBe(at(today, TIMINGS.Maghrib));
    }
  });

  it('midnight belongs to the Islamic day that started yesterday evening', () => {
    const schedule = buildIslamicDaySchedule(at(addDays(today, 1), '00:30'), daysAround(addDays(today, 1)));
    expect(schedule).not.toBeNull();
    expect(schedule!.startMs).toBe(at(today, TIMINGS.Maghrib));
  });

  it('produces 7 events in Islamic-day order starting and ending with Maghrib', () => {
    const schedule = buildIslamicDaySchedule(at(today, '20:00'), days)!;
    expect(schedule.events).toHaveLength(7);
    expect(schedule.events[0].meta.key).toBe('Maghrib');
    expect(schedule.events[6].meta.key).toBe('Maghrib');
    expect(schedule.events[0].timeMs).toBe(schedule.startMs);
    expect(schedule.events[6].timeMs).toBe(schedule.endMs);
    for (let i = 1; i < schedule.events.length; i++) {
      expect(schedule.events[i].timeMs).toBeGreaterThan(schedule.events[i - 1].timeMs);
    }
  });
});

describe('month boundary', () => {
  it('addDays rolls across month and year ends', () => {
    expect(addDays(day(2026, 9, 30), 2)).toEqual(day(2026, 10, 2));
    expect(addDays(day(2026, 1, 1), -1)).toEqual(day(2025, 12, 31));
  });

  it('schedule works across a month boundary', () => {
    const sep30 = day(2026, 9, 30);
    const schedule = buildIslamicDaySchedule(at(sep30, '20:00'), daysAround(sep30));
    expect(schedule).not.toBeNull();
    // Fajr falls on the next Gregorian date (Oct 1).
    const fajr = schedule!.events.find((e) => e.meta.key === 'Fajr')!;
    expect(riyadhWallDate(fajr.timeMs)).toEqual(day(2026, 10, 1));
  });
});

describe('estimateMadinahTimings (solar fallback)', () => {
  it('returns plausible, seasonally-varying times', () => {
    for (const w of [day(2026, 9, 23), day(2026, 6, 21), day(2025, 12, 21)]) {
      const t = estimateMadinahTimings(w);
      const maghrib = parseTiming(t.Maghrib);
      // Madinah sunset is always between ~17:30 and ~19:20.
      const mins = maghrib[0] * 60 + maghrib[1];
      expect(mins).toBeGreaterThan(17 * 60 + 25);
      expect(mins).toBeLessThan(19 * 60 + 25);
      // Isha = Maghrib + 90 min (Umm al-Qura).
      const isha = parseTiming(t.Isha);
      expect((isha[0] * 60 + isha[1]) - mins).toBe(90);
    }
  });

  it('summer Maghrib is later than winter Maghrib', () => {
    const summer = parseTiming(estimateMadinahTimings(day(2026, 6, 21)).Maghrib);
    const winter = parseTiming(estimateMadinahTimings(day(2025, 12, 21)).Maghrib);
    expect(summer[0] * 60 + summer[1]).toBeGreaterThan(winter[0] * 60 + winter[1]);
  });
});
