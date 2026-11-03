package com.ikrama.assignment

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * A foreground service that does NO upload work itself. Its only job is to keep
 * the process alive and the CPU awake while the JS upload engine runs:
 *
 * - the ongoing notification + foreground-service priority stop Android from
 *   freezing or killing the process
 * - a bounded partial wake lock keeps the CPU running with the screen off
 *
 * The engine, queue and retry logic all stay in TypeScript. Timers the engine
 * needs in the background come from [UploadServiceModule.sleep], not from React
 * Native's JS timers, which stop when the app is not visible.
 *
 * Type `dataSync` is the right one for uploads. Android 15+ caps it at about
 * 6 hours per day and calls [onTimeout]; we stop cleanly and the app restarts
 * the service when it is next opened.
 */
class UploadForegroundService : Service() {

  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = UploadNotification.build(
      this,
      intent?.getStringExtra(EXTRA_TITLE) ?: "Uploading reports",
      intent?.getStringExtra(EXTRA_TEXT) ?: "",
      intent?.getIntExtra(EXTRA_PROGRESS, 0) ?: 0,
      intent?.getIntExtra(EXTRA_MAX, 0) ?: 0,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(UploadNotification.ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(UploadNotification.ID, notification)
    }
    running = true
    acquireWakeLock()
    // NOT_STICKY: if the process dies, do not resurrect a service with no engine behind it.
    // The queue is durable; uploads resume the next time the app is opened.
    return START_NOT_STICKY
  }

  /** Bounded, so a bug can never drain the battery forever. */
  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) {
      return
    }
    val pm = getSystemService(POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "assignment:uploads").apply {
      setReferenceCounted(false)
      acquire(WAKE_LOCK_MAX_MS)
    }
  }

  /** Android 15+: the dataSync time budget ran out. Must stop promptly or the app crashes. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_PROGRESS = "progress"
    const val EXTRA_MAX = "max"
    private const val WAKE_LOCK_MAX_MS = 60L * 60L * 1000L

    /** True while the service is alive; lets JS ask the OS-truth, not its own memory. */
    @Volatile
    var running = false
  }
}
