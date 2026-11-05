package com.ikrama.assignment

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Opens the system camera and makes it write the photo to a path the JS side
 * chose BEFORE launching.
 *
 * Why not just ask the camera for a result: on a phone with little free memory
 * Android can kill this app while the (heavy) camera app is in front, and the
 * result then arrives in a brand-new process with nobody waiting for it. The
 * camera still finishes writing to the agreed path, so the JS side can find the
 * photo there on the next start.
 */
class CameraCaptureModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var pending: Promise? = null

  private val resultListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_CAPTURE) {
        return
      }
      val promise = pending ?: return
      pending = null
      promise.resolve(if (resultCode == Activity.RESULT_OK) "captured" else "cancelled")
    }
  }

  init {
    reactContext.addActivityEventListener(resultListener)
  }

  override fun getName(): String = "CameraCapture"

  /** Resolves "captured" or "cancelled". `path` must be inside filesDir/captures (see capture_paths.xml). */
  @ReactMethod
  fun capture(path: String, promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity")
      return
    }
    if (pending != null) {
      promise.reject("E_BUSY", "The camera is already open")
      return
    }
    try {
      val file = File(path)
      file.parentFile?.mkdirs()
      val uri = FileProvider.getUriForFile(reactContext, "${reactContext.packageName}.capture", file)
      val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        .putExtra(MediaStore.EXTRA_OUTPUT, uri)
        .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      intent.clipData = ClipData.newRawUri("", uri) // makes the grant reach the camera app on every Android version
      if (intent.resolveActivity(reactContext.packageManager) == null) {
        promise.reject("E_CAMERA_UNAVAILABLE", "No camera app")
        return
      }
      pending = promise
      activity.startActivityForResult(intent, REQUEST_CAPTURE)
    } catch (e: Exception) {
      pending = null
      promise.reject("E_CAPTURE_FAILED", e.message, e)
    }
  }

  private companion object {
    const val REQUEST_CAPTURE = 4202
  }
}
