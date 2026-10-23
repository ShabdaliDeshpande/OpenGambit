package dev.officeattendance

import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {
    private var controller: ActivityController<MainActivity>? = null

    @Before
    fun setUp() {
        // a normal permission, granted to every install
        shadowOf(app).grantPermissions(android.Manifest.permission.ACCESS_WIFI_STATE)
    }

    @After
    fun tearDown() {
        controller?.pause()?.stop()?.destroy()
    }

    private fun launch(): MainActivity {
        val started = Robolectric.buildActivity(MainActivity::class.java).setup()
        controller = started
        return started.get()
    }

    private fun MainActivity.text(id: Int) = findViewById<TextView>(id).text.toString()

    @Test
    fun firstLaunchAsksForSetup() {
        val activity = launch()
        assertEquals(activity.getString(R.string.today_absent), activity.text(R.id.today_status))
        assertEquals(activity.getString(R.string.today_detail_unconfigured), activity.text(R.id.today_detail))
        assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.setup_card).visibility)
        assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.setup_intro).visibility)
        assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.office_empty).visibility)
    }

    @Test
    fun locationExplanationHidesOnceOnlyOptionalStepsAreLeft() {
        grantWifiAccess()
        val activity = launch()
        // battery optimization is still on, so the card stays, without the location explanation
        assertEquals(View.VISIBLE, activity.findViewById<View>(R.id.setup_card).visibility)
        assertEquals(View.GONE, activity.findViewById<View>(R.id.setup_intro).visibility)
    }

    @Test
    fun openingTheAppOnOfficeWifiMarksTodayPresent() {
        grantWifiAccess()
        OfficeWifi.addOfficeSsid(app, "Acme-Corp")
        connectTo("Acme-Corp")
        val activity = launch()
        assertEquals(activity.getString(R.string.today_present), activity.text(R.id.today_status))
        assertEquals(activity.getString(R.string.wifi_office, "Acme-Corp"), activity.text(R.id.wifi_status))
        assertEquals(activity.resources.getQuantityString(R.plurals.month_summary, 1, 1), activity.text(R.id.month_summary))
    }

    @Test
    fun currentWifiCanBeAddedAsTheOffice() {
        grantWifiAccess()
        connectTo("Acme-Corp")
        val activity = launch()
        activity.findViewById<Button>(R.id.add_current).performClick()
        assertEquals(setOf("Acme-Corp"), OfficeWifi.officeSsids(app))
        assertEquals(1, activity.findViewById<LinearLayout>(R.id.office_list).childCount)
        assertEquals(activity.getString(R.string.today_present), activity.text(R.id.today_status))
        val store = AttendanceStore(app)
        assertNotNull(store.get(LocalDate.now()))
        store.close()
    }

    @Test
    fun calendarShowsEveryDayOfTheMonth() {
        val activity = launch()
        val grid = activity.findViewById<LinearLayout>(R.id.month_grid)
        val days = (1 until grid.childCount).sumOf { week ->
            val row = grid.getChildAt(week) as LinearLayout
            (0 until row.childCount).count { row.getChildAt(it).contentDescription != null }
        }
        assertEquals(LocalDate.now().lengthOfMonth(), days)
    }
}
