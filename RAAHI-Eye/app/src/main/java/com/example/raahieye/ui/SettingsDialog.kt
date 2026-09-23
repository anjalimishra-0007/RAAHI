package com.example.raahieye.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.Image
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.example.raahieye.R
import com.example.raahieye.model.RtspConfig
import com.example.raahieye.viewmodel.RaahiViewModel

@Composable
fun SettingsDialog(
    viewModel: RaahiViewModel,
    isDark: Boolean,
    onDismiss: () -> Unit
) {
    val currentConfig by viewModel.rtspConfig.collectAsState()

    var hostInput by remember(currentConfig) { mutableStateOf(currentConfig.host) }
    var portInput by remember(currentConfig) { mutableStateOf(currentConfig.port.toString()) }
    var pathInput by remember(currentConfig) { mutableStateOf(currentConfig.path) }

    val parsedPort = portInput.toIntOrNull()
    val isHostValid = RtspConfig.isValidHost(hostInput)
    val isPortValid = parsedPort != null && RtspConfig.isValidPort(parsedPort)
    val isFormValid = isHostValid && isPortValid

    val previewUrl = remember(hostInput, portInput, pathInput) {
        val p = parsedPort ?: 8555
        RtspConfig.buildRtspUrl(hostInput, p, pathInput)
    }

    val dialogBg = if (isDark) Color(0xFF141416) else Color.White
    val cardBg = if (isDark) Color(0xFF1C1C1E) else Color(0xFFF2F4F7)
    val textPrimary = if (isDark) Color.White else Color(0xFF1A1A1A)
    val textSecondary = if (isDark) Color(0xFFA0A0A5) else Color(0xFF8E8E93)
    val accentColor = Color(0xFF5E5CE6)
    val borderColor = if (isDark) Color.White.copy(alpha = 0.08f) else Color.Black.copy(alpha = 0.06f)

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.65f))
                .padding(16.dp),
            contentAlignment = Alignment.Center
        ) {
            Card(
                modifier = Modifier
                    .fillMaxWidth(if (androidx.compose.ui.platform.LocalConfiguration.current.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE) 0.75f else 0.95f)
                    .clip(RoundedCornerShape(24.dp))
                    .border(1.dp, borderColor, RoundedCornerShape(24.dp)),
                colors = CardDefaults.cardColors(containerColor = dialogBg)
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    // Header
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(accentColor.copy(alpha = 0.15f)),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(Icons.Rounded.Settings, contentDescription = null, tint = accentColor, modifier = Modifier.size(20.dp))
                            }
                            Column {
                                Text("Settings", fontSize = 18.sp, fontWeight = FontWeight.Bold, color = textPrimary)
                                Text("RTSP Destination & Preferences", fontSize = 11.sp, color = textSecondary)
                            }
                        }

                        IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                            Icon(Icons.Rounded.Close, contentDescription = "Close", tint = textSecondary)
                        }
                    }

                    HorizontalDivider(color = borderColor)

                    // Target URL live preview
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(cardBg)
                            .border(1.dp, borderColor, RoundedCornerShape(14.dp))
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text("TARGET RTSP DESTINATION", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = textSecondary)
                        Text(
                            text = previewUrl,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            fontFamily = FontFamily.Monospace,
                            color = if (isFormValid) Color(0xFF34C759) else Color(0xFFFF453A)
                        )
                    }

                    // Field 1: Host / IP
                    OutlinedTextField(
                        value = hostInput,
                        onValueChange = { hostInput = it },
                        label = { Text("Edge Host / IP") },
                        placeholder = { Text(if (viewModel.isEmulator) "10.0.2.2" else "192.168.x.x or 127.0.0.1") },
                        singleLine = true,
                        isError = !isHostValid,
                        supportingText = {
                            if (!isHostValid) {
                                Text("Enter a valid IP address or host", color = Color(0xFFFF453A), fontSize = 11.sp)
                            } else {
                                Text("MacBook LAN IP (or 127.0.0.1 for USB reverse)", color = textSecondary, fontSize = 11.sp)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = textPrimary,
                            unfocusedTextColor = textPrimary,
                            focusedBorderColor = accentColor,
                            unfocusedBorderColor = borderColor,
                            focusedLabelColor = accentColor,
                            unfocusedLabelColor = textSecondary,
                            focusedContainerColor = cardBg,
                            unfocusedContainerColor = cardBg
                        )
                    )

                    // Field 2: Port & Field 3: Path in a row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        OutlinedTextField(
                            value = portInput,
                            onValueChange = { portInput = it },
                            label = { Text("Port") },
                            placeholder = { Text("8555") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            isError = !isPortValid,
                            supportingText = {
                                if (!isPortValid) {
                                    Text("1 - 65535", color = Color(0xFFFF453A), fontSize = 11.sp)
                                } else {
                                    Text("Default: 8555", color = textSecondary, fontSize = 11.sp)
                                }
                            },
                            modifier = Modifier.weight(0.45f),
                            shape = RoundedCornerShape(14.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = textPrimary,
                                unfocusedTextColor = textPrimary,
                                focusedBorderColor = accentColor,
                                unfocusedBorderColor = borderColor,
                                focusedLabelColor = accentColor,
                                unfocusedLabelColor = textSecondary,
                                focusedContainerColor = cardBg,
                                unfocusedContainerColor = cardBg
                            )
                        )

                        OutlinedTextField(
                            value = pathInput,
                            onValueChange = { pathInput = it },
                            label = { Text("Path") },
                            placeholder = { Text("live") },
                            singleLine = true,
                            supportingText = { Text("e.g. live", color = textSecondary, fontSize = 11.sp) },
                            modifier = Modifier.weight(0.55f),
                            shape = RoundedCornerShape(14.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = textPrimary,
                                unfocusedTextColor = textPrimary,
                                focusedBorderColor = accentColor,
                                unfocusedBorderColor = borderColor,
                                focusedLabelColor = accentColor,
                                unfocusedLabelColor = textSecondary,
                                focusedContainerColor = cardBg,
                                unfocusedContainerColor = cardBg
                            )
                        )
                    }

                    HorizontalDivider(color = borderColor)

                    // Action buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Reset to Default button
                        OutlinedButton(
                            onClick = {
                                viewModel.resetRtspConfigToDefault()
                                hostInput = if (viewModel.isEmulator) "10.0.2.2" else "127.0.0.1"
                                portInput = "8555"
                                pathInput = "live"
                            },
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.weight(0.45f),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = textSecondary)
                        ) {
                            Text("Reset", fontSize = 13.sp)
                        }

                        // Save & Apply button
                        Button(
                            onClick = {
                                if (isFormValid) {
                                    val port = parsedPort ?: 8555
                                    viewModel.updateRtspConfig(
                                        host = hostInput,
                                        port = port,
                                        path = pathInput
                                    )
                                    onDismiss()
                                }
                            },
                            enabled = isFormValid,
                            shape = RoundedCornerShape(14.dp),
                            modifier = Modifier.weight(0.55f),
                            colors = ButtonDefaults.buttonColors(containerColor = accentColor)
                        ) {
                            Text("Save & Apply", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}
