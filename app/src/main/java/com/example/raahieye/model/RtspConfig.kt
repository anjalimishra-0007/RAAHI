package com.example.raahieye.model

data class RtspConfig(
    val host: String = "127.0.0.1",
    val port: Int = 8555,
    val path: String = "live"
) {
    val fullUrl: String
        get() = buildRtspUrl(host, port, path)

    companion object {
        fun buildRtspUrl(host: String, port: Int, path: String): String {
            val cleanHost = host.trim().removePrefix("rtsp://").trimEnd('/')
            val cleanPath = path.trim().trim('/')
            return if (cleanPath.isEmpty()) {
                "rtsp://$cleanHost:$port"
            } else {
                "rtsp://$cleanHost:$port/$cleanPath"
            }
        }

        fun isValidHost(host: String): Boolean {
            val cleanHost = host.trim().removePrefix("rtsp://").trimEnd('/')
            return cleanHost.isNotEmpty() && !cleanHost.contains(" ") && !cleanHost.contains("/")
        }

        fun isValidPort(port: Int): Boolean {
            return port in 1..65535
        }
    }
}
