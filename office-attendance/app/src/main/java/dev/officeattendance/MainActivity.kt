package dev.officeattendance

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.format.DateFormat
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import java.io.IOException
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Date
import kotlin.math.roundToInt

class MainActivity : Activity() {
    private class SetupStep(val title: Int, val detail: Int, val action: Int, val run: () -> Unit)

    private lateinit var store: AttendanceStore
    private lateinit var grid: MonthGrid
    private var shownMonth: YearMonth = YearMonth.now()
    /** Permissions Android will no longer ask for; the only way left is the app's settings page. */
    private val permanentlyDenied = mutableSetOf<String>()

    private val todayStatus by lazy { findViewById<TextView>(R.id.today_status) }
    private val todayDetail by lazy { findViewById<TextView>(R.id.today_detail) }
    private val wifiStatus by lazy { findViewById<TextView>(R.id.wifi_status) }
    private val setupCard by lazy { findViewById<View>(R.id.setup_card) }
    private val setupSteps by lazy { findViewById<LinearLayout>(R.id.setup_steps) }
    private val officeList by lazy { findViewById<LinearLayout>(R.id.office_list) }
    private val officeEmpty by lazy { findViewById<View>(R.id.office_empty) }
    private val monthLabel by lazy { findViewById<TextView>(R.id.month_label) }
    private val monthSummary by lazy { findViewById<TextView>(R.id.month_summary) }
    private val nextMonth by lazy { findViewById<ImageButton>(R.id.next_month) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        store = AttendanceStore(this)
        grid = MonthGrid(findViewById(R.id.month_grid), ::onDayTapped)
        applySystemBarInsets(findViewById(R.id.scroll))

        findViewById<Button>(R.id.check_now).setOnClickListener { checkNow() }
        findViewById<Button>(R.id.add_current).setOnClickListener { addCurrentWifi() }
        findViewById<Button>(R.id.add_typed).setOnClickListener { addTypedWifi() }
        findViewById<Button>(R.id.export).setOnClickListener { export() }
        findViewById<ImageButton>(R.id.previous_month).setOnClickListener {
            shownMonth = shownMonth.minusMonths(1)
            renderMonth(LocalDate.now())
        }
        nextMonth.setOnClickListener {
            shownMonth = shownMonth.plusMonths(1)
            renderMonth(LocalDate.now())
        }

        Watchers.start(this)
    }

    override fun onDestroy() {
        store.close()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        // opening the app at the office counts too; the screen shows it, so no notification
        OfficeWifi.check(this, notify = false)
        render()
    }

    private fun render() {
        val today = LocalDate.now()
        renderToday(today)
        renderSetup()
        renderOffices()
        renderMonth(today)
    }

    private fun renderToday(today: LocalDate) {
        val record = store.get(today)
        val offices = OfficeWifi.officeSsids(this)
        todayStatus.setText(if (record != null) R.string.today_present else R.string.today_absent)
        todayStatus.setTextColor(getColor(if (record != null) R.color.accent else R.color.text_primary))
        todayDetail.text = when {
            record == null && offices.isEmpty() -> getString(R.string.today_detail_unconfigured)
            record == null -> getString(R.string.today_detail_waiting)
            record.checkIn == null -> getString(R.string.today_detail_manual)
            record.lastSeen != null && record.lastSeen - record.checkIn >= 60_000 ->
                getString(R.string.today_detail_seen, time(record.checkIn), time(record.lastSeen))
            else -> getString(R.string.today_detail_checked_in, time(record.checkIn))
        }
        val ssid = OfficeWifi.currentSsid(this)
        wifiStatus.text = when {
            ssid == null -> getString(R.string.wifi_none)
            AttendanceLogic.isOffice(ssid, offices) -> getString(R.string.wifi_office, ssid)
            else -> getString(R.string.wifi_other, ssid)
        }
    }

    private fun renderSetup() {
        val steps = setupSteps()
        setupCard.visibility = if (steps.isEmpty()) View.GONE else View.VISIBLE
        setupSteps.removeAllViews()
        for (step in steps) {
            val row = layoutInflater.inflate(R.layout.row_setup, setupSteps, false)
            row.findViewById<TextView>(R.id.title).setText(step.title)
            row.findViewById<TextView>(R.id.detail).setText(step.detail)
            row.findViewById<Button>(R.id.action).apply {
                setText(step.action)
                setOnClickListener { step.run() }
            }
            setupSteps.addView(row)
        }
    }

