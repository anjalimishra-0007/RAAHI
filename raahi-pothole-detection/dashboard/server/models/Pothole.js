import mongoose from 'mongoose';

const potholeSchema = new mongoose.Schema(
  {
    potholeId: {
      type: String,
      required: [true, 'potholeId is required'],
      unique: true,
      trim: true,
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
    busesDetectedBy: {
      type: [String],
      default: []
    },
    confidence: {
      type: Number,
      min: [0, 'Confidence must be >= 0'],
      max: [1, 'Confidence must be <= 1'],
      default: null
    },
    videoUrl: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: ['open', 'investigating', 'repaired', 'ignored'],
      default: 'open'
    },
    // Phase 1 Canonical Central Ingestion & Edge Metadata
    edgeEventId: {
      type: String,
      trim: true
    },
    sourceCandidateId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    verifiedClass: {
      type: String,
      trim: true,
      default: null
    },
    eventType: {
      type: String,
      default: 'pothole'
    },
    class: {
      type: String,
      default: 'pothole'
    },
    edgeModel: {
      type: String,
      default: 'YOLO11n'
    },
    boundingBox: {
      x1: { type: Number, default: null },
      y1: { type: Number, default: null },
      x2: { type: Number, default: null },
      y2: { type: Number, default: null }
    },
    verificationStatus: {
      type: String,
      default: undefined
    },
    evidenceReference: {
      type: String,
      default: ''
    },
    centralDeliveryStatus: {
      type: String,
      enum: ['received', 'processing', 'completed'],
      default: 'received'
    }
  },
  {
    timestamps: true
  }
);

// Helpful compound/field indices for queries
potholeSchema.index({ status: 1 });
potholeSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });
// Enforce edgeEventId uniqueness ONLY when edgeEventId is a non-null string
potholeSchema.index(
  { edgeEventId: 1 },
  { unique: true, partialFilterExpression: { edgeEventId: { $type: 'string' } } }
);

const Pothole = mongoose.models.Pothole || mongoose.model('Pothole', potholeSchema);

export default Pothole;
