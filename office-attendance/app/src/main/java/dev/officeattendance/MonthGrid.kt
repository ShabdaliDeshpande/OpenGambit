package dev.officeattendance

import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.format.TextStyle
import java.time.temporal.WeekFields
import java.util.Locale
import kotlin.math.roundToInt

/** Fills [container] with a month calendar. Each day is a real view, so it can be tapped and read by TalkBack. */
class MonthGrid(private val container: LinearLayout, private val onDayClick: (LocalDate) -> Unit) {
    private val context = container.context
    private val firstDayOfWeek = WeekFields.of(Locale.getDefault()).firstDayOfWeek
    private val dayLabel = DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL)

    fun show(month: YearMonth, records: Map<LocalDate, DayRecord>, today: LocalDate) {
        container.removeAllViews()
        container.addView(row().apply {
            for (i in 0 until 7) addView(weekdayLabel(firstDayOfWeek.plus(i.toLong()).getDisplayName(TextStyle.NARROW, Locale.getDefault())))
        })
        val blanks = AttendanceLogic.leadingBlanks(month, firstDayOfWeek)
        val days = month.lengthOfMonth()
        for (start in 0 until blanks + days step 7) {
            val week = row()
            for (index in start until start + 7) {
                val day = index - blanks + 1
                week.addView(if (day in 1..days) dayCell(month.atDay(day), records[month.atDay(day)], today) else spacer())
            }
            container.addView(week)
        }
    }

    private fun dayCell(date: LocalDate, record: DayRecord?, today: LocalDate): View {
        val number = TextView(context).apply {
            text = date.dayOfMonth.toString()
            gravity = Gravity.CENTER
            textSize = 14f
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            val textColor = when {
                record?.source == Source.WIFI -> {
                    setBackgroundResource(R.drawable.day_wifi)
                    R.color.on_accent
                }
                record != null -> {
                    setBackgroundResource(R.drawable.day_manual)
                    R.color.text_primary
                }
                date == today -> {
                    setBackgroundResource(R.drawable.day_today)
                    R.color.text_primary
                }
                date.isAfter(today) -> R.color.text_secondary
                else -> R.color.text_primary
            }
            setTextColor(context.getColor(textColor))
            if (date == today) setTypeface(typeface, Typeface.BOLD)
        }
        val size = dp(38)
        return FrameLayout(context).apply {
            layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f)
            addView(number, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
            setBackgroundResource(themeResource(android.R.attr.selectableItemBackgroundBorderless))
            contentDescription = context.getString(
                when (record?.source) {
                    Source.WIFI -> R.string.day_present_wifi
                    Source.MANUAL -> R.string.day_present_manual
                    null -> R.string.day_not_marked
                },
                date.format(dayLabel)
            )
            setOnClickListener { onDayClick(date) }
        }
    }

    private fun weekdayLabel(text: String) = TextView(context).apply {
        this.text = text
        gravity = Gravity.CENTER
        textSize = 12f
        setTextColor(context.getColor(R.color.text_secondary))
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        layoutParams = LinearLayout.LayoutParams(0, dp(28), 1f)
    }

    private fun spacer() = View(context).apply { layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f) }

    private fun row() = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }

    private fun themeResource(attr: Int): Int {
        val value = TypedValue()
        context.theme.resolveAttribute(attr, value, true)
        return value.resourceId
    }

    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).roundToInt()
}
