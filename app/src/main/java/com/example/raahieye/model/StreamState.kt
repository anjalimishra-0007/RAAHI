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

data class NetworkInfo(
    val isConnected: Boolean = false,
    val type: String = "Unknown",
    val localIp: String = "0.0.0.0"
)