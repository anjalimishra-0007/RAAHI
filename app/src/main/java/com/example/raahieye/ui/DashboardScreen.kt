package com.example.raahieye.ui

import android.content.res.Configuration
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.raahieye.model.GpsData
import com.example.raahieye.model.NetworkInfo
import com.example.raahieye.model.StreamState
import com.example.raahieye.viewmodel.RaahiViewModel

enum class AppThemeMode { SYSTEM, LIGHT, OLED_DARK }

@Composable
fun DashboardScreen(viewModel: RaahiViewModel = viewModel()) {
    val streamState by viewModel.streamState.collectAsState()
    val gpsData by viewModel.gpsData.collectAsState()
    val networkInfo by viewModel.networkInfo.collectAsState()
    val busId by viewModel.busId.collectAsState()

    var currentTheme by remember { mutableStateOf(AppThemeMode.SYSTEM) }

    val isSystemDark = isSystemInDarkTheme()
    val isDark = when (currentTheme) {
        AppThemeMode.SYSTEM -> isSystemDark
        AppThemeMode.LIGHT -> false
        AppThemeMode.OLED_DARK -> true
    }

    val bgColor = if (isDark) Color(0xFF000000) else Color(0xFFF2F4F7)
    val cardBgColor = if (isDark) Color(0xFF141416) else Color.White
    val cardBorderColor = if (isDark) Color.White.copy(alpha = 0.05f) else Color.Black.copy(alpha = 0.03f)
    val textPrimary = if (isDark) Color.White else Color(0xFF1A1A1A)
    val textSecondary = if (isDark) Color(0xFFA0A0A5) else Color(0xFF8E8E93)

    val onThemeToggle = {
        currentTheme = when (currentTheme) {
            AppThemeMode.SYSTEM -> AppThemeMode.LIGHT
            AppThemeMode.LIGHT -> AppThemeMode.OLED_DARK
            AppThemeMode.OLED_DARK -> AppThemeMode.SYSTEM
        }
    }

    val configuration = LocalConfiguration.current
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val context = androidx.compose.ui.platform.LocalContext.current

    LaunchedEffect(configuration.orientation) {
        val rotation = (context as? android.app.Activity)?.display?.rotation
            ?: (context.getSystemService(android.view.WindowManager::class.java))?.defaultDisplay?.rotation
            ?: android.view.Surface.ROTATION_0
        viewModel.updateOrientation(rotation)
    }

    if (isLandscape) {
        LandscapeDashboard(
            streamState = streamState, gpsData = gpsData, networkInfo = networkInfo, busId = busId,
            isDark = isDark, bgColor = bgColor, cardBgColor = cardBgColor, cardBorderColor = cardBorderColor,
            textPrimary = textPrimary, textSecondary = textSecondary,
            onSettingsClick = onThemeToggle, onToggleStream = { viewModel.toggleStream() }
        )
    } else {
        PortraitDashboard(
            streamState = streamState, gpsData = gpsData, networkInfo = networkInfo, busId = busId,
            isDark = isDark, bgColor = bgColor, cardBgColor = cardBgColor, cardBorderColor = cardBorderColor,
            textPrimary = textPrimary, textSecondary = textSecondary,
            onSettingsClick = onThemeToggle, onToggleStream = { viewModel.toggleStream() }
        )
    }
}

