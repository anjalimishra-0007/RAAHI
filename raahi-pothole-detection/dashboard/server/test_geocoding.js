import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { connectDB } from './db.js';
import Pothole from './models/Pothole.js';
import {
  validateCoordinates,
  getCacheKey,
  reverseGeocode,
  getCacheStats
} from './services/geocodingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

console.log('==============================================================');
console.log('       RAAHI: REVERSE GEOCODING TEST SUITE (PHASE 11)          ');
console.log('==============================================================\n');

async function runTests() {
  // -------------------------------------------------------------
  // 1. UNIT TEST: Coordinate Validation
  // -------------------------------------------------------------
  console.log('--- 1. UNIT TEST: Coordinate Validation ---');
  const validTest = validateCoordinates(28.6139, 77.2090);
  const invalidLat = validateCoordinates(95.0, 77.2090);
  const invalidLng = validateCoordinates(28.6139, 195.0);
  const invalidType = validateCoordinates('not-a-number', 77.2090);

  console.log(`Valid (28.6139, 77.2090):      valid=${validTest.valid}`);
  console.log(`Invalid Lat (95, 77):           valid=${invalidLat.valid}, error="${invalidLat.error}"`);
  console.log(`Invalid Lng (28, 195):          valid=${invalidLng.valid}, error="${invalidLng.error}"`);
  console.log(`Invalid Type ('abc', 77):       valid=${invalidType.valid}, error="${invalidType.error}"`);

  if (validTest.valid && !invalidLat.valid && !invalidLng.valid && !invalidType.valid) {
    console.log('  PASSED: Coordinate validation works as expected.\n');
  } else {
    console.error('  FAILED: Coordinate validation check failed.');
    process.exit(1);
  }

  // -------------------------------------------------------------
  // 2. UNIT TEST: Cache Key Generation
  // -------------------------------------------------------------
  console.log('--- 2. UNIT TEST: Cache Key Generation ---');
  const key1 = getCacheKey(28.613905, 77.209008);
  const key2 = getCacheKey(28.613900, 77.209000);
  console.log(`Key for (28.613905, 77.209008): "${key1}"`);
  console.log(`Key for (28.613900, 77.209000): "${key2}"`);

  if (key1 === '28.6139,77.2090' && key2 === '28.6139,77.2090') {
    console.log('  PASSED: Coordinates within ~11m share the same bucketed cache key.\n');
  } else {
    console.error(`  FAILED: Unexpected cache keys: key1=${key1}, key2=${key2}`);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // 3. LIVE API TEST: Reverse Geocode via Nominatim
  // -------------------------------------------------------------
  console.log('--- 3. LIVE TEST: Nominatim Reverse Geocoding ---');
  const testLat = 28.6139;
  const testLng = 77.2090;
  console.log(`Calling Nominatim for: (${testLat}, ${testLng})...`);

  try {
    const geoRes1 = await reverseGeocode(testLat, testLng);
    console.log('Response:');
    console.log(`  Success:  ${geoRes1.success}`);
    console.log(`  Cached:   ${geoRes1.cached}`);
    console.log(`  Address:  "${geoRes1.address}"`);

    if (geoRes1.success && geoRes1.address && !geoRes1.cached) {
      console.log('  PASSED: Live geocoding returned valid address from provider.\n');
    } else {
      console.error('  FAILED: Geocoding response invalid.');
      process.exit(1);
    }

    // -------------------------------------------------------------
    // 4. CACHE TEST: Immediate repeat lookup
    // -------------------------------------------------------------
    console.log('--- 4. CACHE TEST: Repeat Geocode Lookup ---');
    console.log(`Calling reverseGeocode again for: (${testLat}, ${testLng})...`);
    const geoRes2 = await reverseGeocode(testLat, testLng);
    console.log(`  Success:  ${geoRes2.success}`);
    console.log(`  Cached:   ${geoRes2.cached}`);
    console.log(`  Address:  "${geoRes2.address}"`);

    const stats = getCacheStats();
    console.log(`  Cache Stats: ${stats.cachedEntries} cached entry (${stats.keys.join(', ')})`);

    if (geoRes2.cached === true && geoRes2.address === geoRes1.address) {
      console.log('  PASSED: Second call served from in-memory cache.\n');
    } else {
      console.error('  FAILED: Cache was not utilized.');
      process.exit(1);
    }
  } catch (err) {
    console.error('  FAILED: Reverse geocoding network/provider call failed:', err.message);
    process.exit(1);
  }

  // -------------------------------------------------------------
  // 5. DATABASE PROTECTION VERIFICATION
  // -------------------------------------------------------------
  console.log('--- 5. DATABASE SAFETY INSPECTION ---');
  await connectDB();

  const count = await Pothole.countDocuments();
  const pot1 = await Pothole.findOne({ potholeId: 'POT-000001' }).lean();
  const pot3 = await Pothole.findOne({ potholeId: 'POT-000003' }).lean();

  console.log(`Total Pothole Records: ${count}`);
  console.log(`POT-000001: address="${pot1?.address}"`);
  console.log(`POT-000003: address="${pot3?.address}"`);

  if (count === 3 && pot1 && pot3) {
    console.log('  PASSED: Database records and counts remain intact.\n');
  } else {
    console.error('  FAILED: Database anomaly detected!');
    process.exit(1);
  }

  console.log('==============================================================');
  console.log('             ALL GEOCODING TESTS PASSED!                      ');
  console.log('==============================================================');

  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
