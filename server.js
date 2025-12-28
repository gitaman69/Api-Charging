// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import polyline from "@mapbox/polyline";
import * as turf from "@turf/turf";
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
    await redisClient.set(cacheKey, JSON.stringify(normalized), "EX", 300);

    res.json(normalized);
  } catch (err) {
    console.error("❌ /stations error:", err);
    res.status(500).json({ error: "Failed to fetch stations" });
  }
});

// // ---------------------- Trip Planner ---------------------------
// app.post("/trip-planner", async (req, res) => {
//   try {
//     const { origin, destination, bufferKm = 2 } = req.body;
//     if (!origin || !destination) {
//       return res.status(400).json({ error: "origin and destination are required" });
//     }

//     // Cache key
//     const cacheKey = `trip:${origin}:${destination}:${bufferKm}`;
//     const cached = await redisClient.get(cacheKey);
//     if (cached) {
//       console.log("⚡ Serving trip from Redis cache");
//       return res.json(JSON.parse(cached));
//     }

//     // 1) Get route from Google Directions API
//     const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
//       origin
//     )}&destination=${encodeURIComponent(destination)}&key=${
//       process.env.GOOGLE
//     }&mode=driving`;

//     const dirResp = await axios.get(directionsUrl);
//     const route = dirResp.data.routes?.[0];
//     console.log(route);

//     if (!route) return res.status(400).json({ error: "No route found" });

//     const encoded = route.overview_polyline.points;
//     const coords = polyline.decode(encoded); // [[lat, lng], ...]
//     const lineCoords = coords.map(([lat, lng]) => [lng, lat]); // GeoJSON order
//     const line = turf.lineString(lineCoords);

//     // 2) Buffer the route
//     const buffer = turf.buffer(line, bufferKm, { units: "kilometers" });

//     // Ensure 2dsphere index exists
//     await getCollection().createIndex({ location: "2dsphere" });

//     // 3) Query stations inside buffer polygon
//     const stations = await getCollection()
//       .find({
//         location: {
//           $geoWithin: { $geometry: buffer.geometry },
//         },
//       })
//       .limit(500) // safety cap
//       .toArray();

//     const normalizedStations = normalizeStations(stations);

//     const response = {
//       route: {
//         polyline: encoded,
//         distanceText: route.legs?.[0]?.distance?.text || null,
//         durationText: route.legs?.[0]?.duration?.text || null,
//       },
//       stations: normalizedStations,
//     };

//     // Cache for 10 minutes
//     await redisClient.set(cacheKey, JSON.stringify(response), "EX", 600);

//     res.json(response);
//   } catch (err) {
//     console.error("❌ /trip-planner error:", err.response?.data || err.message);
//     res.status(500).json({ error: "Trip planner failed" });
//   }
// });
// ---------------------- Smart Traffic-Aware Trip Planner ----------------------
app.post("/trip-planner", async (req, res) => {
  try {
    const { origin, destination, bufferKm = 2 } = req.body;

    // Validate first
    if (!origin || !destination) {
      return res.status(400).json({ error: "origin and destination required" });
    }

    // cacheKey
    const cacheKey = `smartTrip:${origin}:${destination}:${bufferKm}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    // Google Directions with traffic + alternatives
    const directionsUrl =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}` +
      `&departure_time=now&traffic_model=best_guess&alternatives=true` +
      `&key=${process.env.GOOGLE}`;

    // console.log("Directions URL:", directionsUrl);

    const { data } = await axios.get(directionsUrl);
    if (!data.routes || !data.routes.length) {
      return res.status(400).json({ error: "No route found" });
    }

    await getCollection().createIndex({ location: "2dsphere" });

    const results = [];

    for (const route of data.routes) {
      const poly = route.overview_polyline.points;
      const leg = route.legs[0];

      const coords = polyline.decode(poly).map(([lat, lng]) => [lng, lat]);
      const line = turf.lineString(coords);
      const buffer = turf.buffer(line, bufferKm, { units: "kilometers" });

      const stations = await getCollection()
        .find({ location: { $geoWithin: { $geometry: buffer.geometry } } })
        .toArray();

      results.push({
        polyline: poly,
        distance: leg.distance.text,
        baseTime: leg.duration.value,
        trafficTime: leg.duration_in_traffic.value,
        congestionDelay: leg.duration_in_traffic.value - leg.duration.value,
        stationCount: stations.length,
        stations: normalizeStations(stations),
      });
    }

    //  Rank best route (BASIC)
    results.sort((a, b) => {
      const scoreA = a.trafficTime - a.stationCount * 60;
      const scoreB = b.trafficTime - b.stationCount * 60;
      return scoreA - scoreB;
    });

    const response = {
  route: {
    polyline: results[0].polyline,
    distanceText: results[0].distance,
    durationText: results[0].trafficTime
      ? `${Math.round(results[0].trafficTime / 60)} mins`
      : null,
    baseDurationText: results[0].baseTime
      ? `${Math.round(results[0].baseTime / 60)} mins`
      : null,
    congestionDelay: results[0].congestionDelay || 0,
  },
  stations: results[0].stations,
  alternatives: results.slice(1, 3).map((alt) => ({
    polyline: alt.polyline,
    distanceText: alt.distance,
    durationText: alt.trafficTime
      ? `${Math.round(alt.trafficTime / 60)} mins`
      : null,
    baseDurationText: alt.baseTime
      ? `${Math.round(alt.baseTime / 60)} mins`
      : null,
    congestionDelay: alt.congestionDelay || 0,
    stations: alt.stations,
  })),
};

    await redisClient.set(cacheKey, JSON.stringify(response), "EX", 600);
    res.json(response);
  } catch (err) {
    console.error("❌ Trip planner error:", err.message);
    res.status(500).json({ error: "Smart Trip Planner failed" });
  }
});
// Smart Suggestion of Address (autocomplete)
app.get("/destination-suggestions", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const cacheKey = `destSuggest:${q.toLowerCase()}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));

    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&types=geocode&key=${process.env.GOOGLE}`;
    const { data } = await axios.get(url);

    if (!data.predictions) return res.json([]);
    // Return only the description (full address/landmark)
    const suggestions = data.predictions.map(p => p.description);

    //cache for 10min
    await redisClient.set(cacheKey, JSON.stringify(suggestions), "EX", 600);

    res.json(suggestions);
  } catch (err) {
    console.error("❌ /destination-suggestions error:", err.message);
    res.status(500).json({ error: "Failed to fetch destination suggestions" });
  }
});

// // --------LOCAL SERVER BOOT (for development)--------
// if (process.env.NODE_ENV !== "production") {
//   connectDB().then(() => {
//     app.listen(PORT, () => {
//       console.log(`🚀 Server running on http://localhost:${PORT}`);
//     });
//   });
// }

// ---------------------- Boot for Vercel Serverless ----------------------
export default async function handler(req, res) {
  // Ensure DB is connected for this invocation
  await connectDB();

  // Forward the request to your existing Express app
  app(req, res);
}