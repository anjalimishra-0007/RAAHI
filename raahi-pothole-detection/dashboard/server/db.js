import mongoose from 'mongoose';

let isConnected = false;

export async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/raahi';

  try {
    mongoose.set('strictQuery', true);

    mongoose.connection.on('connected', () => {
      isConnected = true;
    });

    mongoose.connection.on('error', (err) => {
      isConnected = false;
      console.error(`[MongoDB] Runtime error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      console.warn('[MongoDB] Disconnected from database.');
    });

    console.log(`[MongoDB] Connecting to: ${uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}...`);
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });

    isConnected = true;
    console.log(`[MongoDB] Connected successfully!`);
    console.log(`          Database: ${conn.connection.name}`);
    console.log(`          Host:     ${conn.connection.host}:${conn.connection.port}`);
    return conn;
  } catch (error) {
    isConnected = false;
    console.error(`==================================================`);
    console.error(`[MongoDB] Connection Failed: ${error.message}`);
    console.error(`[MongoDB] Notice: Running without MongoDB connection.`);
    console.error(`          Ensure MongoDB is running locally (mongodb://localhost:27017)`);
    console.error(`          or configure MONGODB_URI in .env`);
    console.error(`==================================================`);
    return null;
  }
}

export function isDbConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

export function getDbInfo() {
  return {
    connected: isDbConnected(),
    readyState: mongoose.connection.readyState,
    databaseName: mongoose.connection.name || 'raahi',
    host: mongoose.connection.host || null,
    port: mongoose.connection.port || null,
    uriConfigured: Boolean(process.env.MONGODB_URI)
  };
}
