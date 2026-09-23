import mongoose from 'mongoose';

/**
 * CandidateEvent Mongoose Model (Phase 2)
 * =======================================
 * Represents an unverified Edge Candidate Event received at RAAHI Central.
 * 
 * ARCHITECTURAL SEPARATION:
 * - Candidate Events live in the 'candidate_events' collection.
 * - They are the canonical Central buffer for incoming Edge packages.
 * - They are promoted via 10m Haversine spatial fusion into the authoritative
 *   'Pothole' collection, or correlated into 'TrafficIncident' collection.
 */
const candidateEventSchema = new mongoose.Schema(
  {
    candidateId: {
      type: String,
      required: [true, 'candidateId is required'],
      unique: true,
      trim: true,
      index: true
    },
    edgeEventId: {
      type: String,
      required: [true, 'edgeEventId is required'],
      unique: true,
      trim: true,
      index: true
    },
    eventType: {
      type: String,
      required: [true, 'eventType is required'],
      trim: true,
      default: 'pothole',
      index: true
    },
    busId: {
      type: String,
      required: [true, 'busId is required'],
      trim: true,
      index: true
    },
    timestamp: {
      type: Date,
      required: [true, 'timestamp is required'],
      index: true
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
    edgeModel: {
      type: String,
      required: [true, 'edgeModel is required'],
      trim: true,
      default: 'YOLO11n'
    },
    confidence: {
      type: Number,
      required: [true, 'confidence is required'],
      min: [0, 'Confidence must be >= 0'],
      max: [1, 'Confidence must be <= 1']
    },
    class: {
      type: String,
      required: [true, 'class is required'],
      trim: true,
      default: 'pothole'
    },
    boundingBox: {
      x1: { type: Number, default: null },
      y1: { type: Number, default: null },
      x2: { type: Number, default: null },
      y2: { type: Number, default: null }
    },
    trafficTelemetry: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    evidenceReference: {
      type: String,
      trim: true,
      default: ''
    },
    videoUrl: {
      type: String,
      trim: true,
      default: ''
    },
    driveFileId: {
      type: String,
      trim: true,
      default: null
    },
    driveWebViewLink: {
      type: String,
      trim: true,
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'promoted'],
      default: 'pending',
      index: true
    },
    centralDeliveryStatus: {
      type: String,
      enum: ['received', 'processing', 'completed'],
      default: 'received'
    },
    promotedToPotholeId: {
      type: String,
      trim: true,
      default: null,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// Compound indices for fast query and queue filtering
candidateEventSchema.index({ status: 1, createdAt: -1 });
candidateEventSchema.index({ promotedToPotholeId: 1, createdAt: -1 });
candidateEventSchema.index({ busId: 1, createdAt: -1 });
candidateEventSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });

const CandidateEvent = mongoose.models.CandidateEvent || mongoose.model('CandidateEvent', candidateEventSchema);

export default CandidateEvent;
