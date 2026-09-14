package com.example.raahieye


import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.example.raahieye.ui.DashboardScreen
import com.example.raahieye.viewmodel.RaahiViewModel

class MainActivity : ComponentActivity() {

    private val viewModel: RaahiViewModel by viewModels()

    private val configChangeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == Intent.ACTION_CONFIGURATION_CHANGED) {
                viewModel.syncAppIconWithSystemTheme()
            }
        }
    }

    // Define the core permissions needed for the prototype
    private val requiredPermissions = arrayOf(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.ACCESS_FINE_LOCATION
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Register dynamic configuration change receiver for live system theme toggles
        val filter = IntentFilter(Intent.ACTION_CONFIGURATION_CHANGED)
        ContextCompat.registerReceiver(this, configChangeReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)

        // Initial sync of app launcher icon
        viewModel.syncAppIconWithSystemTheme()

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    PermissionHandler(
                        permissions = requiredPermissions,
                        onPermissionsGranted = {
                            DashboardScreen()
                        }
                    )
                }
            }
        }
    }

    @Composable
    fun PermissionHandler(
        permissions: Array<String>,
        onPermissionsGranted: @Composable () -> Unit
    ) {
        var permissionsGranted by remember {
            mutableStateOf(checkAllPermissions(permissions))
        }

        val permissionLauncher = rememberLauncherForActivityResult(
            contract = ActivityResultContracts.RequestMultiplePermissions()
        ) { results ->
            permissionsGranted = results.values.all { it }
        }

        val lifecycleOwner = LocalLifecycleOwner.current
        DisposableEffect(lifecycleOwner, permissions) {
            val observer = LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    permissionsGranted = checkAllPermissions(permissions)
                }
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose {
                lifecycleOwner.lifecycle.removeObserver(observer)
            }
        }

        if (permissionsGranted) {
            onPermissionsGranted()
        } else {
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("RAAHI requires Camera and GPS permissions to operate.")
                Spacer(modifier = Modifier.height(16.dp))
                Button(onClick = { permissionLauncher.launch(permissions) }) {
                    Text("Grant Permissions")
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.syncAppIconWithSystemTheme()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        viewModel.syncAppIconWithSystemTheme()
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(configChangeReceiver)
        } catch (e: Exception) {
            // Already unregistered
        }
    }

    private fun checkAllPermissions(permissions: Array<String>): Boolean {
        return permissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }
}