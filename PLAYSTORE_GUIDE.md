# Publishing to Google Play — Al-Madinah al-Munawwarah clock

This project is wrapped with **Capacitor 8**, so the web clock runs as a real
native Android app (`android/` folder included). **There are no ads and no ad
SDKs anywhere in this project** — nothing to buy, remove, or disable.

---

## 1. What you need on your computer

| Tool | Why | Get it |
|---|---|---|
| Node.js 22+ (Capacitor 8 requires it) | build the web app | https://nodejs.org |
| Android Studio (latest) | build & sign the Android app | https://developer.android.com/studio |
| Google Play Developer account | publish to Play Store | https://play.google.com/console — **$25 one-time fee** |

## 2. Prepare the app (one-time personalization)

**Change the app ID** — `com.madinah.clock` is a placeholder. Google Play
requires a globally unique ID, and it can never be changed after publishing.

1. Edit `capacitor.config.ts` → set `appId` to e.g. `com.yourname.madinahclock`
2. Then update the generated Android project to match:
   - `android/app/build.gradle` → `applicationId "com.yourname.madinahclock"`
   - `android/app/src/main/res/values/strings.xml` → `package_name` and `custom_url_scheme`

**App icon (optional but recommended):**
In Android Studio: right-click `android/app/src/main/res` →
**New → Image Asset → Launcher Icons** → pick your image → Finish.
(A crescent/clock image on a sand background matches the app.)

## 3. Build the app

```bash
npm install
npm run build          # builds the web clock into dist/
npx cap sync android   # copies dist/ into the Android project
npx cap open android   # opens the project in Android Studio
```

Let Android Studio finish its first Gradle sync (can take several minutes).

**To test on your phone first** (free, no Play account needed):
enable Developer Options + USB debugging on the phone, plug it in,
then press the green ▶ Run button in Android Studio.

## 4. Create the signed release bundle (.aab)

In Android Studio:

1. **Build → Generate Signed App Bundle / APK…**
2. Choose **Android App Bundle (.aab)** → Next
3. **Create new…** keystore → choose a file location and passwords
   - ⚠️ **Back up this keystore file and its passwords somewhere safe.**
     Losing it means you can never update your published app again.
4. Choose **release** build variant → Create
5. Output: `android/app/release/app-release.aab`

## 5. Publish on Google Play Console

1. Go to https://play.google.com/console → **Create app**
2. Fill in the basics (name: `Al-Madinah al-Munawwarah clock`, default language, free app)
3. Complete the required setup checklist (Dashboard):
   - **App content**: privacy policy URL, ads declaration (**select "No, the app does not contain ads"**), content rating questionnaire, target audience, news-app declaration (No)
   - **Privacy policy**: the app only fetches prayer times from the Aladhan API and collects no personal data — a short free policy stating that is enough (e.g. generated with any free privacy-policy generator, hosted on a free page like GitHub Pages)
   - **Store listing**: short + full description, app icon (512×512), feature graphic (1024×500), at least 2 screenshots (take them from your phone test run)
4. **Production → Create new release** → upload `app-release.aab` →
   review → **Send for review**
5. Review usually takes a few hours to a few days. Once approved, your app
   is live on Google Play.

## 6. Updating the app later

```bash
npm run build && npx cap sync android
```
Then in `android/app/build.gradle` bump `versionCode` (+1) and `versionName`,
generate a new signed AAB with the **same keystore**, and upload it as a new
release in Play Console.

---

### Notes
- The app needs internet for live prayer times; offline it shows built-in
  estimate times (already handled in the app).
- Minimum Android version: 7.0 (API 24), target SDK 36 — meets current Google Play requirements.
- No third-party tracking, analytics, or ads are included.