@Composable
fun LandscapeDashboard(
    streamState: StreamState, gpsData: GpsData, networkInfo: NetworkInfo, busId: String,
    isDark: Boolean, bgColor: Color, cardBgColor: Color, cardBorderColor: Color,
    textPrimary: Color, textSecondary: Color, onSettingsClick: () -> Unit, onToggleStream: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxSize()
            .background(bgColor)
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Left Panel (60% width)
        Box(
            modifier = Modifier.weight(0.60f).fillMaxHeight(),
            contentAlignment = Alignment.Center
        ) {
            CameraContainer(streamState, modifier = Modifier.fillMaxWidth())
        }

        // Right Panel (40% width)
        Column(
            modifier = Modifier
                .weight(0.40f)
                .fillMaxHeight()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            HeaderSection(
                isConnected = networkInfo.isConnected,
                textPrimary = textPrimary, textSecondary = textSecondary,
                bg = cardBgColor, border = cardBorderColor, onSettingsClick = onSettingsClick
            )

            // 1. Bus ID + GPS
            Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DashboardCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "Bus ID", value = busId, subValue = "",
                    icon = Icons.Rounded.DirectionsBus, iconTint = Color(0xFF5E5CE6),
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
                val gpsStatus = if (gpsData.isAvailable) "Active (${gpsData.accuracyMeters}m)" else "Searching..."
                val gpsSub = if (gpsData.isAvailable) "${gpsData.latitude}, ${gpsData.longitude}" else "—"
                DashboardCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "GPS", value = gpsStatus, subValue = gpsSub,
                    icon = Icons.Rounded.LocationOn, iconTint = Color(0xFF34C759),
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
            }

            // 2. Camera / Connection / Network status
            Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val camStatus = if (streamState == StreamState.STREAMING) "Streaming" else "Idle"
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "Camera", value = camStatus, subValue = "",
                    icon = Icons.Rounded.CameraAlt, iconTint = Color(0xFFAF52DE), isGood = streamState == StreamState.STREAMING,
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
                val connStatus = when (streamState) {
                    StreamState.STREAMING -> "Connected"
                    StreamState.CONNECTING, StreamState.RECONNECTING -> "Connecting..."
                    StreamState.ERROR -> "Error"
                    else -> "Offline"
                }
                val connGood = streamState == StreamState.STREAMING
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "Connection", value = connStatus, subValue = "",
                    icon = Icons.Rounded.Sensors, iconTint = Color(0xFFFF2D55), isGood = connGood,
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
                val netType = networkInfo.type.uppercase()
                val netLabel = when {
                    !networkInfo.isConnected -> "Not connected"
                    netType.contains("WIFI") -> "Wi-Fi"
                    netType.contains("USB") -> "USB"
                    netType.contains("CELLULAR") -> "Hotspot"
                    else -> "Unknown"
                }
                val netSub = if (networkInfo.isConnected) networkInfo.localIp else "—"
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "Network", value = netLabel, subValue = netSub,
                    icon = Icons.Rounded.SignalCellularAlt, iconTint = Color(0xFFFF9F0A), isGood = networkInfo.isConnected,
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
            }

            // 3. Stream Stats
            StreamStatsCard(streamState, bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary)

            // 4. Start/Stop Stream Button
            PrimaryStreamButton(streamState, onClick = onToggleStream)
        }
    }
}

