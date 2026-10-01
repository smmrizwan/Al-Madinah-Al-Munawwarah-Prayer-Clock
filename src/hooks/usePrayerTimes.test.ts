import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchMonthOnce } from './usePrayerTimes';

describe('fetchMonthOnce', () => {
  const dummySignal = new AbortController().signal;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when the HTTP response is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      })
    );

    await expect(fetchMonthOnce(2026, 9, dummySignal)).rejects.toThrow('Aladhan HTTP 500');
  });

  it('throws when the JSON response code is not 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          code: 400,
          data: [],
        }),
      })
    );

    await expect(fetchMonthOnce(2026, 9, dummySignal)).rejects.toThrow('Aladhan: malformed calendar response');
  });

  it('throws when json.data is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          code: 200,
          data: {}, // Not an array
        }),
      })
    );

    await expect(fetchMonthOnce(2026, 9, dummySignal)).rejects.toThrow('Aladhan: malformed calendar response');
  });

  it('throws when there are no usable days in the calendar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          code: 200,
          data: [
            // Empty data array or data that fails parseCalendarDay
            { invalid: 'day' }
          ],
        }),
      })
    );

    await expect(fetchMonthOnce(2026, 9, dummySignal)).rejects.toThrow('Aladhan: no usable days in calendar');
  });
});
