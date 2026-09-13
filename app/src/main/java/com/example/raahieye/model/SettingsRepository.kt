package com.example.raahieye.model

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "raahi_eye_settings")

class SettingsRepository(private val context: Context, private val isEmulator: Boolean) {

    private object PreferencesKeys {
        val EDGE_HOST = stringPreferencesKey("edge_host")
        val EDGE_PORT = intPreferencesKey("edge_port")
        val EDGE_PATH = stringPreferencesKey("edge_path")
    }

    val defaultHost: String = if (isEmulator) "10.0.2.2" else "127.0.0.1"
    val defaultPort: Int = 8555
    val defaultPath: String = "live"

    val defaultRtspConfig: RtspConfig = RtspConfig(
        host = defaultHost,
        port = defaultPort,
        path = defaultPath
    )

    val rtspConfigFlow: Flow<RtspConfig> = context.dataStore.data.map { preferences ->
        val host = preferences[PreferencesKeys.EDGE_HOST] ?: defaultHost
        val port = preferences[PreferencesKeys.EDGE_PORT] ?: defaultPort
        val path = preferences[PreferencesKeys.EDGE_PATH] ?: defaultPath
        RtspConfig(host = host, port = port, path = path)
    }

    suspend fun saveRtspConfig(config: RtspConfig) {
        context.dataStore.edit { preferences ->
            preferences[PreferencesKeys.EDGE_HOST] = config.host.trim().removePrefix("rtsp://").trimEnd('/')
            preferences[PreferencesKeys.EDGE_PORT] = config.port
            preferences[PreferencesKeys.EDGE_PATH] = config.path.trim().trim('/')
        }
    }

    suspend fun resetToDefault() {
        saveRtspConfig(defaultRtspConfig)
    }
}
