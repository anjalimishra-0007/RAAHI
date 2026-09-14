package com.example.raahieye.util

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.example.raahieye.model.AppIconChoice
import com.example.raahieye.model.AppIconMode
import com.example.raahieye.model.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
            Log.d("BootReceiver", "Device rebooted, synchronizing app launcher icon")
            val pendingResult = goAsync()
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val settingsRepo = SettingsRepository(context.applicationContext, false)
                    val mode = settingsRepo.appIconModeFlow.first()
                    val manualChoice = settingsRepo.appIconManualChoiceFlow.first()
                    AppIconManager.applyAppIcon(context.applicationContext, mode, manualChoice)
                } catch (e: Exception) {
                    Log.e("BootReceiver", "Failed to sync icon on boot: ${e.message}", e)
                } finally {
                    pendingResult.finish()
                }
            }
        }
    }
}
