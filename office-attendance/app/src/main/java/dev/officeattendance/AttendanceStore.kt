package dev.officeattendance

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** The attendance log: one row per day at the office, kept only on this phone. */
class AttendanceStore(context: Context) : SQLiteOpenHelper(context.applicationContext, "attendance.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            "CREATE TABLE $TABLE (day TEXT PRIMARY KEY, check_in INTEGER, last_seen INTEGER, source TEXT NOT NULL)"
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    /** Notes that the phone was on office Wi-Fi at [now]. Returns true when this is the day's first check-in. */
    fun recordSeen(now: Long, zone: ZoneId = ZoneId.systemDefault()): Boolean {
        val day = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().toString()
        val db = writableDatabase
        db.beginTransaction()
        try {
            val exists = DatabaseUtils.longForQuery(db, "SELECT COUNT(*) FROM $TABLE WHERE day = ?", arrayOf(day)) > 0
            if (exists) {
                // a day marked by hand becomes a Wi-Fi day once the phone actually sees the office
                db.execSQL(
                    "UPDATE $TABLE SET check_in = COALESCE(check_in, ?), last_seen = MAX(COALESCE(last_seen, 0), ?), source = ? WHERE day = ?",
                    arrayOf<Any>(now, now, Source.WIFI.name, day)
                )
            } else {
                db.insert(TABLE, null, ContentValues().apply {
                    put("day", day)
                    put("check_in", now)
                    put("last_seen", now)
                    put("source", Source.WIFI.name)
                })
            }
            db.setTransactionSuccessful()
            return !exists
        } finally {
            db.endTransaction()
        }
    }

    fun setManual(day: LocalDate, present: Boolean) {
        if (present) {
            writableDatabase.insertWithOnConflict(TABLE, null, ContentValues().apply {
                put("day", day.toString())
                put("source", Source.MANUAL.name)
            }, SQLiteDatabase.CONFLICT_IGNORE)
        } else {
            writableDatabase.delete(TABLE, "day = ?", arrayOf(day.toString()))
        }
    }

    fun get(day: LocalDate): DayRecord? = query("day = ?", arrayOf(day.toString())).firstOrNull()

    /** Days from [from] to [to], both included. ISO dates sort as text, so a string range works. */
    fun between(from: LocalDate, to: LocalDate): List<DayRecord> =
        query("day BETWEEN ? AND ?", arrayOf(from.toString(), to.toString()))

    fun all(): List<DayRecord> = query(null, null)

    private fun query(selection: String?, args: Array<String>?): List<DayRecord> =
        readableDatabase.query(TABLE, COLUMNS, selection, args, null, null, "day").use { cursor ->
            buildList {
                while (cursor.moveToNext()) {
                    add(DayRecord(
                        day = LocalDate.parse(cursor.getString(0)),
                        checkIn = cursor.longOrNull(1),
                        lastSeen = cursor.longOrNull(2),
                        source = Source.valueOf(cursor.getString(3)),
                    ))
                }
            }
        }

    private fun Cursor.longOrNull(column: Int): Long? = if (isNull(column)) null else getLong(column)

    private companion object {
        const val TABLE = "attendance"
        val COLUMNS = arrayOf("day", "check_in", "last_seen", "source")
    }
}
