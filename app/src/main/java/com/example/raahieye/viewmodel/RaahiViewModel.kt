package com.example.raahieye.viewmodel

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.location.Location
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Looper
import android.os.SystemClock
import android.view.Surface
import android.view.SurfaceView
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.raahieye.model.AppIconChoice
import com.example.raahieye.model.AppIconMode
import com.example.raahieye.model.AppThemeMode
import com.example.raahieye.model.GpsData
import com.example.raahieye.model.NetworkInfo
import com.example.raahieye.model.RtspConfig
import com.example.raahieye.model.SettingsRepository
import com.example.raahieye.model.StreamState
import com.example.raahieye.model.StreamStats
import com.example.raahieye.util.AppIconManager
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.pedro.common.ConnectChecker
import com.pedro.library.rtsp.RtspStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.time.Instant
import java.util.Collections
import java.util.Locale

class RaahiViewModel(application: Application) : AndroidViewModel(application), ConnectChecker {

    private val _streamState = MutableStateFlow(StreamState.IDLE)
    val streamState: StateFlow<StreamState> = _streamState.asStateFlow()

    private val _gpsData = MutableStateFlow(GpsData())
    val gpsData: StateFlow<GpsData> = _gpsData.asStateFlow()

    private val _networkInfo = MutableStateFlow(NetworkInfo())
    val networkInfo: StateFlow<NetworkInfo> = _networkInfo.asStateFlow()

    private val _busId = MutableStateFlow("RAAHI-BUS-01")
    val busId: StateFlow<String> = _busId.asStateFlow()

    // Real Stream Duration Timer (HH:MM:SS)
    private val _streamDuration = MutableStateFlow("--:--:--")
    val streamDuration: StateFlow<String> = _streamDuration.asStateFlow()

    // Real Stream Runtime Telemetry
    private val _streamStats = MutableStateFlow(StreamStats())
    val streamStats: StateFlow<StreamStats> = _streamStats.asStateFlow()

    // App Theme (Light, Dark, OLED)
    private val _themeMode = MutableStateFlow(AppThemeMode.OLED)
    val themeMode: StateFlow<AppThemeMode> = _themeMode.asStateFlow()

    // App Launcher Icon (Automatic, Manual)
    private val _appIconMode = MutableStateFlow(AppIconMode.AUTOMATIC)
    val appIconMode: StateFlow<AppIconMode> = _appIconMode.asStateFlow()

    private val _appIconManualChoice = MutableStateFlow(AppIconChoice.OLED)
    val appIconManualChoice: StateFlow<AppIconChoice> = _appIconManualChoice.asStateFlow()

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

    fun setThemeMode(mode: AppThemeMode) {
        _themeMode.value = mode
        viewModelScope.launch {
            settingsRepository.saveThemeMode(mode)
        }
    }

    fun cycleThemeMode() {
        val next = when (_themeMode.value) {
            AppThemeMode.LIGHT -> AppThemeMode.DARK
            AppThemeMode.DARK -> AppThemeMode.OLED
            AppThemeMode.OLED -> AppThemeMode.LIGHT
        }
        setThemeMode(next)
    }

    fun setAppIconMode(mode: AppIconMode) {
        _appIconMode.value = mode
        viewModelScope.launch {
            settingsRepository.saveAppIconMode(mode)
            AppIconManager.applyAppIcon(getApplication(), mode, _appIconManualChoice.value)
        }
    }

    fun setAppIconManualChoice(choice: AppIconChoice) {
        _appIconMode.value = AppIconMode.MANUAL
        _appIconManualChoice.value = choice
        viewModelScope.launch {
            settingsRepository.saveAppIconMode(AppIconMode.MANUAL)
            settingsRepository.saveAppIconManualChoice(choice)
            AppIconManager.applyAppIcon(getApplication(), AppIconMode.MANUAL, choice)
        }
    }

    fun syncAppIconWithSystemTheme() {
        AppIconManager.applyAppIcon(getApplication(), _appIconMode.value, _appIconManualChoice.value)
    }

