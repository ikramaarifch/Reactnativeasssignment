package com.ikrama.assignment

import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** The small JS-facing surface: start / update / stop / isRunning. No upload logic lives here. */
class UploadServiceModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "UploadService"

  /** Must be called while the app is in the foreground (Android 12+ forbids starting from the background). */
  @ReactMethod
  fun start(title: String, text: String, progress: Int, max: Int, promise: Promise) {
    try {
      val intent = Intent(reactContext, UploadForegroundService::class.java)
        .putExtra(UploadForegroundService.EXTRA_TITLE, title)
        .putExtra(UploadForegroundService.EXTRA_TEXT, text)
        .putExtra(UploadForegroundService.EXTRA_PROGRESS, progress)
        .putExtra(UploadForegroundService.EXTRA_MAX, max)
      ContextCompat.startForegroundService(reactContext, intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_START_FAILED", e.message, e)
    }
  }

  /**
   * Updates the notification directly. Unlike starting a service, posting a
   * notification is allowed from the background, so progress keeps updating
   * while the app is not visible.
   */
  @ReactMethod
  fun update(title: String, text: String, progress: Int, max: Int, promise: Promise) {
    try {
      if (UploadForegroundService.running) {
        val notification = UploadNotification.build(reactContext, title, text, progress, max)
        NotificationManagerCompat.from(reactContext).notify(UploadNotification.ID, notification)
      }
      promise.resolve(null)
    } catch (e: SecurityException) {
      promise.resolve(null) // notification permission not granted: the service still runs
    } catch (e: Exception) {
      promise.reject("E_UPDATE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      reactContext.stopService(Intent(reactContext, UploadForegroundService::class.java))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_STOP_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(UploadForegroundService.running)
  }

  /**
   * A timer that works in the background. React Native's own setTimeout is
   * driven by the display's frame callback and stops when the app is not
   * visible, which would silently disable the engine's watchdog and retries.
   * A native Handler is not affected; the promise resolving wakes the JS side.
   */
  @ReactMethod
  fun sleep(ms: Double, promise: Promise) {
    mainHandler.postDelayed({ promise.resolve(null) }, ms.toLong().coerceAtLeast(0))
  }

  private val mainHandler = Handler(Looper.getMainLooper())
}
