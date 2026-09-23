import mongoose from 'mongoose';

/**
 * TrafficIncident Mongoose Model
 * ==============================
 * Represents a deterministic Central Traffic Incident (e.g., Congestion).
 * Supports multi-bus correlation: when multiple buses observe traffic congestion
 * within spatial-temporal thresholds (e.g. 50m / 10 min), Central correlates them
 * under a single incident, aggregating busesReportedBy and observation count.
 */
const trafficIncidentSchema = new mongoose.Schema(
  {
    incidentId: {
      type: String,
      required: [true, 'incidentId is required'],
      unique: true,
      trim: true,
      index: true
    },
    edgeEventId: {
      type: String,
      trim: true
    },
    eventType: {
      type: String,
      required: [true, 'eventType is required'],
      trim: true,
      default: 'congestion',
      index: true
    },
    trafficState: {
      type: String,
      trim: true,
      default: 'CONGESTED'
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'high'
    },
    location: {
      latitude: {
        type: Number,
        required: [true, 'Latitude is required'],
        min: [-90, 'Latitude must be >= -90'],
        max: [90, 'Latitude must be <= 90']
      },
      longitude: {
        type: Number,
        required: [true, 'Longitude is required'],
        min: [-180, 'Longitude must be >= -180'],
        max: [180, 'Longitude must be <= 180']
      },
      accuracy: {
        type: Number,
        default: null
      }
    },
    address: {
      type: String,
      trim: true,
      default: ''
    },
    firstDetectedAt: {
      type: Date,
      default: Date.now
    },
    lastDetectedAt: {
      type: Date,
      default: Date.now
    },
    detectionCount: {
      type: Number,
      default: 1,
      min: [1, 'detectionCount must be at least 1']
    },
    busesReportedBy: {
      type: [String],
      default: []
    },
    metrics: {
      activeVehicles: { type: Number, default: 0 },
      vehiclesInRoi: { type: Number, default: 0 },
      occupancyRatio: { type: Number, default: 0.0 },
      flowVpm: { type: Number, default: 0.0 }
    },
    status: {
      type: String,
      enum: ['active', 'cleared', 'investigating'],
      default: 'active',
      index: true
    },
    edgeEventIds: {
      type: [String],
      default: []
    },
    evidenceReference: {
      type: String,
      default: ''
    },
    videoUrl: {
      type: String,
      default: ''
    },
    driveFileId: {
      type: String,
      default: null
    },
    driveWebViewLink: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

trafficIncidentSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });

const TrafficIncident = mongoose.models.TrafficIncident || mongoose.model('TrafficIncident', trafficIncidentSchema);

export default TrafficIncident;
