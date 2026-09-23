package com.example.raahieye.ui

import android.content.res.Configuration
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.raahieye.R
import com.example.raahieye.model.AppIconChoice
import com.example.raahieye.model.AppIconMode
import com.example.raahieye.model.AppThemeMode
import com.example.raahieye.model.GpsData
import com.example.raahieye.model.NetworkInfo
import com.example.raahieye.model.StreamState
import com.example.raahieye.model.StreamStats
import com.example.raahieye.util.AppIconManager
import com.example.raahieye.viewmodel.RaahiViewModel
import java.util.Locale

@Composable
fun DashboardScreen(viewModel: RaahiViewModel = viewModel()) {
    val streamState by viewModel.streamState.collectAsState()
    val gpsData by viewModel.gpsData.collectAsState()
    val networkInfo by viewModel.networkInfo.collectAsState()
    val busId by viewModel.busId.collectAsState()
    val streamDuration by viewModel.streamDuration.collectAsState()
    val streamStats by viewModel.streamStats.collectAsState()
    val themeMode by viewModel.themeMode.collectAsState()
    val appIconMode by viewModel.appIconMode.collectAsState()
    val appIconManualChoice by viewModel.appIconManualChoice.collectAsState()

    var showSettingsDialog by remember { mutableStateOf(false) }
    var showThemeDialog by remember { mutableStateOf(false) }

    val isDark = themeMode != AppThemeMode.LIGHT

    // Smooth theme color interpolation
    val targetBgColor = when (themeMode) {
        AppThemeMode.LIGHT -> Color(0xFFF2F4F7)
        AppThemeMode.DARK -> Color(0xFF121214)
        AppThemeMode.OLED -> Color(0xFF000000)
    }
    val targetCardBgColor = when (themeMode) {
        AppThemeMode.LIGHT -> Color.White
        AppThemeMode.DARK -> Color(0xFF1C1C1E)
        AppThemeMode.OLED -> Color(0xFF0E0E10)
    }
    val targetCardBorderColor = when (themeMode) {
        AppThemeMode.LIGHT -> Color.Black.copy(alpha = 0.05f)
        AppThemeMode.DARK -> Color.White.copy(alpha = 0.08f)
        AppThemeMode.OLED -> Color.White.copy(alpha = 0.12f)
    }
    val targetTextPrimary = when (themeMode) {
        AppThemeMode.LIGHT -> Color(0xFF1A1A1A)
        else -> Color.White
    }
    val targetTextSecondary = when (themeMode) {
        AppThemeMode.LIGHT -> Color(0xFF8E8E93)
        AppThemeMode.DARK -> Color(0xFFA0A0A5)
        AppThemeMode.OLED -> Color(0xFF8E8E93)
    }

    val bgColor by animateColorAsState(targetBgColor, animationSpec = tween(300), label = "bgColor")
    val cardBgColor by animateColorAsState(targetCardBgColor, animationSpec = tween(300), label = "cardBgColor")
    val cardBorderColor by animateColorAsState(targetCardBorderColor, animationSpec = tween(300), label = "cardBorderColor")
    val textPrimary by animateColorAsState(targetTextPrimary, animationSpec = tween(300), label = "textPrimary")
    val textSecondary by animateColorAsState(targetTextSecondary, animationSpec = tween(300), label = "textSecondary")

    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val context = LocalContext.current

    LaunchedEffect(configuration.orientation) {
        val rotation = (context as? android.app.Activity)?.display?.rotation
            ?: (context.getSystemService(android.view.WindowManager::class.java))?.defaultDisplay?.rotation
            ?: android.view.Surface.ROTATION_0
        viewModel.updateOrientation(rotation)
    }

    if (isLandscape) {
        LandscapeDashboard(
            streamState = streamState,
            gpsData = gpsData,
            networkInfo = networkInfo,
            busId = busId,
            streamDuration = streamDuration,
            streamStats = streamStats,
            themeMode = themeMode,
            isDark = isDark,
            bgColor = bgColor,
            cardBgColor = cardBgColor,
            cardBorderColor = cardBorderColor,
            textPrimary = textPrimary,
            textSecondary = textSecondary,
            onSettingsClick = { showSettingsDialog = true },
            onThemeClick = { showThemeDialog = true },
            onThemeDoubleClick = { viewModel.cycleThemeMode() },
            onToggleStream = { viewModel.toggleStream() }
        )
    } else {
        PortraitDashboard(
            streamState = streamState,
            gpsData = gpsData,
            networkInfo = networkInfo,
            busId = busId,
            streamDuration = streamDuration,
            streamStats = streamStats,
            themeMode = themeMode,
            isDark = isDark,
            bgColor = bgColor,
            cardBgColor = cardBgColor,
            cardBorderColor = cardBorderColor,
            textPrimary = textPrimary,
            textSecondary = textSecondary,
            onSettingsClick = { showSettingsDialog = true },
            onThemeClick = { showThemeDialog = true },
            onThemeDoubleClick = { viewModel.cycleThemeMode() },
            onToggleStream = { viewModel.toggleStream() }
        )
    }

    if (showSettingsDialog) {
        SettingsDialog(
            viewModel = viewModel,
            isDark = isDark,
            onDismiss = { showSettingsDialog = false }
        )
    }

    if (showThemeDialog) {
        ThemeSelectionSheet(
            currentTheme = themeMode,
            appIconMode = appIconMode,
            appIconManualChoice = appIconManualChoice,
            isDark = isDark,
            onThemeSelect = { selected -> viewModel.setThemeMode(selected) },
            onAppIconModeSelect = { mode -> viewModel.setAppIconMode(mode) },
            onAppIconChoiceSelect = { choice -> viewModel.setAppIconManualChoice(choice) },
            onDismiss = { showThemeDialog = false }
        )
    }
}

