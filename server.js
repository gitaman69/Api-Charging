// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB, getCollection } from "./db.js";
import redisClient from "./redisClient.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

// ---------------------- Utils ----------------------
export function normalizeStation(station) {
  if (!station) return null;
  return {
    _id: station._id?.toString?.() || String(station._id || ""),
    name: station.name || "Unknown Station",
    latitude: station.latitude ?? station.location?.coordinates?.[1] ?? null,
    longitude: station.longitude ?? station.location?.coordinates?.[0] ?? null,
    address: station.address || "Address not available",
    provider: station.provider || "Unknown Provider",
    source: station.source || null,
    last_updated: station.last_updated || null,
    location: station.location || null,
    chargers: station.chargers || [],
    city: station.city || null,
    is_24x7: station.is_24x7 ?? null,
    is_fourwheeler: station.is_fourwheeler ?? null,
  };
}

export function normalizeStations(stations) {
  if (!Array.isArray(stations)) return [];
  return stations
    .map(normalizeStation)
    .filter(
      (s) =>
        s &&
        s._id &&
        typeof s.latitude === "number" &&
        typeof s.longitude === "number" &&
        !isNaN(s.latitude) &&
        !isNaN(s.longitude)
    );
}

// ---------------------- Routes ----------------------
app.get("/", (_, res) => {
  res.json({ message: "⚡ EV Charger API is running" });
});

// Paginated fetch of all stations
app.get("/all-stations", async (req, res) => {
  try {
    const skip = parseInt(req.query.skip) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);

    const stations = await getCollection()
      .find({}, { projection: { _id: 1, name: 1, latitude: 1, longitude: 1, address: 1, provider: 1, source: 1, location: 1, chargers: 1, city: 1, is_24x7: 1, is_fourwheeler: 1 } })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json(normalizeStations(stations));
  } catch (err) {
    console.error("❌ /all-stations error:", err);
    res.status(500).json({ error: "Failed to fetch stations" });
  }
});

// Nearest 25 stations route (rewritten)
app.get("/nearest-stations", async (req, res) => {
  try {
    const { lat, lon, maxDistance } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: "Missing lat or lon" });

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lon);
    const maxDist = parseInt(maxDistance) || 25000; // default 25 km

    // Ensure 2dsphere index exists (run once in DB or via code)
    await getCollection().createIndex({ location: "2dsphere" });

    const stations = await getCollection()
      .aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [longitude, latitude] },
            distanceField: "distance",
            spherical: true,
            maxDistance: maxDist,
          },
        },
        { $limit: 25 },
      ])
      .toArray();

    res.json(normalizeStations(stations));
  } catch (err) {
    console.error("❌ /nearest-stations error:", err);
    res.status(500).json({ error: "Failed to fetch nearest stations" });
  }
});


// Existing filtered stations route
app.get("/stations", async (req, res) => {
  try {
    const { provider, source, lat, lon } = req.query;
    const skip = parseInt(req.query.skip) || 0;

    // ⬇️ Only apply limit if user explicitly requests it
    const limit = req.query.limit ? Math.min(parseInt(req.query.limit), 200) : 0;

    const maxDistance = parseInt(req.query.maxDistance) || 5000;

    const query = {};
    if (provider) query.provider = provider;
    if (source) query.source = source;

    if (lat && lon) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);

      query.location = {
        $near: {
          $geometry: { type: "Point", coordinates: [longitude, latitude] },
          $maxDistance: maxDistance,
        },
      };
    }

    // Generate a cache key based on query parameters
    const cacheKey = `stations:${JSON.stringify({
      provider,
      source,
      lat,
      lon,
      skip,
      limit,
      maxDistance,
    })}`;

    // 🔹 Try fetching from Redis cache
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log("⚡ Serving from Redis cache");
      return res.json(JSON.parse(cachedData));
    }

    // 🔹 If not cached, fetch from MongoDB
    let cursor = getCollection().find(query).skip(skip);

    if (limit > 0) {
      cursor = cursor.limit(limit);
    }

    const stations = await cursor.toArray();
    const normalized = normalizeStations(stations);

    // 🔹 Store in Redis cache (expire in 5 minutes)
    await redisClient.setEx(cacheKey, 300, JSON.stringify(normalized));

    res.json(normalized);
  } catch (err) {
    console.error("❌ /stations error:", err);
    res.status(500).json({ error: "Failed to fetch stations" });
  }
});


// ---------------------- Start Server ----------------------
const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
  }
};

startServer();
