package dev.officeattendance

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate
import java.time.ZoneId

@RunWith(RobolectricTestRunner::class)
class AttendanceStoreTest {
    private val utc = ZoneId.of("UTC")
    private val day = LocalDate.of(2026, 10, 23)
    private val morning = 1792746300000 // 09:05 UTC
    private val evening = 1792777200000 // 17:40 UTC
    private lateinit var store: AttendanceStore

    @Before
    fun open() {
        store = AttendanceStore(app)
    }

    @After
    fun close() {
        store.close()
    }

    @Test
    fun firstSightingOfTheDayIsTheCheckIn() {
        assertTrue(store.recordSeen(morning, utc))
        assertFalse(store.recordSeen(evening, utc))
        assertEquals(DayRecord(day, morning, evening, Source.WIFI), store.get(day))
    }

    @Test
    fun officeWifiTurnsADayMarkedByHandIntoAWifiDay() {
        store.setManual(day, true)
        assertEquals(DayRecord(day, null, null, Source.MANUAL), store.get(day))
        store.recordSeen(morning, utc)
        assertEquals(DayRecord(day, morning, morning, Source.WIFI), store.get(day))
    }

    @Test
    fun unmarkingRemovesTheDay() {
        store.recordSeen(morning, utc)
        store.setManual(day, false)
        assertNull(store.get(day))
    }

    @Test
    fun betweenIncludesBothEnds() {
        for (date in listOf("2026-09-30", "2026-10-01", "2026-10-31", "2026-11-01")) {
            store.setManual(LocalDate.parse(date), true)
        }
        assertEquals(
            listOf(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31)),
            store.between(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 31)).map { it.day }
        )
        assertEquals(4, store.all().size)
    }
}