@Composable
fun LandscapeDashboard(
    streamState: StreamState,
    gpsData: GpsData,
    networkInfo: NetworkInfo,
    busId: String,
    streamDuration: String,
    streamStats: StreamStats,
    themeMode: AppThemeMode,
    isDark: Boolean,
    bgColor: Color,
    cardBgColor: Color,
    cardBorderColor: Color,
    textPrimary: Color,
    textSecondary: Color,
    onSettingsClick: () -> Unit,
    onThemeClick: () -> Unit,
    onThemeDoubleClick: () -> Unit,
    onToggleStream: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(bgColor)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Left Panel: Camera (56% width)
        Box(
            modifier = Modifier.weight(0.56f).fillMaxHeight(),
            contentAlignment = Alignment.Center
        ) {
            CameraContainer(
                streamState = streamState,
                streamDuration = streamDuration,
                streamStats = streamStats,
                modifier = Modifier.fillMaxWidth()
            )
        }

        // Right Panel: Telemetry & Controls (44% width)
        Column(
            modifier = Modifier
                .weight(0.44f)
                .fillMaxHeight()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            HeaderSection(
                isConnected = networkInfo.isConnected,
                themeMode = themeMode,
                textPrimary = textPrimary,
                textSecondary = textSecondary,
                bg = cardBgColor,
                border = cardBorderColor,
                showThemeButton = true,
                onThemeClick = onThemeClick,
                onThemeDoubleClick = onThemeDoubleClick,
                onSettingsClick = onSettingsClick
            )

            // 1. Bus ID + GPS
            Row(
                modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                DashboardCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "Bus ID",
                    value = busId,
                    subValue = "",
                    icon = Icons.Rounded.DirectionsBus,
                    iconTint = Color(0xFF5E5CE6),
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
                val gpsStatus = if (gpsData.isAvailable) "Active • ±${"%.1f".format(Locale.US, gpsData.accuracyMeters)}m" else "Searching..."
                val gpsSub = if (gpsData.isAvailable) "${"%.5f".format(Locale.US, gpsData.latitude)}, ${"%.5f".format(Locale.US, gpsData.longitude)}" else "—"
                DashboardCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "GPS",
                    value = gpsStatus,
                    subValue = gpsSub,
                    icon = Icons.Rounded.LocationOn,
                    iconTint = Color(0xFF34C759),
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
            }

            // 2. Camera / Connection / Network status
            Row(
                modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val camStatus = if (streamState == StreamState.STREAMING) "Streaming" else "Idle"
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "Camera",
                    value = camStatus,
                    subValue = streamStats.resolution,
                    icon = Icons.Rounded.CameraAlt,
                    iconTint = Color(0xFFAF52DE),
                    isGood = streamState == StreamState.STREAMING,
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
                val connStatus = when (streamState) {
                    StreamState.STREAMING -> "Connected"
                    StreamState.CONNECTING -> "Connecting..."
                    StreamState.RECONNECTING -> "Retrying..."
                    StreamState.ERROR -> "Error"
                    else -> "Offline"
                }
                val connGood = streamState == StreamState.STREAMING
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "RTSP",
                    value = connStatus,
                    subValue = if (connGood) "Live" else "—",
                    icon = Icons.Rounded.Sensors,
                    iconTint = Color(0xFFFF2D55),
                    isGood = connGood,
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
                val netIcon = when (networkInfo.type) {
                    "Wi-Fi" -> Icons.Rounded.Wifi
                    "Cellular" -> Icons.Rounded.SignalCellularAlt
                    "Hotspot" -> Icons.Rounded.WifiTethering
                    "USB" -> Icons.Rounded.Usb
                    else -> Icons.Rounded.SignalCellularConnectedNoInternet0Bar
                }
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "Network",
                    value = networkInfo.type,
                    subValue = networkInfo.localIp,
                    icon = netIcon,
                    iconTint = Color(0xFFFF9F0A),
                    isGood = networkInfo.isConnected,
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
            }

            // 3. Real Stream Telemetry Stats
            StreamStatsCard(
                streamState = streamState,
                streamStats = streamStats,
                bg = cardBgColor,
                border = cardBorderColor,
                textPrimary = textPrimary,
                textSecondary = textSecondary
            )

            // 4. Start/Stop Stream Button
            PrimaryStreamButton(streamState, height = 44.dp, onClick = onToggleStream)
        }
    }
}

