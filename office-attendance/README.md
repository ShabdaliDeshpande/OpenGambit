# Office Attendance

An Android app that marks you present for the day when your phone connects to the office Wi-Fi. Everything stays on the phone.

## How it works

- You save the office Wi-Fi name once, by tapping **Use current Wi-Fi** while you're connected at the office (or typing the name). You can save more than one network.
- When the phone joins any Wi-Fi network, Android wakes the app. If the network is one of your office networks, today is marked present and you get a "Marked present" notification with the check-in time.
- About every 15 minutes a background check runs as a backup. It also updates the "last seen" time, so you can see roughly when you left.
- The calendar shows the days you were in the office. Green days were detected on Wi-Fi. Light green days were marked by hand. Tap any past day to mark or unmark it.
- **Export attendance (CSV)** saves every day as `date, weekday, check_in, last_seen, source`.

## Setup on the phone

Android only gives apps the Wi-Fi name if they have location access, so the app asks for:

1. **Location: Precise.** The app needs this to read the Wi-Fi name.
2. **Location: Allow all the time.** Without this, the app can only check the Wi-Fi while it's open.
3. **Location turned on** in quick settings.
4. **Notifications** (optional).
5. **Battery: Unrestricted** (recommended). Some phones, like Xiaomi, Oppo, Vivo, OnePlus and Samsung, put background apps to sleep unless you allow this.

The app shows each missing step on the home screen with a button that fixes it. The app only reads the Wi-Fi name. It never records your location.

## Install

### Download the APK
Every push that changes `office-attendance/` runs the **Office Attendance app** GitHub Actions workflow. It runs the tests and uploads `office-attendance-apk`. Download that artifact, unzip it, copy `app-debug.apk` to the phone, open it, and allow "Install unknown apps" when Android asks.

### Build it yourself
Open the `office-attendance` folder in Android Studio and press Run. From a terminal:

```sh
cd office-attendance
./gradlew testDebugUnitTest assembleDebug   # APK: app/build/outputs/apk/debug/app-debug.apk
```

The app needs Android 8.0 (API 26) or newer. It has no dependencies beyond the Android SDK.

## Code

| File | What it does |
| --- | --- |
| `OfficeWifi.kt` | Stores the office network names, reads the current Wi-Fi name, and marks today present |
| `Watchers.kt` | The Wi-Fi connect callback, the 15-minute background job, and the receiver that sets both up again after a reboot |
| `AttendanceStore.kt` | SQLite table with one row per day: check-in, last seen, and source (Wi-Fi or by hand) |
| `AttendanceLogic.kt` | Plain Kotlin rules (Wi-Fi name cleanup, matching, CSV, calendar layout), unit tested on the JVM |
| `MainActivity.kt`, `MonthGrid.kt` | The screen: today's status, setup steps, office networks, and the month calendar |
| `Notifications.kt` | The "Marked present" notification |

Tests live in `app/src/test`. They use Robolectric to cover the store, the Wi-Fi check, the background receivers, and the main screen.
