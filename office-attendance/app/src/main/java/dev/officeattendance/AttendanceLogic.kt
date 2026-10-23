package dev.officeattendance

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

enum class Source { WIFI, MANUAL }

/** A day the user was at the office. Times are epoch millis; days marked by hand have none. */
data class DayRecord(val day: LocalDate, val checkIn: Long?, val lastSeen: Long?, val source: Source)

/** Rules that don't need Android, kept here so they can be unit tested on the JVM. */
object AttendanceLogic {
    private const val UNKNOWN_SSID = "<unknown ssid>"
    private val CSV_TIME: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    /** WifiInfo.getSSID() wraps names in quotes and returns a placeholder when Android hides the name. */
    fun normalizeSsid(raw: String?): String? {
        var ssid = raw?.trim() ?: return null
        if (ssid.length >= 2 && ssid.startsWith('"') && ssid.endsWith('"')) ssid = ssid.substring(1, ssid.length - 1)
        return ssid.takeUnless { it.isBlank() || it == UNKNOWN_SSID || it == "0x" }
    }

    fun isOffice(ssid: String?, offices: Collection<String>): Boolean =
        ssid != null && offices.any { it.equals(ssid, ignoreCase = true) }

    /** Empty cells before the 1st of [month] in a calendar whose weeks start on [firstDayOfWeek]. */
    fun leadingBlanks(month: YearMonth, firstDayOfWeek: DayOfWeek): Int =
        (month.atDay(1).dayOfWeek.value - firstDayOfWeek.value + 7) % 7

    fun toCsv(records: Collection<DayRecord>, zone: ZoneId): String {
        fun time(millis: Long?) = millis?.let { Instant.ofEpochMilli(it).atZone(zone).format(CSV_TIME) } ?: ""
        val csv = StringBuilder("date,weekday,check_in,last_seen,source\n")
        for (record in records.sortedBy { it.day }) {
            csv.append(record.day).append(',')
                .append(record.day.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.ENGLISH)).append(',')
                .append(time(record.checkIn)).append(',')
                .append(time(record.lastSeen)).append(',')
                .append(record.source.name.lowercase()).append('\n')
        }
        return csv.toString()
    }
}