@Composable
fun PortraitDashboard(
    streamState: StreamState,
    gpsData: GpsData,
    networkInfo: NetworkInfo,
    busId: String,
    streamDuration: String,
    streamStats: StreamStats,
    themeMode: AppThemeMode,
    isDark: Boolean,
    bgColor: Color,
    cardBgColor: Color,
    cardBorderColor: Color,
    textPrimary: Color,
    textSecondary: Color,
    onSettingsClick: () -> Unit,
    onThemeClick: () -> Unit,
    onThemeDoubleClick: () -> Unit,
    onToggleStream: () -> Unit
) {
    Scaffold(
        bottomBar = {
            BottomNavBar(
                themeMode = themeMode,
                isDark = isDark,
                bgColor = bgColor,
                borderColor = cardBorderColor,
                onThemeClick = onThemeClick,
                onThemeDoubleClick = onThemeDoubleClick,
                onSettingsClick = onSettingsClick
            )
        },
        containerColor = bgColor
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            HeaderSection(
                isConnected = networkInfo.isConnected,
                themeMode = themeMode,
                textPrimary = textPrimary,
                textSecondary = textSecondary,
                bg = cardBgColor,
                border = cardBorderColor,
                showThemeButton = false,
                onThemeClick = onThemeClick,
                onThemeDoubleClick = onThemeDoubleClick,
                onSettingsClick = onSettingsClick
            )

            // Camera Container with Real Stream Duration and Dynamic Stats
            CameraContainer(
                streamState = streamState,
                streamDuration = streamDuration,
                streamStats = streamStats,
                modifier = Modifier.fillMaxWidth()
            )

            // Bus ID & GPS Cards (Full legibility, responsive, no clipping)
            Row(
                modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                DashboardCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "Bus ID",
                    value = busId,
                    subValue = "",
                    icon = Icons.Rounded.DirectionsBus,
                    iconTint = Color(0xFF5E5CE6),
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
                val gpsStatus = if (gpsData.isAvailable) "Active • ±${"%.1f".format(Locale.US, gpsData.accuracyMeters)}m" else "Searching..."
                val gpsSub = if (gpsData.isAvailable) "${"%.5f".format(Locale.US, gpsData.latitude)}, ${"%.5f".format(Locale.US, gpsData.longitude)}" else "—"
                DashboardCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "GPS",
                    value = gpsStatus,
                    subValue = gpsSub,
                    icon = Icons.Rounded.LocationOn,
                    iconTint = Color(0xFF34C759),
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
            }

            // Camera, RTSP, Network status cards
            Row(
                modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val camStatus = if (streamState == StreamState.STREAMING) "Streaming" else "Idle"
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "Camera",
                    value = camStatus,
                    subValue = streamStats.resolution,
                    icon = Icons.Rounded.CameraAlt,
                    iconTint = Color(0xFFAF52DE),
                    isGood = streamState == StreamState.STREAMING,
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
                val connStatus = when (streamState) {
                    StreamState.STREAMING -> "Connected"
                    StreamState.CONNECTING -> "Connecting..."
                    StreamState.RECONNECTING -> "Retrying..."
                    StreamState.ERROR -> "Error"
                    else -> "Offline"
                }
                val connGood = streamState == StreamState.STREAMING
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "RTSP",
                    value = connStatus,
                    subValue = if (connGood) "Live" else "—",
                    icon = Icons.Rounded.Sensors,
                    iconTint = Color(0xFFFF2D55),
                    isGood = connGood,
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
                val netIcon = when (networkInfo.type) {
                    "Wi-Fi" -> Icons.Rounded.Wifi
                    "Cellular" -> Icons.Rounded.SignalCellularAlt
                    "Hotspot" -> Icons.Rounded.WifiTethering
                    "USB" -> Icons.Rounded.Usb
                    else -> Icons.Rounded.SignalCellularConnectedNoInternet0Bar
                }
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    title = "Network",
                    value = networkInfo.type,
                    subValue = networkInfo.localIp,
                    icon = netIcon,
                    iconTint = Color(0xFFFF9F0A),
                    isGood = networkInfo.isConnected,
                    bg = cardBgColor,
                    border = cardBorderColor,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary
                )
            }

            // Real Stream Telemetry Stats
            StreamStatsCard(
                streamState = streamState,
                streamStats = streamStats,
                bg = cardBgColor,
                border = cardBorderColor,
                textPrimary = textPrimary,
                textSecondary = textSecondary
            )

            Spacer(modifier = Modifier.height(4.dp))
            PrimaryStreamButton(streamState, onClick = onToggleStream)
            Spacer(modifier = Modifier.height(8.dp))
        }
    }
}

