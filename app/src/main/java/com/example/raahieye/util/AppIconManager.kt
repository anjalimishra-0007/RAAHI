package com.example.raahieye.util

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.util.Log
import com.example.raahieye.model.AppIconChoice
import com.example.raahieye.model.AppIconMode

object AppIconManager {
    private const val TAG = "AppIconManager"

    const val ALIAS_LIGHT = "com.example.raahieye.MainActivityLight"
    const val ALIAS_DARK = "com.example.raahieye.MainActivityDark"
    const val ALIAS_OLED = "com.example.raahieye.MainActivityOled"

    val ALL_ALIASES = listOf(ALIAS_LIGHT, ALIAS_DARK, ALIAS_OLED)

    fun isSystemDarkTheme(context: Context): Boolean {
        val uiMode = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return uiMode == Configuration.UI_MODE_NIGHT_YES
    }

    fun getTargetAlias(context: Context, mode: AppIconMode, manualChoice: AppIconChoice): String {
        return when (mode) {
            AppIconMode.AUTOMATIC -> {
                // In Automatic mode: Light when system is light, OLED when system is dark.
                // Dark icon is strictly NOT used in Automatic mode.
                if (isSystemDarkTheme(context)) ALIAS_OLED else ALIAS_LIGHT
            }
            AppIconMode.MANUAL -> {
                when (manualChoice) {
                    AppIconChoice.LIGHT -> ALIAS_LIGHT
                    AppIconChoice.DARK -> ALIAS_DARK
                    AppIconChoice.OLED -> ALIAS_OLED
                }
            }
        }
    }

    fun applyAppIcon(context: Context, mode: AppIconMode, manualChoice: AppIconChoice) {
        val targetAlias = getTargetAlias(context, mode, manualChoice)
        val pm = context.packageManager
        val packageName = context.packageName

        Log.i(TAG, "applyAppIcon: mode=$mode, manualChoice=$manualChoice, targetAlias=$targetAlias")

        try {
            // 1. Enable target component first so there is never a state with 0 launcher icons
            val targetComponent = ComponentName(packageName, targetAlias)
            val currentState = pm.getComponentEnabledSetting(targetComponent)
            if (currentState != PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                pm.setComponentEnabledSetting(
                    targetComponent,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP
                )
                Log.d(TAG, "Enabled alias: $targetAlias")
            }

            // 2. Disable non-target aliases
            for (alias in ALL_ALIASES) {
                if (alias != targetAlias) {
                    val comp = ComponentName(packageName, alias)
                    val state = pm.getComponentEnabledSetting(comp)
                    if (state != PackageManager.COMPONENT_ENABLED_STATE_DISABLED) {
                        pm.setComponentEnabledSetting(
                            comp,
                            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                            PackageManager.DONT_KILL_APP
                        )
                        Log.d(TAG, "Disabled alias: $alias")
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error applying app icon alias: ${e.message}", e)
        }
    }

    fun getCurrentlyEnabledAlias(context: Context): String {
        val pm = context.packageManager
        val packageName = context.packageName
        for (alias in ALL_ALIASES) {
            val comp = ComponentName(packageName, alias)
            val state = pm.getComponentEnabledSetting(comp)
            if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                return alias
            }
        }
        return ALIAS_OLED // Default fallback
    }
}
