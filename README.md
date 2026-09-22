# Al-Madinah al-Munawwarah Clock

An Islamic prayer-time clock for **Madinah al-Munawwarah, Saudi Arabia**.

The app treats the Islamic day as beginning at **Maghrib**. At Maghrib, the
clock resets to **00:00** and counts the elapsed time of the Islamic day from
there. The analog dial is a **24-hour anti-clockwise** dial with prayer arcs,
while the digital panel shows the current Islamic-day time, the next prayer,
and the Hijri date.

The same codebase runs as:

- a web app (React + Vite), and
- an Android app through Capacitor (`android/` folder included).

There are **no ads, no analytics, and no tracking SDKs** in this project.

---

## Features

- Islamic day starts at Maghrib in Madinah.
- Clock resets to `00:00` at Maghrib and runs for a 24-hour Islamic day.
- Anti-clockwise 24-hour analog dial.
- Prayer arcs on the dial for Maghrib, Isha, Fajr, Sunrise, Dhuhr, and Asr.
- Digital Islamic-day clock with Eastern Arabic numerals.
- Next-prayer countdown.
- Hijri date that advances at Maghrib.
- Live prayer times from the Aladhan API using the Umm al-Qura method.
- Offline support through a rolling local cache.
- Astronomical fallback estimate for Madinah when live data and cache are
unavailable.
- Low-power mode for reduced animation/update frequency.
- Wake lock support to keep the clock visible while the device allows it.
- Bundled fonts; no Google Fonts runtime dependency.
- Light, minimal UI in Arabic.

---

## Tech stack

- React 19
- TypeScript
- Vite 7
- Tailwind CSS 3.4
- Capacitor 8 for Android
- Vitest for regression tests

---

## Requirements

For web development:

- Node.js 20.19+ or 22.12+ for the Vite app.

For Android/Capacitor work:

- **Node.js 22+** is required by Capacitor 8.
- Android Studio with a recent Android SDK.

---

## Run the web app locally

```bash
npm install
npm run dev
```

Build the production web app:

```bash
npm run build
```

Run checks:

```bash
npm run lint
npm run test
```

---

## Build the Android app

```bash
npm install
npm run build
npx cap sync android
npx cap open android
```

Then let Android Studio finish the Gradle sync.

To test on your own phone without Google Play:

1. Enable Developer Options on the phone.
2. Enable USB debugging.
3. Connect the phone to your computer.
4. Press Run in Android Studio.

For Play Store publishing, see [`PLAYSTORE_GUIDE.md`](./PLAYSTORE_GUIDE.md).

---

## Important: change the app ID before publishing

`capacitor.config.ts` currently uses the placeholder app ID:

```ts
appId: 'com.madinah.clock'
```

Before publishing to Google Play, change it to your own unique reverse-domain
ID, for example:

```ts
appId: 'com.yourname.madinahclock'
```

Also update the generated Android project to match:

- `android/app/build.gradle` → `applicationId`
- `android/app/src/main/res/values/strings.xml` → `package_name` and
`custom_url_scheme`

Once an app is published on Google Play, its application ID cannot be changed.

---

## How the Islamic clock works

The core logic is in [`src/lib/timeEngine.ts`](./src/lib/timeEngine.ts).

- Prayer times are interpreted as Madinah wall-clock times.
- The Islamic day starts at the most recent Maghrib.
- If the current civil time is before today's Maghrib, the active Islamic day
started at yesterday's Maghrib.
- If the current civil time is at or after today's Maghrib, a new Islamic day
starts and the elapsed clock resets to `00:00`.
- The analog dial maps 24 hours to one full anti-clockwise revolution.

Prayer-time source:

- Live data: Aladhan monthly calendar API for Madinah, Saudi Arabia.
- Calculation method: Umm al-Qura (`method=4`).
- Asr uses the standard Shafi'i shadow factor.

Offline behavior:

- Successfully fetched monthly timings are cached locally in the browser.
- If the network is unavailable, the app uses cached timings when possible.
- If no cached timing exists, the app falls back to an astronomical estimate
for Madinah and marks the times as approximate.

---

## Project structure

```text
src/
  components/
    AnalogDial.tsx       # 24-hour anti-clockwise dial and prayer arcs
    DigitalPanel.tsx     # digital Islamic-day clock, prayer list, status line
  hooks/
    useNow.ts            # clock ticking hooks
    usePrayerTimes.ts    # Aladhan fetch, cache, retry, offline fallback state
  lib/
    timeEngine.ts        # Islamic-day schedule, Hijri formatting, estimates
    timeEngine.test.ts   # regression tests
  pages/
    Home.tsx             # main page, wake lock, low-power mode
android/                 # Capacitor Android project
public/fonts/            # bundled fonts
PLAYSTORE_GUIDE.md       # Google Play publishing guide
```

---

## Privacy

This app does not collect personal data.

It fetches prayer times from the Aladhan API and stores fetched timings locally
on the device for offline use. It contains no ads, analytics, or third-party
tracking.

---

## Notes and disclaimer

- Prayer times are configured specifically for Madinah al-Munawwarah.
- Live times depend on the Aladhan API being reachable.
- Offline fallback times are astronomical estimates and should be treated as
approximate.
- For religious use, compare with trusted local Madinah timetables where
precision matters.