// -------------------------------------------------------------------------
// REUSABLE COMPONENTS
// -------------------------------------------------------------------------

@Composable
fun HeaderSection(
    isConnected: Boolean,
    themeMode: AppThemeMode,
    textPrimary: Color,
    textSecondary: Color,
    bg: Color,
    border: Color,
    showThemeButton: Boolean = false,
    onThemeClick: () -> Unit = {},
    onThemeDoubleClick: () -> Unit = {},
    onSettingsClick: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically
        ) {
            AnimatedContent(
                targetState = themeMode,
                transitionSpec = {
                    fadeIn(animationSpec = tween(durationMillis = 220, easing = LinearEasing)) togetherWith
                            fadeOut(animationSpec = tween(durationMillis = 220, easing = LinearEasing))
                },
                label = "HeaderLogoCrossfade"
            ) { targetTheme ->
                val logoRes = when (targetTheme) {
                    AppThemeMode.LIGHT -> R.drawable.raahi_logo_light
                    AppThemeMode.DARK -> R.drawable.raahi_logo_dark
                    AppThemeMode.OLED -> R.drawable.raahi_logo_oled
                }
                Image(
                    painter = painterResource(id = logoRes),
                    contentDescription = "RAAHI Logo",
                    modifier = Modifier.size(38.dp),
                    contentScale = ContentScale.Fit
                )
            }

            Spacer(modifier = Modifier.width(10.dp))

            Column {
                Text("RAAHI", fontSize = 24.sp, fontWeight = FontWeight.Black, color = textPrimary, letterSpacing = 1.sp)
                Text("Safer Roads. Brighter Journeys.", fontSize = 11.sp, color = textSecondary, fontWeight = FontWeight.Medium)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Online/Offline network status pill
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (isConnected) Color(0xFF34C759).copy(alpha = 0.12f) else Color(0xFFFF3B30).copy(alpha = 0.12f))
                    .border(1.dp, if (isConnected) Color(0xFF34C759).copy(alpha = 0.25f) else Color(0xFFFF3B30).copy(alpha = 0.25f), RoundedCornerShape(16.dp))
                    .padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(if (isConnected) Color(0xFF34C759) else Color(0xFFFF3B30)))
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = if (isConnected) "Online" else "Offline",
                    color = if (isConnected) Color(0xFF34C759) else Color(0xFFFF3B30),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            if (showThemeButton) {
                val themeIcon = when (themeMode) {
                    AppThemeMode.LIGHT -> Icons.Rounded.LightMode
                    AppThemeMode.DARK -> Icons.Rounded.DarkMode
                    AppThemeMode.OLED -> Icons.Rounded.Contrast
                }
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(bg)
                        .border(1.dp, border, CircleShape)
                        .pointerInput(Unit) {
                            detectTapGestures(
                                onTap = { onThemeClick() },
                                onDoubleTap = { onThemeDoubleClick() }
                            )
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(themeIcon, contentDescription = "Theme", tint = textPrimary, modifier = Modifier.size(18.dp))
                }
            }

            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(bg)
                    .border(1.dp, border, CircleShape)
                    .clickable { onSettingsClick() },
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Rounded.Settings, contentDescription = "Settings", tint = textPrimary, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
fun CameraContainer(
    streamState: StreamState,
    streamDuration: String,
    streamStats: StreamStats,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(24.dp))
            .background(Color.Black)
            .border(1.dp, Color.White.copy(alpha = 0.1f), RoundedCornerShape(24.dp))
    ) {
        CameraPreview()

        Row(
            modifier = Modifier.padding(12.dp).align(Alignment.TopStart),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (streamState == StreamState.STREAMING) {
                val infiniteTransition = rememberInfiniteTransition(label = "live_pulse")
                val alpha by infiniteTransition.animateFloat(
                    initialValue = 1f, targetValue = 0.25f,
                    animationSpec = infiniteRepeatable(animation = tween(800), repeatMode = RepeatMode.Reverse),
                    label = "live_alpha"
                )
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFFFF2D55))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(Color.White.copy(alpha = alpha)))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("LIVE", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            } else if (streamState == StreamState.RECONNECTING) {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFFFF9F0A))
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(Color.White))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("RETRYING", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                }
            }

            // Real Session Stream Duration (HH:MM:SS)
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.Black.copy(alpha = 0.65f))
                    .padding(horizontal = 10.dp, vertical = 4.dp)
            ) {
                Text(
                    text = if (streamState == StreamState.STREAMING || streamState == StreamState.RECONNECTING) streamDuration else "--:--:--",
                    color = Color.White,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Medium
                )
            }
        }

        // Top right real resolution and measured FPS
        Box(
            modifier = Modifier
                .padding(12.dp)
                .align(Alignment.TopEnd)
                .clip(RoundedCornerShape(12.dp))
                .background(Color.Black.copy(alpha = 0.65f))
                .padding(horizontal = 10.dp, vertical = 4.dp)
        ) {
            val statsLabel = if (streamState == StreamState.STREAMING) {
                "${streamStats.resolution} • ${streamStats.measuredFps} FPS"
            } else {
                "${streamStats.resolution} • Ready"
            }
            Text(statsLabel, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        }

        Row(
            modifier = Modifier.padding(12.dp).align(Alignment.BottomStart),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier.size(32.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Rounded.Videocam, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
            }
            Spacer(modifier = Modifier.width(8.dp))
            Column {
                Text("Rear Camera", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text("Wide • 1.0x", color = Color.White.copy(alpha = 0.7f), fontSize = 10.sp, maxLines = 1)
            }
        }

        Box(
            modifier = Modifier
                .padding(12.dp)
                .align(Alignment.BottomEnd)
                .size(32.dp)
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.6f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Rounded.Fullscreen, contentDescription = "Expand", tint = Color.White, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
fun DashboardCard(
    modifier: Modifier,
    title: String,
    value: String,
    subValue: String,
    icon: ImageVector,
    iconTint: Color,
    bg: Color,
    border: Color,
    textPrimary: Color,
    textSecondary: Color
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(20.dp))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(20.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(iconTint.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(18.dp))
        }
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            Text(
                text = value,
                color = textPrimary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Clip
            )
            if (subValue.isNotEmpty()) {
                Text(
                    text = subValue,
                    color = textSecondary,
                    fontSize = 9.sp,
                    maxLines = 1,
                    softWrap = false,
                    fontFamily = FontFamily.Monospace,
                    overflow = TextOverflow.Clip
                )
            }
        }
    }
}

