import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from './db.js';
import Pothole from './models/Pothole.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server dir or dashboard root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function seedTestPothole() {
  console.log('[Seed] Connecting to MongoDB...');
  const conn = await connectDB();
  if (!conn) {
    console.error('[Seed] Could not connect to MongoDB. Make sure MongoDB is running.');
    process.exit(1);
  }

  try {
    const testData = {
      potholeId: 'POT-000001',
      location: {
        latitude: 28.4595,
        longitude: 77.0266,
        accuracy: 4.8
      },
      address: 'MG Road, Sector 14, Gurugram (TEST RECORD)',
      firstDetectedAt: new Date('2026-09-12T10:15:00.000Z'),
      lastDetectedAt: new Date('2026-09-12T10:15:00.000Z'),
      detectionCount: 1,
      busesDetectedBy: ['RAAHI-01'],
      confidence: 0.88,
      videoUrl: 'https://drive.google.com/file/d/sample-drive-id/view?usp=sharing',
      status: 'open'
    };

    const doc = await Pothole.findOneAndUpdate(
      { potholeId: testData.potholeId },
      testData,
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    console.log('==================================================');
    console.log('     TEST POTHOLE CREATED / UPDATED SUCCESSFULLY  ');
    console.log('==================================================');
    console.log(`Pothole ID:      ${doc.potholeId}`);
    console.log(`Database ID:     ${doc._id}`);
    console.log(`Location:        (${doc.location.latitude}, ${doc.location.longitude})`);
    console.log(`Address:         ${doc.address}`);
    console.log(`Status:          ${doc.status}`);
    console.log(`Video URL:       ${doc.videoUrl}`);
    console.log(`Buses:           ${doc.busesDetectedBy.join(', ')}`);
    console.log('==================================================');
    console.log('You can now open MongoDB Compass to view this document.');
    process.exit(0);
  } catch (err) {
    console.error('[Seed] Failed to insert test pothole:', err.message);
    process.exit(1);
  }
}

seedTestPothole();
