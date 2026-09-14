package com.example.raahieye.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

import com.example.raahieye.model.AppThemeMode

private val DarkColorScheme = darkColorScheme(
    primary = PastelBlue,
    secondary = PastelGreen,
    tertiary = PastelRed,
    background = Color(0xFF121214),
    surface = DarkSurface,
    onPrimary = PureWhite,
    onSecondary = PureWhite,
    onTertiary = PureWhite,
    onBackground = PureWhite,
    onSurface = PureWhite
)

private val OledColorScheme = darkColorScheme(
    primary = PastelBlue,
    secondary = PastelGreen,
    tertiary = PastelRed,
    background = Color.Black,
    surface = Color(0xFF0E0E10),
    onPrimary = PureWhite,
    onSecondary = PureWhite,
    onTertiary = PureWhite,
    onBackground = PureWhite,
    onSurface = PureWhite
)

private val LightColorScheme = lightColorScheme(
    primary = PastelBlue,
    secondary = PastelGreen,
    tertiary = PastelRed,
    background = LightSurface,
    surface = PureWhite,
    onPrimary = Color.Black,
    onSecondary = Color.Black,
    onTertiary = Color.Black,
    onBackground = Color.Black,
    onSurface = Color.Black
)

@Composable
fun RAAHIEyeTheme(
    themeMode: AppThemeMode = AppThemeMode.OLED,
    content: @Composable () -> Unit
) {
    val colorScheme = when (themeMode) {
        AppThemeMode.LIGHT -> LightColorScheme
        AppThemeMode.DARK -> DarkColorScheme
        AppThemeMode.OLED -> OledColorScheme
    }
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            val isLight = themeMode == AppThemeMode.LIGHT
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = isLight
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}