@Composable
fun PortraitDashboard(
    streamState: StreamState, gpsData: GpsData, networkInfo: NetworkInfo, busId: String,
    isDark: Boolean, bgColor: Color, cardBgColor: Color, cardBorderColor: Color,
    textPrimary: Color, textSecondary: Color, onSettingsClick: () -> Unit, onToggleStream: () -> Unit
) {
    Scaffold(
        bottomBar = { BottomNavBar(isDark, bgColor, cardBorderColor) },
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
                isConnected = networkInfo.isConnected, textPrimary = textPrimary, textSecondary = textSecondary,
                bg = cardBgColor, border = cardBorderColor, onSettingsClick = onSettingsClick
            )

            CameraContainer(streamState, modifier = Modifier.fillMaxWidth())

            Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                DashboardCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "Bus ID", value = busId, subValue = "",
                    icon = Icons.Rounded.DirectionsBus, iconTint = Color(0xFF5E5CE6),
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
                val gpsStatus = if (gpsData.isAvailable) "Active (${gpsData.accuracyMeters}m)" else "Searching..."
                val gpsSub = if (gpsData.isAvailable) "${gpsData.latitude}, ${gpsData.longitude}" else "—"
                DashboardCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "GPS", value = gpsStatus, subValue = gpsSub,
                    icon = Icons.Rounded.LocationOn, iconTint = Color(0xFF34C759),
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
            }

            Row(modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val camStatus = if (streamState == StreamState.STREAMING) "Streaming" else "Idle"
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "Camera", value = camStatus, subValue = "",
                    icon = Icons.Rounded.CameraAlt, iconTint = Color(0xFFAF52DE), isGood = streamState == StreamState.STREAMING,
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
               val connStatus = when (streamState) {
                   StreamState.STREAMING -> "Connected"
                   StreamState.CONNECTING, StreamState.RECONNECTING -> "Connecting..."
                   StreamState.ERROR -> "Error"
                   else -> "Offline"
               }
               val connGood = streamState == StreamState.STREAMING
               SmallStatusCard(
                   modifier = Modifier.weight(1f).fillMaxHeight(), title = "Connection", value = connStatus, subValue = "",
                   icon = Icons.Rounded.Sensors, iconTint = Color(0xFFFF2D55), isGood = connGood,
                   bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
               )
               val netType = networkInfo.type.uppercase()
                val netLabel = when {
                    !networkInfo.isConnected -> "Not connected"
                    netType.contains("WIFI") -> "Wi-Fi"
                    netType.contains("USB") -> "USB"
                    netType.contains("CELLULAR") -> "Hotspot"
                    else -> "Unknown"
                }
                val netSub = if (networkInfo.isConnected) networkInfo.localIp else "—"
                SmallStatusCard(
                    modifier = Modifier.weight(1f).fillMaxHeight(), title = "Network", value = netLabel, subValue = netSub,
                    icon = Icons.Rounded.SignalCellularAlt, iconTint = Color(0xFFFF9F0A), isGood = networkInfo.isConnected,
                    bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary
                )
            }

            StreamStatsCard(streamState, bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary, textSecondary = textSecondary)

            Spacer(modifier = Modifier.height(4.dp))
            PrimaryStreamButton(streamState, onClick = onToggleStream)
            Spacer(modifier = Modifier.height(4.dp))
            QuickActionsRow(bg = cardBgColor, border = cardBorderColor, textPrimary = textPrimary)
            Spacer(modifier = Modifier.height(4.dp))
        }
    }
}

// -------------------------------------------------------------------------
// REUSABLE COMPONENTS
// -------------------------------------------------------------------------