    private fun setupSteps(): List<SetupStep> = buildList {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            add(SetupStep(R.string.setup_location, R.string.setup_location_detail, R.string.action_allow) {
                request(LOCATION, REQUEST_LOCATION)
            })
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            add(SetupStep(R.string.setup_background, R.string.setup_background_detail, R.string.action_allow) {
                requestBackgroundLocation()
            })
        }
        if (!OfficeWifi.locationEnabled(this@MainActivity)) {
            add(SetupStep(R.string.setup_location_off, R.string.setup_location_off_detail, R.string.action_turn_on) {
                open(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            })
        }
        if (!getSystemService(NotificationManager::class.java).areNotificationsEnabled()) {
            add(SetupStep(R.string.setup_notifications, R.string.setup_notifications_detail, R.string.action_allow) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    Manifest.permission.POST_NOTIFICATIONS !in permanentlyDenied
                ) {
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
                } else {
                    open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
                }
            })
        }
        if (!getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)) {
            add(SetupStep(R.string.setup_battery, R.string.setup_battery_detail, R.string.action_allow) {
                open(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
            })
        }
    }

    private fun renderOffices() {
        val offices = OfficeWifi.officeSsids(this).sortedBy { it.lowercase() }
        officeEmpty.visibility = if (offices.isEmpty()) View.VISIBLE else View.GONE
        officeList.removeAllViews()
        for (ssid in offices) {
            val row = layoutInflater.inflate(R.layout.row_office, officeList, false)
            row.findViewById<TextView>(R.id.name).text = ssid
            row.findViewById<Button>(R.id.remove).apply {
                contentDescription = getString(R.string.remove_network, ssid)
                setOnClickListener {
                    OfficeWifi.removeOfficeSsid(this@MainActivity, ssid)
                    render()
                }
            }
            officeList.addView(row)
        }
    }

    private fun renderMonth(today: LocalDate) {
        monthLabel.text = shownMonth.format(DateTimeFormatter.ofPattern("LLLL yyyy"))
        val records = store.between(shownMonth.atDay(1), shownMonth.atEndOfMonth())
        grid.show(shownMonth, records.associateBy { it.day }, today)
        monthSummary.text = resources.getQuantityString(R.plurals.month_summary, records.size, records.size)
        val canGoForward = shownMonth < YearMonth.from(today)
        nextMonth.isEnabled = canGoForward
        nextMonth.alpha = if (canGoForward) 1f else 0.3f
    }

    private fun checkNow() {
        val message = when (val result = OfficeWifi.check(this, notify = false)) {
            CheckResult.NotConfigured -> getString(R.string.check_not_configured)
            CheckResult.NoWifi -> getString(R.string.check_no_wifi)
            is CheckResult.OtherNetwork -> getString(R.string.check_other, result.ssid)
            is CheckResult.AtOffice ->
                getString(if (result.firstToday) R.string.check_marked else R.string.check_already, result.ssid)
        }
        toast(message)
        render()
    }

    private fun addCurrentWifi() {
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            request(LOCATION, REQUEST_LOCATION_TO_ADD)
            return
        }
        val ssid = OfficeWifi.currentSsid(this)
        if (ssid == null) {
            toast(getString(if (OfficeWifi.locationEnabled(this)) R.string.add_no_wifi else R.string.add_location_off))
            return
        }
        OfficeWifi.addOfficeSsid(this, ssid)
        toast(getString(R.string.added_network, ssid))
        OfficeWifi.check(this, notify = false)
        render()
    }

    private fun addTypedWifi() {
        val input = EditText(this).apply {
            setHint(R.string.add_dialog_hint)
            setSingleLine()
        }
        val frame = FrameLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.add_dialog_title)
            .setMessage(R.string.add_dialog_message)
            .setView(frame)
            .setPositiveButton(R.string.action_add) { _, _ ->
                val ssid = input.text.toString().trim()
                if (ssid.isNotEmpty()) {
                    OfficeWifi.addOfficeSsid(this, ssid)
                    OfficeWifi.check(this, notify = false)
                    render()
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun onDayTapped(date: LocalDate) {
        if (date.isAfter(LocalDate.now())) {
            toast(getString(R.string.future_day))
            return
        }
        val present = store.get(date) != null
        val label = date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL))
        AlertDialog.Builder(this)
            .setMessage(getString(if (present) R.string.unmark_message else R.string.mark_message, label))
            .setPositiveButton(if (present) R.string.action_remove else R.string.action_mark) { _, _ ->
                store.setManual(date, !present)
                render()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun export() {
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("text/csv")
            .putExtra(Intent.EXTRA_TITLE, "office-attendance.csv")
        try {
            startActivityForResult(intent, REQUEST_EXPORT)
        } catch (e: ActivityNotFoundException) {
            toast(getString(R.string.export_failed))
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_EXPORT) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return
        val records = store.all()
        try {
            val output = contentResolver.openOutputStream(uri) ?: throw IOException("no output stream")
            output.use { it.write(AttendanceLogic.toCsv(records, ZoneId.systemDefault()).toByteArray()) }
            toast(resources.getQuantityString(R.plurals.exported, records.size, records.size))
        } catch (e: IOException) {
            toast(getString(R.string.export_failed))
        } catch (e: SecurityException) {
            toast(getString(R.string.export_failed))
        }
    }

    private fun requestBackgroundLocation() {
        val option = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            packageManager.backgroundPermissionOptionLabel
        } else {
            getString(R.string.allow_all_the_time)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.background_dialog_title)
            .setMessage(getString(R.string.background_dialog_message, option))
            .setPositiveButton(R.string.action_continue) { _, _ ->
                request(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), REQUEST_BACKGROUND_LOCATION)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun request(permissions: Array<String>, requestCode: Int) {
        if (permissions[0] in permanentlyDenied) {
            open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        } else {
            requestPermissions(permissions, requestCode)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (permissions.isEmpty() || grantResults.isEmpty()) return
        val allGranted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }
        if (!allGranted && !shouldShowRequestPermissionRationale(permissions[0])) permanentlyDenied += permissions[0]
        if (allGranted && requestCode == REQUEST_LOCATION_TO_ADD) {
            addCurrentWifi()
            return
        }
        if (allGranted) OfficeWifi.check(this, notify = false)
        render()
    }

    private fun applySystemBarInsets(view: View) {
        // only Android 15+ draws this app edge to edge; on older versions these insets are already consumed
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        view.setOnApplyWindowInsetsListener { v, insets ->
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    private fun granted(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun open(intent: Intent) {
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        }
    }

    private fun time(millis: Long) = DateFormat.getTimeFormat(this).format(Date(millis))

    private fun toast(text: CharSequence) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()

    private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()

    private companion object {
        val LOCATION = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        const val REQUEST_LOCATION = 1
        const val REQUEST_LOCATION_TO_ADD = 2
        const val REQUEST_BACKGROUND_LOCATION = 3
        const val REQUEST_NOTIFICATIONS = 4
        const val REQUEST_EXPORT = 5
    }
}
