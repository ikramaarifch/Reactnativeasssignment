package com.ikrama.assignment

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/** Builds the ongoing "Uploading reports" notification shown while the service runs. */
object UploadNotification {
  const val CHANNEL_ID = "uploads"
  const val ID = 4201

  fun build(context: Context, title: String, text: String, progress: Int, max: Int): Notification {
    ensureChannel(context)
    val openApp = PendingIntent.getActivity(
      context,
      0,
      Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      },
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(title)
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true) // updates must not buzz or pop up again
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openApp)
    // Only show a bar when there is a real number: never an endless indeterminate bar.
    if (max > 0) {
      builder.setProgress(max, progress, false)
    }
    return builder.build()
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = context.getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        // LOW: visible, but silent and not intrusive.
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Report uploads", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shown while reports are being uploaded in the background"
            setShowBadge(false)
          },
        )
      }
    }
  }
}