@Composable
fun HeaderSection(isConnected: Boolean, textPrimary: Color, textSecondary: Color, bg: Color, border: Color, onSettingsClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text("RAAHI", fontSize = 24.sp, fontWeight = FontWeight.Black, color = textPrimary, letterSpacing = 1.sp)
            Text("Safer Roads. Brighter Journeys.", fontSize = 11.sp, color = textSecondary, fontWeight = FontWeight.Medium)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier
                    .clip(RoundedCornerShape(16.dp))
                    .background(if (isConnected) Color(0xFF34C759).copy(alpha = 0.1f) else Color(0xFFFF3B30).copy(alpha = 0.1f))
                    .border(1.dp, if (isConnected) Color(0xFF34C759).copy(alpha = 0.2f) else Color(0xFFFF3B30).copy(alpha = 0.2f), RoundedCornerShape(16.dp))
                    .padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(if (isConnected) Color(0xFF34C759) else Color(0xFFFF3B30)))
                Spacer(modifier = Modifier.width(6.dp))
                Text(if (isConnected) "Online" else "Offline", color = if (isConnected) Color(0xFF34C759) else Color(0xFFFF3B30), fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
            Box(
                modifier = Modifier.size(34.dp).clip(CircleShape).background(bg).border(1.dp, border, CircleShape).clickable { onSettingsClick() },
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Rounded.Settings, contentDescription = "Settings", tint = textPrimary, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
fun CameraContainer(streamState: StreamState, modifier: Modifier = Modifier) {
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
                val infiniteTransition = rememberInfiniteTransition()
                val alpha by infiniteTransition.animateFloat(
                    initialValue = 1f, targetValue = 0.2f,
                    animationSpec = infiniteRepeatable(animation = tween(800), repeatMode = RepeatMode.Reverse)
                )
                Row(
                    modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xFFFF2D55)).padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(Color.White.copy(alpha = alpha)))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("LIVE", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
            Box(modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 10.dp, vertical = 4.dp)) {
                Text(if (streamState == StreamState.STREAMING) "00:12:34" else "--:--:--", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Medium)
            }
        }

        Box(modifier = Modifier.padding(12.dp).align(Alignment.TopEnd).clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 10.dp, vertical = 4.dp)) {
            Text(if (streamState == StreamState.STREAMING) "1080p • 30 FPS" else "1080p • Ready", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        }

        Row(modifier = Modifier.padding(12.dp).align(Alignment.BottomStart), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(32.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Videocam, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
            }
            Spacer(modifier = Modifier.width(8.dp))
            Column {
                Text("Rear Camera", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text("Wide • 1.0x", color = Color.White.copy(alpha = 0.7f), fontSize = 10.sp, maxLines = 1)
            }
        }

        Box(modifier = Modifier.padding(12.dp).align(Alignment.BottomEnd).size(32.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Fullscreen, contentDescription = "Expand", tint = Color.White, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
fun DashboardCard(modifier: Modifier, title: String, value: String, subValue: String, icon: ImageVector, iconTint: Color, bg: Color, border: Color, textPrimary: Color, textSecondary: Color) {
    Row(
        modifier = modifier.clip(RoundedCornerShape(20.dp)).background(bg).border(1.dp, border, RoundedCornerShape(20.dp)).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(modifier = Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(iconTint.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(18.dp))
        }
        Spacer(modifier = Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, color = textSecondary, fontSize = 10.sp, fontWeight = FontWeight.Medium, maxLines = 1)
            Text(value, color = textPrimary, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subValue.isNotEmpty()) {
                Text(subValue, color = textSecondary, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = textSecondary.copy(alpha = 0.5f), modifier = Modifier.size(14.dp))
    }
}

@Composable
fun SmallStatusCard(modifier: Modifier, title: String, value: String, subValue: String, icon: ImageVector, iconTint: Color, isGood: Boolean, bg: Color, border: Color, textPrimary: Color, textSecondary: Color) {
    Column(
        modifier = modifier.clip(RoundedCornerShape(16.dp)).background(bg).border(1.dp, border, RoundedCornerShape(16.dp)).padding(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)).background(iconTint.copy(alpha = 0.15f)), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(14.dp))
            }
            Spacer(modifier = Modifier.width(6.dp))
            Text(title, color = textSecondary, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(value, color = if (isGood) Color(0xFF34C759) else textPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (subValue.isNotEmpty()) {
            Text(subValue, color = textSecondary, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
fun StreamStatsCard(streamState: StreamState, bg: Color, border: Color, textPrimary: Color, textSecondary: Color) {
    val isStreaming = streamState == StreamState.STREAMING
    Column(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(bg).border(1.dp, border, RoundedCornerShape(20.dp)).padding(14.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 10.dp)) {
            Icon(Icons.Rounded.ShowChart, contentDescription = null, tint = Color(0xFF5E5CE6), modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Text("Stream Stats", color = textPrimary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Spacer(modifier = Modifier.weight(1f))
            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = textSecondary.copy(alpha = 0.5f), modifier = Modifier.size(14.dp))
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            StatItem(if (isStreaming) "30" else "--", "FPS", textPrimary, textSecondary)
            StatItem(if (isStreaming) "6.2" else "--", "Mbps", textPrimary, textSecondary)
            StatItem(if (isStreaming) "H.264" else "--", "Codec", textPrimary, textSecondary)
            StatItem(if (isStreaming) "1080p" else "--", "Resolution", textPrimary, textSecondary)
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
fun PrimaryStreamButton(streamState: StreamState, onClick: () -> Unit) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(targetValue = if (isPressed) 0.95f else 1f, animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy))

    val gradient = when (streamState) {
        StreamState.STREAMING -> Brush.horizontalGradient(listOf(Color(0xFFFF453A), Color(0xFFFF2D55)))
        StreamState.CONNECTING -> Brush.horizontalGradient(listOf(Color(0xFFFF9F0A), Color(0xFFFFD60A)))
        StreamState.ERROR -> Brush.horizontalGradient(listOf(Color(0xFF8E8E93), Color(0xFFA0A0A5)))
        else -> Brush.horizontalGradient(listOf(Color(0xFF0A84FF), Color(0xFF5E5CE6)))
    }

    val shadowColor = when (streamState) {
        StreamState.STREAMING -> Color(0xFFFF2D55).copy(alpha = 0.4f)
        StreamState.CONNECTING -> Color(0xFFFF9F0A).copy(alpha = 0.4f)
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

    val icon = if (streamState == StreamState.STREAMING) Icons.Rounded.Stop else Icons.Rounded.PlayArrow

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .scale(scale)
            .height(56.dp)
            .shadow(12.dp, RoundedCornerShape(28.dp), spotColor = shadowColor)
            .clip(RoundedCornerShape(28.dp))
            .background(gradient)
            .clickable(interactionSource = interactionSource, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(24.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
            }
            Spacer(modifier = Modifier.width(10.dp))
            Text(buttonText, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 1.sp)
        }
    }
}

@Composable
fun QuickActionsRow(bg: Color, border: Color, textPrimary: Color) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        QuickActionButton(Icons.Rounded.CameraAlt, "Snapshot", bg, border, textPrimary)
        QuickActionButton(Icons.Rounded.FiberManualRecord, "Record Clip", bg, border, textPrimary)
        QuickActionButton(Icons.Rounded.Map, "View Map", bg, border, textPrimary)
        QuickActionButton(Icons.Rounded.MoreHoriz, "More", bg, border, textPrimary)
    }
}

@Composable
fun QuickActionButton(icon: ImageVector, label: String, bg: Color, border: Color, textPrimary: Color) {
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(if (isPressed) 0.9f else 1f)

    Column(
        modifier = Modifier.width(72.dp).scale(scale).clickable(interactionSource = interactionSource, indication = null, onClick = {}),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(bg).border(1.dp, border, RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = label, tint = Color(0xFF0A84FF), modifier = Modifier.size(22.dp))
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(label, color = textPrimary, fontSize = 10.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

@Composable
fun BottomNavBar(isDark: Boolean, bgColor: Color, borderColor: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(bgColor.copy(alpha = 0.95f))
            .border(width = 1.dp, color = borderColor, shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
            .padding(vertical = 10.dp, horizontal = 24.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        BottomNavItem(Icons.Rounded.Home, "Home", isSelected = true, isDark = isDark)
        BottomNavItem(Icons.Rounded.FormatListBulleted, "Events", isSelected = false, isDark = isDark)
        BottomNavItem(Icons.Rounded.Map, "Map", isSelected = false, isDark = isDark)
        BottomNavItem(Icons.Rounded.Settings, "Settings", isSelected = false, isDark = isDark)
    }
}

@Composable
fun BottomNavItem(icon: ImageVector, label: String, isSelected: Boolean, isDark: Boolean) {
    val tint = if (isSelected) Color(0xFF5E5CE6) else if (isDark) Color.Gray else Color.LightGray
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
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
fun CameraPreview() {
    val viewModel: RaahiViewModel = androidx.lifecycle.viewmodel.compose.viewModel()

    androidx.compose.ui.viewinterop.AndroidView(
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
        modifier = androidx.compose.ui.Modifier.fillMaxSize()
    )
}