@Composable
fun SmallStatusCard(
    modifier: Modifier,
    title: String,
    value: String,
    subValue: String,
    icon: ImageVector,
    iconTint: Color,
    isGood: Boolean,
    bg: Color,
    border: Color,
    textPrimary: Color,
    textSecondary: Color
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(16.dp))
            .padding(horizontal = 10.dp, vertical = 10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(iconTint.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(13.dp))
            }
            Spacer(modifier = Modifier.width(6.dp))
            Text(title, color = textSecondary, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = value,
            color = if (isGood) Color(0xFF34C759) else textPrimary,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        if (subValue.isNotEmpty()) {
            Text(
                text = subValue,
                color = textSecondary,
                fontSize = 9.sp,
                maxLines = 1,
                fontFamily = FontFamily.Monospace,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
fun StreamStatsCard(
    streamState: StreamState,
    streamStats: StreamStats,
    bg: Color,
    border: Color,
    textPrimary: Color,
    textSecondary: Color
) {
    val isStreaming = streamState == StreamState.STREAMING
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(20.dp))
            .padding(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 10.dp)) {
            Icon(Icons.Rounded.ShowChart, contentDescription = null, tint = Color(0xFF5E5CE6), modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Stream Stats", color = textPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = if (isStreaming) "LIVE TELEMETRY" else "CONFIGURED TARGETS",
                color = if (isStreaming) Color(0xFF34C759) else textSecondary.copy(alpha = 0.7f),
                fontSize = 9.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.5.sp
            )
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            StatItem(if (isStreaming) "${streamStats.measuredFps}" else "--", "FPS", textPrimary, textSecondary)
            StatItem(if (isStreaming) streamStats.bitrateFormatted else "--", "Bitrate", textPrimary, textSecondary)
            StatItem(streamStats.codec, "Codec", textPrimary, textSecondary)
            StatItem(streamStats.resolution, "Resolution", textPrimary, textSecondary)
        }
    }
}

@Composable
fun StatItem(value: String, label: String, textPrimary: Color, textSecondary: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Text(label, color = textSecondary, fontSize = 10.sp)
    }
}

