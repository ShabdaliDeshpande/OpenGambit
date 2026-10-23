package dev.officeattendance

import android.content.Context
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings

sealed interface CheckResult {
    object NotConfigured : CheckResult
    /** Not on Wi-Fi, or Android is hiding the network name (no location permission or location is off). */
    object NoWifi : CheckResult
    data class OtherNetwork(val ssid: String) : CheckResult
    data class AtOffice(val ssid: String, val firstToday: Boolean) : CheckResult
}

/** Knows which networks are the office and whether the phone is on one right now. */
object OfficeWifi {
    private const val PREFS = "office_wifi"
    private const val KEY_SSIDS = "ssids"

    fun officeSsids(context: Context): Set<String> =
        prefs(context).getStringSet(KEY_SSIDS, null)?.toSet() ?: emptySet()

    fun addOfficeSsid(context: Context, ssid: String) {
        if (AttendanceLogic.isOffice(ssid, officeSsids(context))) return
        prefs(context).edit().putStringSet(KEY_SSIDS, officeSsids(context) + ssid).apply()
    }

    fun removeOfficeSsid(context: Context, ssid: String) {
        prefs(context).edit().putStringSet(KEY_SSIDS, officeSsids(context) - ssid).apply()
    }

    /** Name of the Wi-Fi network the phone is on, or null when there is none or Android hides it. */
    fun currentSsid(context: Context): String? {
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java) ?: return null
        // still the only way to read the name from a broadcast receiver or job; needs location access
        @Suppress("DEPRECATION")
        return AttendanceLogic.normalizeSsid(wifi.connectionInfo?.ssid)
    }

    /** Android only reveals Wi-Fi names while location services are on. */
    fun locationEnabled(context: Context): Boolean {
        val location = context.getSystemService(LocationManager::class.java) ?: return false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return location.isLocationEnabled
        @Suppress("DEPRECATION")
        return Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, 0) !=
            Settings.Secure.LOCATION_MODE_OFF
    }

    /** Marks today present if the phone is on office Wi-Fi. */
    fun check(context: Context, notify: Boolean = true, now: Long = System.currentTimeMillis()): CheckResult {
        val offices = officeSsids(context)
        if (offices.isEmpty()) return CheckResult.NotConfigured
        val ssid = currentSsid(context) ?: return CheckResult.NoWifi
        if (!AttendanceLogic.isOffice(ssid, offices)) return CheckResult.OtherNetwork(ssid)
        val store = AttendanceStore(context)
        val firstToday = try {
            store.recordSeen(now)
        } finally {
            store.close()
        }
        if (firstToday && notify) Notifications.checkedIn(context, ssid, now)
        return CheckResult.AtOffice(ssid, firstToday)
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
