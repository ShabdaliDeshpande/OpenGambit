package dev.officeattendance

import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import java.util.concurrent.TimeUnit

/**
 * The two things that wake the app without it running: Android calls [WifiConnectedReceiver]
 * whenever the phone joins a Wi-Fi network, and [CheckJobService] runs about every 15 minutes
 * as a safety net (it also keeps "last seen" current through the day).
 */
object Watchers {
    private const val JOB_ID = 1

    fun start(context: Context) {
        val app = context.applicationContext
        registerWifiCallback(app)
        schedulePeriodicCheck(app)
    }

    private fun registerWifiCallback(context: Context) {
        val connectivity = context.getSystemService(ConnectivityManager::class.java) ?: return
        val request = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
        val intent = PendingIntent.getBroadcast(
            context, 0, Intent(context, WifiConnectedReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        // registering the same PendingIntent again replaces the earlier registration
        connectivity.registerNetworkCallback(request, intent)
    }

    private fun schedulePeriodicCheck(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java) ?: return
        if (scheduler.getPendingJob(JOB_ID) != null) return
        scheduler.schedule(
            JobInfo.Builder(JOB_ID, ComponentName(context, CheckJobService::class.java))
                .setPeriodic(TimeUnit.MINUTES.toMillis(15))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build()
        )
    }
}

class WifiConnectedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        OfficeWifi.check(context)
    }
}

/** Network callbacks don't survive a reboot or an app update, so set them up again. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            Watchers.start(context)
            OfficeWifi.check(context)
        }
    }
}

class CheckJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        OfficeWifi.check(this)
        return false
    }

    override fun onStopJob(params: JobParameters): Boolean = false
}