@Composable
fun PrimaryStreamButton(
    streamState: StreamState,
    height: Dp = 56.dp,
    onClick: () -> Unit
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.96f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy),
        label = "btn_scale"
    )

    val gradient = when (streamState) {
        StreamState.STREAMING -> Brush.horizontalGradient(listOf(Color(0xFFFF453A), Color(0xFFFF2D55)))
        StreamState.CONNECTING -> Brush.horizontalGradient(listOf(Color(0xFFFF9F0A), Color(0xFFFFD60A)))
        StreamState.RECONNECTING -> Brush.horizontalGradient(listOf(Color(0xFFFF9F0A), Color(0xFFFF6961)))
        StreamState.ERROR -> Brush.horizontalGradient(listOf(Color(0xFF8E8E93), Color(0xFFA0A0A5)))
        else -> Brush.horizontalGradient(listOf(Color(0xFF0A84FF), Color(0xFF5E5CE6)))
    }

    val shadowColor = when (streamState) {
        StreamState.STREAMING -> Color(0xFFFF2D55).copy(alpha = 0.4f)
        StreamState.CONNECTING, StreamState.RECONNECTING -> Color(0xFFFF9F0A).copy(alpha = 0.4f)
        StreamState.ERROR -> Color.Transparent
        else -> Color(0xFF0A84FF).copy(alpha = 0.4f)
    }

    val buttonText = when (streamState) {
        StreamState.STREAMING -> "STOP STREAM"
        StreamState.CONNECTING -> "CONNECTING..."
        StreamState.RECONNECTING -> "RECONNECTING..."
        StreamState.ERROR -> "RETRY STREAM"
        else -> "START STREAM"
    }

    val icon = when (streamState) {
        StreamState.STREAMING -> Icons.Rounded.Stop
        StreamState.CONNECTING, StreamState.RECONNECTING -> Icons.Rounded.Sync
        StreamState.ERROR -> Icons.Rounded.Refresh
        else -> Icons.Rounded.PlayArrow
    }

    val cornerRadius = height / 2

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .scale(scale)
            .height(height)
            .shadow(12.dp, RoundedCornerShape(cornerRadius), spotColor = shadowColor)
            .clip(RoundedCornerShape(cornerRadius))
            .background(gradient)
            .clickable(interactionSource = interactionSource, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        AnimatedContent(
            targetState = Pair(buttonText, icon),
            transitionSpec = { fadeIn(tween(150)) togetherWith fadeOut(tween(150)) },
            label = "btn_content"
        ) { (text, ic) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(24.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.2f)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(ic, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                }
                Spacer(modifier = Modifier.width(10.dp))
                Text(text, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 1.sp)
            }
        }
    }
}

@Composable
fun BottomNavBar(
    themeMode: AppThemeMode,
    isDark: Boolean,
    bgColor: Color,
    borderColor: Color,
    onThemeClick: () -> Unit,
    onThemeDoubleClick: () -> Unit,
    onSettingsClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(bgColor.copy(alpha = 0.96f))
            .border(width = 1.dp, color = borderColor, shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
            .padding(vertical = 10.dp, horizontal = 32.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        BottomNavItem(
            icon = Icons.Rounded.Home,
            label = "Home",
            isSelected = true,
            isDark = isDark,
            onClick = {}
        )

        ThemeBottomNavItem(
            themeMode = themeMode,
            isDark = isDark,
            onClick = onThemeClick,
            onDoubleClick = onThemeDoubleClick
        )

        BottomNavItem(
            icon = Icons.Rounded.Settings,
            label = "Settings",
            isSelected = false,
            isDark = isDark,
            onClick = onSettingsClick
        )
    }
}

@Composable
fun BottomNavItem(
    icon: ImageVector,
    label: String,
    isSelected: Boolean,
    isDark: Boolean,
    onClick: () -> Unit = {}
) {
    val tint = if (isSelected) Color(0xFF5E5CE6) else if (isDark) Color.Gray else Color.LightGray
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 4.dp)
    ) {
        Icon(icon, contentDescription = label, tint = tint, modifier = Modifier.size(22.dp))
        Spacer(modifier = Modifier.height(4.dp))
        Text(label, color = tint, fontSize = 10.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium)
        if (isSelected) {
            Spacer(modifier = Modifier.height(4.dp))
            Box(modifier = Modifier.size(4.dp).clip(CircleShape).background(Color(0xFF5E5CE6)))
        }
    }
}

