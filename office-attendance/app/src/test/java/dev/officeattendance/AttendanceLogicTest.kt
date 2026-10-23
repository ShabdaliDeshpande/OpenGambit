package dev.officeattendance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId

class AttendanceLogicTest {
    @Test
    fun stripsTheQuotesAndroidPutsAroundSsids() {
        assertEquals("Acme Office", AttendanceLogic.normalizeSsid("\"Acme Office\""))
        assertEquals("Acme Office", AttendanceLogic.normalizeSsid("Acme Office"))
    }

    @Test
    fun hiddenOrMissingSsidIsNull() {
        assertNull(AttendanceLogic.normalizeSsid(null))
        assertNull(AttendanceLogic.normalizeSsid("<unknown ssid>"))
        assertNull(AttendanceLogic.normalizeSsid("\"\""))
        assertNull(AttendanceLogic.normalizeSsid("0x"))
    }

    @Test
    fun matchesOfficeNetworksIgnoringCase() {
        val offices = setOf("Acme-Corp", "Acme-Guest")
        assertTrue(AttendanceLogic.isOffice("acme-corp", offices))
        assertFalse(AttendanceLogic.isOffice("HomeWifi", offices))
        assertFalse(AttendanceLogic.isOffice(null, offices))
    }

    @Test
    fun leadingBlanksFollowTheFirstDayOfTheWeek() {
        // 1 October 2026 is a Thursday
        assertEquals(3, AttendanceLogic.leadingBlanks(YearMonth.of(2026, 10), DayOfWeek.MONDAY))
        assertEquals(4, AttendanceLogic.leadingBlanks(YearMonth.of(2026, 10), DayOfWeek.SUNDAY))
        // 1 June 2026 is a Monday
        assertEquals(0, AttendanceLogic.leadingBlanks(YearMonth.of(2026, 6), DayOfWeek.MONDAY))
    }

    @Test
    fun csvIsSortedByDayWithLocalTimes() {
        val records = listOf(
            // 2026-10-23 09:05 and 17:40 UTC
            DayRecord(LocalDate.of(2026, 10, 23), 1792746300000, 1792777200000, Source.WIFI),
            DayRecord(LocalDate.of(2026, 10, 22), null, null, Source.MANUAL),
        )
        assertEquals(
            "date,weekday,check_in,last_seen,source\n" +
                "2026-10-22,Thu,,,manual\n" +
                "2026-10-23,Fri,09:05,17:40,wifi\n",
            AttendanceLogic.toCsv(records, ZoneId.of("UTC"))
        )
    }
}
