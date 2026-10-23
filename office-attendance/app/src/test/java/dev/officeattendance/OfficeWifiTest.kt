package dev.officeattendance

import android.app.NotificationManager
import android.app.job.JobScheduler
import android.content.Intent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
class OfficeWifiTest {
    @Before
    fun setUp() {
        grantWifiAccess()
    }

    @Test
    fun doesNothingUntilAnOfficeNetworkIsAdded() {
        connectTo("Acme-Corp")
        assertEquals(CheckResult.NotConfigured, OfficeWifi.check(app))
    }

    @Test
    fun ignoresOtherNetworks() {
        OfficeWifi.addOfficeSsid(app, "Acme-Corp")
        connectTo("HomeWifi")
        assertEquals(CheckResult.OtherNetwork("HomeWifi"), OfficeWifi.check(app))
    }

    @Test
    fun marksPresentOnceADayAndNotifies() {
        OfficeWifi.addOfficeSsid(app, "Acme-Corp")
        connectTo("Acme-Corp")
        assertEquals(CheckResult.AtOffice("Acme-Corp", firstToday = true), OfficeWifi.check(app))
        assertEquals(CheckResult.AtOffice("Acme-Corp", firstToday = false), OfficeWifi.check(app))
        val notifications = shadowOf(app.getSystemService(NotificationManager::class.java)).allNotifications
        assertEquals(1, notifications.size)
    }

    @Test
    fun officeNamesAreMatchedIgnoringCaseAndNotDuplicated() {
        OfficeWifi.addOfficeSsid(app, "Acme-Corp")
        OfficeWifi.addOfficeSsid(app, "ACME-CORP")
        assertEquals(setOf("Acme-Corp"), OfficeWifi.officeSsids(app))
        connectTo("acme-corp")
        assertEquals(CheckResult.AtOffice("acme-corp", firstToday = true), OfficeWifi.check(app, notify = false))
    }

    @Test
    fun joiningWifiInTheBackgroundMarksToday() {
        OfficeWifi.addOfficeSsid(app, "Acme-Corp")
        connectTo("Acme-Corp")
        WifiConnectedReceiver().onReceive(app, Intent())
        val store = AttendanceStore(app)
        assertNotNull(store.get(LocalDate.now()))
        store.close()
    }

    @Test
    fun bootSchedulesThePeriodicCheck() {
        BootReceiver().onReceive(app, Intent(Intent.ACTION_BOOT_COMPLETED))
        val jobs = app.getSystemService(JobScheduler::class.java).allPendingJobs
        assertEquals(1, jobs.size)
        assertEquals(true, jobs[0].isPersisted)
    }
}
