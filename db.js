// db.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI, {
  // useNewUrlParser: true,
  // useUnifiedTopology: true,
  ssl: true,
  serverSelectionTimeoutMS: 30000
});

let db;
let collection;

export async function connectDB() {
  try {
    await client.connect();
    db = client.db("ev_chargers");
    collection = db.collection("stations");
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
}

export function getCollection() {
  if (!collection) {
    throw new Error("❌ Database not connected. Call connectDB first.");
  }
  return collection;
}