@Composable
fun ThemeBottomNavItem(
    themeMode: AppThemeMode,
    isDark: Boolean,
    onClick: () -> Unit,
    onDoubleClick: () -> Unit
) {
    val haptics = LocalHapticFeedback.current
    val tint = if (isDark) Color.LightGray else Color.DarkGray
    val themeIcon = when (themeMode) {
        AppThemeMode.LIGHT -> Icons.Rounded.LightMode
        AppThemeMode.DARK -> Icons.Rounded.DarkMode
        AppThemeMode.OLED -> Icons.Rounded.Contrast
    }
    val themeLabel = when (themeMode) {
        AppThemeMode.LIGHT -> "Light"
        AppThemeMode.DARK -> "Dark"
        AppThemeMode.OLED -> "OLED"
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { onClick() },
                    onDoubleTap = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        onDoubleClick()
                    }
                )
            }
            .padding(horizontal = 14.dp, vertical = 4.dp)
    ) {
        Icon(themeIcon, contentDescription = "Theme ($themeLabel)", tint = Color(0xFF5E5CE6), modifier = Modifier.size(22.dp))
        Spacer(modifier = Modifier.height(4.dp))
        Text("Theme", color = tint, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun ThemeSelectionSheet(
    currentTheme: AppThemeMode,
    appIconMode: AppIconMode,
    appIconManualChoice: AppIconChoice,
    isDark: Boolean,
    onThemeSelect: (AppThemeMode) -> Unit,
    onAppIconModeSelect: (AppIconMode) -> Unit,
    onAppIconChoiceSelect: (AppIconChoice) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val isSystemDark = remember(context) { AppIconManager.isSystemDarkTheme(context) }

    val dialogBg = if (isDark) Color(0xFF141416) else Color.White
    val cardBg = if (isDark) Color(0xFF1C1C1E) else Color(0xFFF2F4F7)
    val textPrimary = if (isDark) Color.White else Color(0xFF1A1A1A)
    val textSecondary = if (isDark) Color(0xFFA0A0A5) else Color(0xFF8E8E93)
    val accentColor = Color(0xFF5E5CE6)
    val borderColor = if (isDark) Color.White.copy(alpha = 0.08f) else Color.Black.copy(alpha = 0.06f)

    Dialog(onDismissRequest = onDismiss) {
        Card(
            modifier = Modifier
                .fillMaxWidth(0.94f)
                .heightIn(max = 680.dp)
                .clip(RoundedCornerShape(24.dp))
                .border(1.dp, borderColor, RoundedCornerShape(24.dp)),
            colors = CardDefaults.cardColors(containerColor = dialogBg)
        ) {
            Column(
                modifier = Modifier
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Appearance", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = textPrimary)
                        Text("Display theme & launcher app icon", fontSize = 11.sp, color = textSecondary)
                    }
                    IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Rounded.Close, contentDescription = "Close", tint = textSecondary)
                    }
                }

                HorizontalDivider(color = borderColor)

                // SECTION 1: APP THEME
                Text(
                    "APP THEME",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = textSecondary,
                    letterSpacing = 1.sp
                )

                ThemeOptionRow(
                    mode = AppThemeMode.LIGHT,
                    title = "Light",
                    description = "Clean high-visibility daytime",
                    icon = Icons.Rounded.LightMode,
                    isSelected = currentTheme == AppThemeMode.LIGHT,
                    cardBg = cardBg,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary,
                    accentColor = accentColor,
                    borderColor = borderColor,
                    onClick = { onThemeSelect(AppThemeMode.LIGHT) }
                )

                ThemeOptionRow(
                    mode = AppThemeMode.DARK,
                    title = "Dark",
                    description = "Balanced low-light contrast",
                    icon = Icons.Rounded.DarkMode,
                    isSelected = currentTheme == AppThemeMode.DARK,
                    cardBg = cardBg,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary,
                    accentColor = accentColor,
                    borderColor = borderColor,
                    onClick = { onThemeSelect(AppThemeMode.DARK) }
                )

                ThemeOptionRow(
                    mode = AppThemeMode.OLED,
                    title = "OLED",
                    description = "Pure black #000000 high-efficiency",
                    icon = Icons.Rounded.Contrast,
                    isSelected = currentTheme == AppThemeMode.OLED,
                    cardBg = cardBg,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary,
                    accentColor = accentColor,
                    borderColor = borderColor,
                    onClick = { onThemeSelect(AppThemeMode.OLED) }
                )

                HorizontalDivider(color = borderColor)

                // SECTION 2: APP ICON
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "APP ICON",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = textSecondary,
                        letterSpacing = 1.sp
                    )

                    if (appIconMode == AppIconMode.AUTOMATIC) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(accentColor.copy(alpha = 0.15f))
                                .padding(horizontal = 8.dp, vertical = 3.dp)
                        ) {
                            Text(
                                if (isSystemDark) "System Dark → OLED" else "System Light → Light",
                                fontSize = 11.sp,
                                color = accentColor,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }

                // 1. Automatic
                AppIconSheetRow(
                    title = "Automatic",
                    description = "System Light → Light, System Dark → OLED\n(Dark icon is not used in Automatic mode)",
                    icon = Icons.Rounded.BrightnessAuto,
                    isSelected = appIconMode == AppIconMode.AUTOMATIC,
                    cardBg = cardBg,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary,
                    accentColor = accentColor,
                    borderColor = borderColor,
                    onClick = { onAppIconModeSelect(AppIconMode.AUTOMATIC) }
                )

                // 2. Light (Manual)
                AppIconSheetRow(
                    title = "Light",
                    description = "White adaptive launcher icon",
                    imageRes = R.drawable.raahi_logo_light,
                    imageBgColor = Color.White,
                    isSelected = appIconMode == AppIconMode.MANUAL && appIconManualChoice == AppIconChoice.LIGHT,
                    cardBg = cardBg,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary,
                    accentColor = accentColor,
                    borderColor = borderColor,
                    onClick = { onAppIconChoiceSelect(AppIconChoice.LIGHT) }
                )

                // 3. Dark (Manual)
                AppIconSheetRow(
                    title = "Dark",
                    description = "Dark slate adaptive launcher icon",
                    imageRes = R.drawable.raahi_logo_dark,
                    imageBgColor = Color(0xFF141724),
                    isSelected = appIconMode == AppIconMode.MANUAL && appIconManualChoice == AppIconChoice.DARK,
                    cardBg = cardBg,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary,
                    accentColor = accentColor,
                    borderColor = borderColor,
                    onClick = { onAppIconChoiceSelect(AppIconChoice.DARK) }
                )

                // 4. OLED (Manual)
                AppIconSheetRow(
                    title = "OLED",
                    description = "Pure black #000000 adaptive launcher icon",
                    imageRes = R.drawable.raahi_logo_oled,
                    imageBgColor = Color.Black,
                    isSelected = appIconMode == AppIconMode.MANUAL && appIconManualChoice == AppIconChoice.OLED,
                    cardBg = cardBg,
                    textPrimary = textPrimary,
                    textSecondary = textSecondary,
                    accentColor = accentColor,
                    borderColor = borderColor,
                    onClick = { onAppIconChoiceSelect(AppIconChoice.OLED) }
                )
            }
        }
    }
}

