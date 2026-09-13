package com.example.raahieye.viewmodel

import android.app.Application
import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.view.Surface
import android.view.SurfaceView
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.raahieye.model.GpsData
import com.example.raahieye.model.NetworkInfo
import com.example.raahieye.model.RtspConfig
import com.example.raahieye.model.SettingsRepository
import com.example.raahieye.model.StreamState
import com.pedro.common.ConnectChecker
import com.pedro.library.rtsp.RtspStream
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class RaahiViewModel(application: Application) : AndroidViewModel(application), ConnectChecker {

    private val _streamState = MutableStateFlow(StreamState.IDLE)
    val streamState: StateFlow<StreamState> = _streamState.asStateFlow()

    private val _gpsData = MutableStateFlow(GpsData())
    val gpsData: StateFlow<GpsData> = _gpsData.asStateFlow()

    private val _networkInfo = MutableStateFlow(NetworkInfo())
    val networkInfo: StateFlow<NetworkInfo> = _networkInfo.asStateFlow()

    private val _busId = MutableStateFlow("RAAHI-BUS-01")
    val busId: StateFlow<String> = _busId.asStateFlow()

    // Emulator detection for default loopback host (10.0.2.2 vs 127.0.0.1)
    val isEmulator = android.os.Build.FINGERPRINT.startsWith("generic")
            || android.os.Build.FINGERPRINT.startsWith("unknown")
            || android.os.Build.MODEL.contains("google_sdk")
            || android.os.Build.MODEL.contains("Emulator")
            || android.os.Build.MODEL.contains("Android SDK built for x86")
            || android.os.Build.HARDWARE.contains("goldfish")
            || android.os.Build.HARDWARE.contains("ranchu")

    private val settingsRepository = SettingsRepository(application, isEmulator)

    private val _rtspConfig = MutableStateFlow(settingsRepository.defaultRtspConfig)
    val rtspConfig: StateFlow<RtspConfig> = _rtspConfig.asStateFlow()

    // Backward-compatible edgeIp StateFlow reflecting the current configured host
    private val _edgeIp = MutableStateFlow(settingsRepository.defaultHost)
    val edgeIp: StateFlow<String> = _edgeIp.asStateFlow()

    fun setEdgeIp(ip: String) {
        updateRtspConfig(host = ip, port = _rtspConfig.value.port, path = _rtspConfig.value.path)
    }

    fun updateRtspConfig(host: String, port: Int, path: String) {
        val newConfig = RtspConfig(
            host = host.trim().removePrefix("rtsp://").trimEnd('/'),
            port = port,
            path = path.trim().trim('/')
        )
        _rtspConfig.value = newConfig
        _edgeIp.value = newConfig.host
        viewModelScope.launch {
            settingsRepository.saveRtspConfig(newConfig)
        }
    }

    fun resetRtspConfigToDefault() {
        val defaultConfig = settingsRepository.defaultRtspConfig
        _rtspConfig.value = defaultConfig
        _edgeIp.value = defaultConfig.host
        viewModelScope.launch {
            settingsRepository.resetToDefault()
        }
    }

    // RtspStream (StreamBase) is the modern RootEncoder 2.8+ standard
    private val rtspStream = RtspStream(application, this)

    private var isPrepared = false

    init {
        isPrepared = prepareEncoders()
        viewModelScope.launch {
            settingsRepository.rtspConfigFlow.collect { savedConfig ->
                _rtspConfig.value = savedConfig
                _edgeIp.value = savedConfig.host
            }
        }
    }

    private fun prepareEncoders(): Boolean {
        val videoPrepared = if (rtspStream.isOnPreview) {
            true
        } else {
            try {
                rtspStream.prepareVideo(width = 1920, height = 1080, bitrate = 6_000_000)
            } catch (e: Exception) {
                try {
                    rtspStream.prepareVideo(width = 1280, height = 720, bitrate = 3_000_000)
                } catch (ex: Exception) {
                    try {
                        rtspStream.prepareVideo(width = 640, height = 480, bitrate = 1_200_000)
                    } catch (_: Exception) {
                        false
                    }
                }
            }
        }

        var audioPrepared = try {
            rtspStream.prepareAudio(sampleRate = 44100, isStereo = true, bitrate = 64 * 1024)
        } catch (e: Exception) {
            false
        }
        if (!audioPrepared) {
            audioPrepared = try {
                rtspStream.prepareAudio(sampleRate = 16000, isStereo = false, bitrate = 32 * 1024)
            } catch (e: Exception) {
                false
            }
        }
        if (!audioPrepared) {
            try {
                rtspStream.changeAudioSource(com.pedro.encoder.input.sources.audio.NoAudioSource())
                audioPrepared = rtspStream.prepareAudio(sampleRate = 16000, isStereo = false, bitrate = 32 * 1024)
            } catch (_: Exception) {}
        }

        return videoPrepared && audioPrepared
    }

    // Attach the Compose UI surface to the running background camera
    fun attachPreview(surfaceView: SurfaceView) {
        if (!isPrepared) {
            isPrepared = prepareEncoders()
        }
        if (!isPrepared) return

        if (rtspStream.isOnPreview) {
            rtspStream.stopPreview()
        }

        val rotation = surfaceView.display?.rotation
            ?: (surfaceView.context.getSystemService(android.view.WindowManager::class.java))?.defaultDisplay?.rotation
            ?: Surface.ROTATION_0
        updateOrientation(rotation)

        rtspStream.startPreview(surfaceView)
    }

    fun switchCamera() {
        try {
            (rtspStream.videoSource as? com.pedro.encoder.input.sources.video.Camera2Source)?.switchCamera()
        } catch (_: Exception) {}
    }

    // Detach the UI surface (e.g., during rotation)
    fun detachPreview() {
        if (rtspStream.isOnPreview) {
            rtspStream.stopPreview()
        }
    }

    fun setPreviewResolution(width: Int, height: Int) {
        try {
            rtspStream.getGlInterface().setPreviewResolution(width, height)
        } catch (_: Exception) {}
    }

    private fun getBackCameraSensorOrientation(): Int {
        val cameraManager = getApplication<Application>().getSystemService(Context.CAMERA_SERVICE) as? CameraManager
        return try {
            val cameraId = cameraManager?.cameraIdList?.firstOrNull { id ->
                val characteristics = cameraManager.getCameraCharacteristics(id)
                characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK
            } ?: cameraManager?.cameraIdList?.firstOrNull()

            if (cameraId != null && cameraManager != null) {
                cameraManager.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
            } else {
                90
            }
        } catch (_: Exception) {
            90
        }
    }

    fun updateOrientation(displayRotation: Int) {
        val sensorOrientation = getBackCameraSensorOrientation()
        val deviceDegrees = when (displayRotation) {
            Surface.ROTATION_0 -> 0
            Surface.ROTATION_90 -> 90
            Surface.ROTATION_180 -> 180
            Surface.ROTATION_270 -> 270
            else -> 0
        }

        // Standard Android Camera2 rotation:
        val cameraRotation = (sensorOrientation - deviceDegrees + 360) % 360

        // RootEncoder's OpenGL CameraRender expects: (cameraRotation - 90 + 360) % 360
        // (as implemented in RootEncoder Camera2Base.prepareGlView and SensorRotationManager.getUiOrientation)
        val renderRotation = (cameraRotation - 90 + 360) % 360
        val isPortrait = (deviceDegrees == 0 || deviceDegrees == 180)

        android.util.Log.i(
            "RAAHI_CAMERA_ORIENTATION",
            "SENSOR_ORIENTATION=$sensorOrientation, displayRotation=$displayRotation (deviceDegrees=$deviceDegrees), cameraRotation=$cameraRotation, renderRotation=$renderRotation, isPortrait=$isPortrait"
        )

        try {
            rtspStream.getGlInterface().autoHandleOrientation = false
        } catch (_: Exception) {}

        rtspStream.setOrientation(renderRotation)
        try {
            rtspStream.getGlInterface().setIsPortrait(isPortrait)
        } catch (_: Exception) {}
    }

    fun toggleStream() {
        when (_streamState.value) {
            StreamState.CONNECTING, StreamState.RECONNECTING -> return
            StreamState.IDLE, StreamState.ERROR -> startStreamSequence()
            StreamState.STREAMING -> stopStream()
        }
    }

    private fun startStreamSequence() {
        if (!isPrepared) {
            isPrepared = prepareEncoders()
        }
        if (!isPrepared) {
            _streamState.value = StreamState.ERROR
            return
        }

        if (!rtspStream.isStreaming) {
            _streamState.value = StreamState.CONNECTING
            val url = _rtspConfig.value.fullUrl
            android.util.Log.i("RAAHI_RTSP_STREAM", "Connecting to configured RTSP destination: $url")
            try {
                rtspStream.startStream(url)
            } catch (e: Exception) {
                android.util.Log.e("RAAHI_RTSP_STREAM", "Failed to start stream to $url", e)
                _streamState.value = StreamState.ERROR
            }
        }
    }

    private fun stopStream() {
        if (rtspStream.isStreaming) {
            try {
                rtspStream.stopStream()
            } catch (_: Exception) {}
        }
        _streamState.value = StreamState.IDLE
    }

    // --- ConnectChecker Callbacks ---
    override fun onConnectionStarted(url: String) {
        _streamState.value = StreamState.CONNECTING
    }

    override fun onConnectionSuccess() {
        _streamState.value = StreamState.STREAMING
    }

    override fun onConnectionFailed(reason: String) {
        try {
            rtspStream.stopStream()
        } catch (_: Exception) {}
        _streamState.value = StreamState.ERROR
    }

    override fun onNewBitrate(bitrate: Long) {
        // Will be used to feed the UI Stream Stats card
    }

    override fun onDisconnect() {
        // Only reset to IDLE if we are not currently reporting an ERROR state
        if (_streamState.value != StreamState.ERROR) {
            _streamState.value = StreamState.IDLE
        }
    }

    override fun onAuthError() {
        try {
            rtspStream.stopStream()
        } catch (_: Exception) {}
        _streamState.value = StreamState.ERROR
    }

    override fun onAuthSuccess() {}

    override fun onCleared() {
        super.onCleared()
        stopStream()
        detachPreview()
    }
}