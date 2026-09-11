package com.example.raahieye.model

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.nio.ByteBuffer

class VideoStreamingClient {
    private var socket: DatagramSocket? = null
    private var targetAddress: InetAddress? = null
    private var targetPort: Int = 5000

    private var mediaCodec: MediaCodec? = null
    var isStreaming = false
        private set

    suspend fun connect(ipAddress: String, port: Int): Boolean = withContext(Dispatchers.IO) {
        try {
            targetAddress = InetAddress.getByName(ipAddress)
            targetPort = port
            socket = DatagramSocket()

            // Initialize H.264 Hardware Encoder
            val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, 1920, 1080).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
                setInteger(MediaFormat.KEY_BIT_RATE, 6_000_000) // 6 Mbps
                setInteger(MediaFormat.KEY_FRAME_RATE, 30)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1) // 1 keyframe per second
            }

            mediaCodec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
            mediaCodec?.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            mediaCodec?.start()

            isStreaming = true
            return@withContext true
        } catch (e: Exception) {
            Log.e("RAAHI_STREAM", "Connection failed", e)
            return@withContext false
        }
    }

    fun processAndSendFrame(yuvBytes: ByteArray) {
        if (!isStreaming || socket == null || mediaCodec == null) return

        try {
            // 1. Queue frame to hardware encoder
            val inputBufferIndex = mediaCodec!!.dequeueInputBuffer(10000)
            if (inputBufferIndex >= 0) {
                val inputBuffer = mediaCodec!!.getInputBuffer(inputBufferIndex)
                inputBuffer?.clear()
                inputBuffer?.put(yuvBytes)
                mediaCodec!!.queueInputBuffer(inputBufferIndex, 0, yuvBytes.size, System.nanoTime() / 1000, 0)
            }

            // 2. Retrieve encoded H.264 NAL units and send via UDP
            val bufferInfo = MediaCodec.BufferInfo()
            var outputBufferIndex = mediaCodec!!.dequeueOutputBuffer(bufferInfo, 10000)

            while (outputBufferIndex >= 0) {
                val outputBuffer = mediaCodec!!.getOutputBuffer(outputBufferIndex)
                if (outputBuffer != null && bufferInfo.size > 0) {
                    outputBuffer.position(bufferInfo.offset)
                    outputBuffer.limit(bufferInfo.offset + bufferInfo.size)

                    val encodedData = ByteArray(bufferInfo.size)
                    outputBuffer.get(encodedData)

                    // Blast over UDP to MacBook
                    val packet = DatagramPacket(encodedData, encodedData.size, targetAddress, targetPort)
                    socket?.send(packet)
                }
                mediaCodec!!.releaseOutputBuffer(outputBufferIndex, false)
                outputBufferIndex = mediaCodec!!.dequeueOutputBuffer(bufferInfo, 0)
            }
        } catch (e: Exception) {
            Log.e("RAAHI_STREAM", "Encoding/Transmission error", e)
        }
    }

    fun stop() {
        isStreaming = false
        try {
            mediaCodec?.stop()
            mediaCodec?.release()
            socket?.close()
        } catch (e: Exception) {
            Log.e("RAAHI_STREAM", "Error stopping stream", e)
        } finally {
            mediaCodec = null
            socket = null
        }
    }
}