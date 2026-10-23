package dev.officeattendance

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.text.format.DateFormat
import java.util.Date

object Notifications {
    private const val CHANNEL = "check_in"
    private const val CHECK_IN_ID = 1

    fun checkedIn(context: Context, ssid: String, at: Long) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.channel_check_in), NotificationManager.IMPORTANCE_DEFAULT)
        )
        if (!manager.areNotificationsEnabled()) return
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val time = DateFormat.getTimeFormat(context).format(Date(at))
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_check)
            .setContentTitle(context.getString(R.string.notification_title))
            .setContentText(context.getString(R.string.notification_text, time, ssid))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        manager.notify(CHECK_IN_ID, notification)
    }
}