@Composable
fun AppIconSheetRow(
    title: String,
    description: String,
    icon: ImageVector? = null,
    imageRes: Int? = null,
    imageBgColor: Color = Color.Transparent,
    isSelected: Boolean,
    cardBg: Color,
    textPrimary: Color,
    textSecondary: Color,
    accentColor: Color,
    borderColor: Color,
    onClick: () -> Unit
) {
    val bg = if (isSelected) accentColor.copy(alpha = 0.14f) else cardBg
    val border = if (isSelected) accentColor.copy(alpha = 0.6f) else borderColor

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(14.dp))
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (icon != null) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (isSelected) accentColor else Color.Gray.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    tint = if (isSelected) Color.White else textSecondary,
                    modifier = Modifier.size(20.dp)
                )
            }
        } else if (imageRes != null) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(imageBgColor)
                    .border(0.5.dp, Color.Gray.copy(alpha = 0.3f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center
            ) {
                Image(
                    painter = painterResource(id = imageRes),
                    contentDescription = title,
                    modifier = Modifier.size(24.dp)
                )
            }
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                title,
                fontSize = 14.sp,
                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                color = textPrimary
            )
            Text(
                description,
                fontSize = 11.sp,
                color = textSecondary,
                lineHeight = 14.sp
            )
        }
        if (isSelected) {
            Icon(
                Icons.Rounded.CheckCircle,
                contentDescription = "Selected",
                tint = accentColor,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

@Composable
fun ThemeOptionRow(
    mode: AppThemeMode,
    title: String,
    description: String,
    icon: ImageVector,
    isSelected: Boolean,
    cardBg: Color,
    textPrimary: Color,
    textSecondary: Color,
    accentColor: Color,
    borderColor: Color,
    onClick: () -> Unit
) {
    val bg = if (isSelected) accentColor.copy(alpha = 0.14f) else cardBg
    val border = if (isSelected) accentColor.copy(alpha = 0.6f) else borderColor

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(14.dp))
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (isSelected) accentColor else Color.Gray.copy(alpha = 0.15f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null, tint = if (isSelected) Color.White else textSecondary, modifier = Modifier.size(20.dp))
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium, color = textPrimary)
            Text(description, fontSize = 11.sp, color = textSecondary)
        }
        if (isSelected) {
            Icon(Icons.Rounded.CheckCircle, contentDescription = "Selected", tint = accentColor, modifier = Modifier.size(20.dp))
        }
    }
}

@Composable
fun CameraPreview() {
    val viewModel: RaahiViewModel = viewModel()

    AndroidView(
        factory = { ctx ->
            val surfaceView = android.view.SurfaceView(ctx)

            surfaceView.holder.addCallback(object : android.view.SurfaceHolder.Callback {
                override fun surfaceCreated(holder: android.view.SurfaceHolder) {
                    val rotation = surfaceView.display?.rotation
                        ?: ctx.getSystemService(android.view.WindowManager::class.java)?.defaultDisplay?.rotation
                        ?: android.view.Surface.ROTATION_0
                    viewModel.updateOrientation(rotation)
                    viewModel.attachPreview(surfaceView)
                }
                override fun surfaceChanged(holder: android.view.SurfaceHolder, format: Int, width: Int, height: Int) {
                    viewModel.setPreviewResolution(width, height)
                    val rotation = surfaceView.display?.rotation
                        ?: ctx.getSystemService(android.view.WindowManager::class.java)?.defaultDisplay?.rotation
                        ?: android.view.Surface.ROTATION_0
                    viewModel.updateOrientation(rotation)
                }
                override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {
                    viewModel.detachPreview()
                }
            })
            surfaceView
        },
        modifier = Modifier.fillMaxSize()
    )
}