package com.example.raahieye.model

enum class StreamState {
    IDLE,
    CONNECTING,
    STREAMING,
    RECONNECTING,
    ERROR
}

data class GpsData(
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val accuracyMeters: Float = 0f,
    val isAvailable: Boolean = false,
    val timestamp: String = ""
)

enum class AppThemeMode {
    LIGHT,
    DARK,
    OLED
}

enum class AppIconMode {
    AUTOMATIC,
    MANUAL
}

enum class AppIconChoice {
    LIGHT,
    DARK,
    OLED
}

data class StreamStats(
    val measuredFps: Int = 0,
    val measuredBitrateBps: Long = 0L,
    val codec: String = "H.264",
    val resolution: String = "1080p",
    val bitrateFormatted: String = "--"
)

data class NetworkInfo(
    val isConnected: Boolean = false,
    val type: String = "Not connected",
    val localIp: String = "—"
)