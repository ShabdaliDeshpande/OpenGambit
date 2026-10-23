package dev.officeattendance

import android.Manifest
import android.app.Application
import android.net.wifi.WifiManager
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowWifiInfo

val app: Application get() = RuntimeEnvironment.getApplication()

/** What a phone that has finished the app's setup can see. */
fun grantWifiAccess() {
    shadowOf(app).grantPermissions(
        Manifest.permission.ACCESS_WIFI_STATE,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.ACCESS_BACKGROUND_LOCATION,
    )
}

fun connectTo(ssid: String) {
    val info = ShadowWifiInfo.newInstance()
    shadowOf(info).setSSID(ssid)
    shadowOf(app.getSystemService(WifiManager::class.java)).setConnectionInfo(info)
}