    // --- Session Timer (Preserved across reconnects) ---
    private var sessionTimerJob: Job? = null
    private var sessionStartTime: Long? = null

    private fun startSessionTimer() {
        if (sessionStartTime == null) {
            sessionStartTime = SystemClock.elapsedRealtime()
        }
        if (sessionTimerJob?.isActive != true) {
            sessionTimerJob = viewModelScope.launch {
                while (isActive) {
                    val start = sessionStartTime ?: break
                    val elapsedSec = (SystemClock.elapsedRealtime() - start) / 1000L
                    val hours = elapsedSec / 3600
                    val minutes = (elapsedSec % 3600) / 60
                    val seconds = elapsedSec % 60
                    _streamDuration.value = String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, seconds)
                    delay(1000L)
                }
            }
        }
    }

    private fun stopSessionTimer() {
        sessionTimerJob?.cancel()
        sessionTimerJob = null
        sessionStartTime = null
        _streamDuration.value = "--:--:--"
    }

    // --- Network State Tracking (Decoupled from RTSP) ---
    private val connectivityManager = application.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { updateNetworkInfo() }
        override fun onLost(network: Network) { updateNetworkInfo() }
        override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) { updateNetworkInfo() }
        override fun onLinkPropertiesChanged(network: Network, linkProperties: LinkProperties) { updateNetworkInfo() }
    }

    fun updateNetworkInfo() {
        try {
            // 1. Check if device is hosting a hotspot
            val (hotspotIp, isHotspot) = checkForHotspotInterface()
            if (isHotspot && hotspotIp != null) {
                _networkInfo.value = NetworkInfo(isConnected = true, type = "Hotspot", localIp = hotspotIp)
                return
            }

            // 2. Inspect all active networks for prioritized transport (Wi-Fi > USB/Ethernet > Cellular)
            val allNetworks = connectivityManager.allNetworks
            var wifiNetwork: Network? = null
            var usbNetwork: Network? = null
            var cellularNetwork: Network? = null

            for (net in allNetworks) {
                val caps = connectivityManager.getNetworkCapabilities(net) ?: continue
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                    wifiNetwork = net
                } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) || caps.hasTransport(NetworkCapabilities.TRANSPORT_USB)) {
                    usbNetwork = net
                } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                    cellularNetwork = net
                }
            }

            val chosenNetwork = wifiNetwork ?: usbNetwork ?: cellularNetwork ?: connectivityManager.activeNetwork

            if (chosenNetwork == null) {
                val (fallbackIp, fallbackType) = findActiveLocalIpAndType()
                if (fallbackIp != null) {
                    _networkInfo.value = NetworkInfo(isConnected = true, type = fallbackType, localIp = fallbackIp)
                } else {
                    _networkInfo.value = NetworkInfo(isConnected = false, type = "Not connected", localIp = "—")
                }
                return
            }

            val caps = connectivityManager.getNetworkCapabilities(chosenNetwork)
            val type = when {
                chosenNetwork == wifiNetwork || (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) -> "Wi-Fi"
                chosenNetwork == usbNetwork || (caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) || caps.hasTransport(NetworkCapabilities.TRANSPORT_USB))) -> "USB"
                chosenNetwork == cellularNetwork || (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) -> "Cellular"
                else -> {
                    val (_, fallbackType) = findActiveLocalIpAndType()
                    fallbackType
                }
            }

            var localIp: String? = null
            val linkProperties = connectivityManager.getLinkProperties(chosenNetwork)
            linkProperties?.linkAddresses?.forEach { linkAddr ->
                val addr = linkAddr.address
                if (addr is Inet4Address && !addr.isLoopbackAddress) {
                    localIp = addr.hostAddress
                }
            }

            if (localIp == null) {
                val (fallbackIp, _) = findActiveLocalIpAndType()
                localIp = fallbackIp ?: hotspotIp
            }

            _networkInfo.value = NetworkInfo(
                isConnected = true,
                type = type,
                localIp = localIp ?: "—"
            )
        } catch (e: Exception) {
            android.util.Log.e("RAAHI_NET", "Error checking network state", e)
        }
    }

    private fun checkForHotspotInterface(): Pair<String?, Boolean> {
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (iface in interfaces) {
                if (!iface.isUp || iface.isLoopback) continue
                val name = iface.name.lowercase()
                if (name.contains("ap") || name.contains("swlan1") || name.contains("wlan1")) {
                    val addresses = Collections.list(iface.inetAddresses)
                    for (addr in addresses) {
                        if (addr is Inet4Address && !addr.isLoopbackAddress) {
                            return Pair(addr.hostAddress, true)
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        return Pair(null, false)
    }

    private fun findActiveLocalIpAndType(): Pair<String?, String> {
        try {
            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (iface in interfaces) {
                if (!iface.isUp || iface.isLoopback) continue
                val addresses = Collections.list(iface.inetAddresses)
                for (addr in addresses) {
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val name = iface.name.lowercase()
                        val type = when {
                            name.contains("wlan") || name.contains("swlan") -> "Wi-Fi"
                            name.contains("ap") -> "Hotspot"
                            name.contains("rndis") || name.contains("usb") || name.contains("eth") -> "USB"
                            name.contains("rmnet") || name.contains("ccmni") || name.contains("pdp") -> "Cellular"
                            else -> "Wi-Fi"
                        }
                        return Pair(addr.hostAddress, type)
                    }
                }
            }
        } catch (_: Exception) {}
        return Pair(null, "Not connected")
    }

    // RtspStream (StreamBase) is the modern RootEncoder 2.8+ standard
    private val rtspStream = RtspStream(application, this)

    private var isPrepared = false

    companion object {
        private const val RECONNECT_DELAY_MS = 3_000L
        private const val RECONNECT_WINDOW_MS = 15 * 60 * 1_000L // 15-minute reconnect window
    }

    private var userRequestedStop = false
    private var reconnectJob: Job? = null
    private var reconnectStartTime: Long? = null

    // --- GPS & Telemetry Transmission ---
    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(application)

    private var isLocationUpdatesActive = false
    private var lastLocationLogTime = 0L
    private var lastHttpLogTime = 0L
    private var lastHttpErrorLogTime = 0L

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return

            // Staleness check: discard locations older than 10 seconds or from future
            val ageMs = (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000L
            if (ageMs > 10_000L || ageMs < -5_000L) {
                android.util.Log.d("RAAHI_GPS", "Discarding stale location fix (${ageMs}ms old)")
                return
            }

            val locationTime = if (location.time > 0L) location.time else System.currentTimeMillis()
            val isoTimestamp = Instant.ofEpochMilli(locationTime).toString()

            _gpsData.value = GpsData(
                latitude = location.latitude,
                longitude = location.longitude,
                accuracyMeters = location.accuracy,
                isAvailable = true,
                timestamp = isoTimestamp
            )

            val now = SystemClock.elapsedRealtime()
            if (now - lastLocationLogTime >= 3000L) {
                android.util.Log.i("RAAHI_GPS", "Fresh GPS fix: lat=${location.latitude}, lon=${location.longitude}, acc=${location.accuracy}m, ts=$isoTimestamp")
                lastLocationLogTime = now
            }

            sendGpsToBackend(location, isoTimestamp)
        }
    }

    fun startLocationUpdates() {
        if (isLocationUpdatesActive) return

        val hasFinePermission = ContextCompat.checkSelfPermission(
            getApplication(),
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarsePermission = ContextCompat.checkSelfPermission(
            getApplication(),
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasFinePermission && !hasCoarsePermission) {
            android.util.Log.w("RAAHI_GPS", "GPS permission status: DENIED. Cannot start location updates.")
            return
        }

        android.util.Log.i("RAAHI_GPS", "GPS permission status: GRANTED. Requesting continuous updates (1 Hz, High Accuracy)...")

        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            1000L // 1 second update interval
        ).apply {
            setMinUpdateIntervalMillis(1000L)
            setMinUpdateDistanceMeters(0f)
            setWaitForAccurateLocation(false)
        }.build()

        try {
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            )
            isLocationUpdatesActive = true
            android.util.Log.i("RAAHI_GPS", "Continuous GPS updates active (interval=1000ms)")
        } catch (e: SecurityException) {
            android.util.Log.e("RAAHI_GPS", "SecurityException requesting location updates", e)
        } catch (e: Exception) {
            android.util.Log.e("RAAHI_GPS", "Error requesting location updates", e)
        }
    }

    fun stopLocationUpdates() {
        if (!isLocationUpdatesActive) return
        try {
            fusedLocationClient.removeLocationUpdates(locationCallback)
            isLocationUpdatesActive = false
            _gpsData.value = _gpsData.value.copy(isAvailable = false)
            android.util.Log.i("RAAHI_GPS", "Stopped GPS updates")
        } catch (e: Exception) {
            android.util.Log.e("RAAHI_GPS", "Error stopping location updates", e)
        }
    }

    private fun sendGpsToBackend(location: Location, isoTimestamp: String) {
        val host = _rtspConfig.value.host
        val urlString = "http://$host:5001/api/gps"

        viewModelScope.launch(Dispatchers.IO) {
            var connection: HttpURLConnection? = null
            try {
                val url = URL(urlString)
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 3000
                    readTimeout = 3000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                    setRequestProperty("Accept", "application/json")
                }

                val payload = """{"latitude":${location.latitude},"longitude":${location.longitude},"accuracy":${location.accuracy},"timestamp":"$isoTimestamp","connected":true}"""

                connection.outputStream.use { os ->
                    os.write(payload.toByteArray(Charsets.UTF_8))
                    os.flush()
                }

                val responseCode = connection.responseCode
                val now = SystemClock.elapsedRealtime()
                if (responseCode in 200..299) {
                    if (now - lastHttpLogTime >= 3000L) {
                        android.util.Log.i("RAAHI_GPS", "HTTP POST $urlString -> $responseCode OK [lat=${location.latitude}, lon=${location.longitude}, acc=${location.accuracy}m, ts=$isoTimestamp]")
                        lastHttpLogTime = now
                    }
                } else {
                    if (now - lastHttpErrorLogTime >= 3000L) {
                        android.util.Log.w("RAAHI_GPS", "HTTP POST $urlString -> Error response code $responseCode")
                        lastHttpErrorLogTime = now
                    }
                }
            } catch (e: Exception) {
                val now = SystemClock.elapsedRealtime()
                if (now - lastHttpErrorLogTime >= 3000L) {
                    android.util.Log.w("RAAHI_GPS", "HTTP POST $urlString failed: ${e.message}")
                    lastHttpErrorLogTime = now
                }
            } finally {
                connection?.disconnect()
            }
        }
    }

    init {
        isPrepared = prepareEncoders()
        viewModelScope.launch {
            settingsRepository.rtspConfigFlow.collect { savedConfig ->
                _rtspConfig.value = savedConfig
                _edgeIp.value = savedConfig.host
            }
        }
        viewModelScope.launch {
            settingsRepository.themeModeFlow.collect { savedTheme ->
                _themeMode.value = savedTheme
            }
        }
        viewModelScope.launch {
            settingsRepository.appIconModeFlow.collect { savedMode ->
                _appIconMode.value = savedMode
                AppIconManager.applyAppIcon(getApplication(), savedMode, _appIconManualChoice.value)
            }
        }
        viewModelScope.launch {
            settingsRepository.appIconManualChoiceFlow.collect { savedChoice ->
                _appIconManualChoice.value = savedChoice
                if (_appIconMode.value == AppIconMode.MANUAL) {
                    AppIconManager.applyAppIcon(getApplication(), AppIconMode.MANUAL, savedChoice)
                }
            }
        }
        try {
            val networkRequest = NetworkRequest.Builder().build()
            connectivityManager.registerNetworkCallback(networkRequest, networkCallback)
        } catch (e: Exception) {
            android.util.Log.e("RAAHI_NET", "Failed to register network callback", e)
        }
        updateNetworkInfo()
        rtspStream.setFpsListener { fps ->
            if (_streamState.value == StreamState.STREAMING) {
                _streamStats.value = _streamStats.value.copy(measuredFps = fps)
            }
        }
        startLocationUpdates()
    }

    private fun prepareEncoders(): Boolean {
        val videoPrepared = if (rtspStream.isOnPreview) {
            true
        } else {
            try {
                val ok = rtspStream.prepareVideo(width = 1920, height = 1080, bitrate = 6_000_000)
                if (ok) _streamStats.value = _streamStats.value.copy(resolution = "1080p", codec = "H.264")
                ok
            } catch (e: Exception) {
                try {
                    val ok = rtspStream.prepareVideo(width = 1280, height = 720, bitrate = 3_000_000)
                    if (ok) _streamStats.value = _streamStats.value.copy(resolution = "720p", codec = "H.264")
                    ok
                } catch (ex: Exception) {
                    try {
                        val ok = rtspStream.prepareVideo(width = 640, height = 480, bitrate = 1_200_000)
                        if (ok) _streamStats.value = _streamStats.value.copy(resolution = "480p", codec = "H.264")
                        ok
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
            StreamState.CONNECTING -> return
            StreamState.RECONNECTING -> stopStream()
            StreamState.IDLE, StreamState.ERROR -> startStreamSequence()
            StreamState.STREAMING -> stopStream()
        }
    }

    private fun startStreamSequence(isAutomaticReconnect: Boolean = false) {
        if (!isPrepared) {
            isPrepared = prepareEncoders()
        }
        if (!isPrepared) {
            _streamState.value = StreamState.ERROR
            return
        }

        if (!isAutomaticReconnect) {
            userRequestedStop = false
            reconnectStartTime = null
            reconnectJob?.cancel()
            reconnectJob = null
        }

        if (rtspStream.isStreaming) {
            try {
                rtspStream.stopStream()
            } catch (_: Exception) {}
        }

        _streamState.value = StreamState.CONNECTING
        val url = _rtspConfig.value.fullUrl
        startLocationUpdates()
        android.util.Log.i("RAAHI_RTSP_STREAM", "Connecting to configured RTSP destination: $url (autoReconnect=$isAutomaticReconnect)")
        try {
            rtspStream.startStream(url)
        } catch (e: Exception) {
            android.util.Log.e("RAAHI_RTSP_STREAM", "Failed to start stream to $url", e)
            if (!userRequestedStop) {
                scheduleReconnect()
            } else {
                _streamState.value = StreamState.ERROR
            }
        }
    }

    private fun stopStream() {
        userRequestedStop = true
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectStartTime = null
        stopSessionTimer()
        _streamStats.value = _streamStats.value.copy(measuredFps = 0, measuredBitrateBps = 0L, bitrateFormatted = "--")
        stopLocationUpdates()
        if (rtspStream.isStreaming) {
            try {
                rtspStream.stopStream()
            } catch (_: Exception) {}
        }
        _streamState.value = StreamState.IDLE
    }

    private fun scheduleReconnect() {
        if (userRequestedStop) {
            android.util.Log.i("RAAHI_RTSP_STREAM", "Ignoring reconnect because user requested stop")
            return
        }

        // Prevent multiple simultaneous reconnect jobs for the same outage
        if (reconnectJob?.isActive == true) {
            android.util.Log.d("RAAHI_RTSP_STREAM", "Reconnect job already active, skipping duplicate schedule")
            return
        }

        val now = SystemClock.elapsedRealtime()
        val startTime = reconnectStartTime ?: now.also { reconnectStartTime = it }
        val elapsed = now - startTime

        if (elapsed >= RECONNECT_WINDOW_MS) {
            android.util.Log.w("RAAHI_RTSP_STREAM", "Automatic reconnect window of 15 minutes expired (${elapsed / 1000}s elapsed). Transitioning to ERROR.")
            reconnectStartTime = null
            reconnectJob = null
            stopSessionTimer()
            _streamStats.value = _streamStats.value.copy(measuredFps = 0, measuredBitrateBps = 0L, bitrateFormatted = "--")
            _streamState.value = StreamState.ERROR
            return
        }

        _streamState.value = StreamState.RECONNECTING
        reconnectJob = viewModelScope.launch {
            val elapsedSec = (SystemClock.elapsedRealtime() - startTime) / 1000
            val remainingSec = (RECONNECT_WINDOW_MS - (SystemClock.elapsedRealtime() - startTime)) / 1000
            android.util.Log.i("RAAHI_RTSP_STREAM", "Waiting ${RECONNECT_DELAY_MS}ms before reconnect attempt (Elapsed: ${elapsedSec}s, Remaining: ${remainingSec}s)")
            delay(RECONNECT_DELAY_MS)

            if (!isActive || userRequestedStop) {
                return@launch
            }

            val currentElapsed = SystemClock.elapsedRealtime() - startTime
            if (currentElapsed >= RECONNECT_WINDOW_MS) {
                android.util.Log.w("RAAHI_RTSP_STREAM", "15-minute reconnect window elapsed during delay. Transitioning to ERROR.")
                reconnectStartTime = null
                reconnectJob = null
                stopSessionTimer()
                _streamStats.value = _streamStats.value.copy(measuredFps = 0, measuredBitrateBps = 0L, bitrateFormatted = "--")
                _streamState.value = StreamState.ERROR
                return@launch
            }

            reconnectJob = null
            startStreamSequence(isAutomaticReconnect = true)
        }
    }

    // --- ConnectChecker Callbacks ---
    override fun onConnectionStarted(url: String) {
        _streamState.value = StreamState.CONNECTING
    }

    override fun onConnectionSuccess() {
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectStartTime = null
        userRequestedStop = false
        _streamState.value = StreamState.STREAMING
        startSessionTimer()
    }

    override fun onConnectionFailed(reason: String) {
        android.util.Log.w("RAAHI_RTSP_STREAM", "Connection failed: $reason")
        try {
            rtspStream.stopStream()
        } catch (_: Exception) {}

        if (!userRequestedStop) {
            scheduleReconnect()
        } else {
            _streamState.value = StreamState.ERROR
        }
    }

    override fun onNewBitrate(bitrate: Long) {
        val formatted = when {
            bitrate <= 0L -> "--"
            bitrate >= 1_000_000L -> String.format(Locale.US, "%.1f Mbps", bitrate / 1_000_000.0)
            else -> String.format(Locale.US, "%d Kbps", bitrate / 1000)
        }
        _streamStats.value = _streamStats.value.copy(measuredBitrateBps = bitrate, bitrateFormatted = formatted)
    }

    override fun onDisconnect() {
        android.util.Log.i("RAAHI_RTSP_STREAM", "RTSP stream disconnected")
        if (userRequestedStop) {
            _streamState.value = StreamState.IDLE
        } else if (_streamState.value == StreamState.STREAMING) {
            // Unexpected disconnect from server side without a prior onConnectionFailed
            scheduleReconnect()
        }
    }

    override fun onAuthError() {
        try {
            rtspStream.stopStream()
        } catch (_: Exception) {}
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectStartTime = null
        stopSessionTimer()
        _streamStats.value = _streamStats.value.copy(measuredFps = 0, measuredBitrateBps = 0L, bitrateFormatted = "--")
        _streamState.value = StreamState.ERROR
    }

    override fun onAuthSuccess() {}

    override fun onCleared() {
        super.onCleared()
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectStartTime = null
        stopSessionTimer()
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (_: Exception) {}
        stopLocationUpdates()
        stopStream()
        detachPreview()
    }
}