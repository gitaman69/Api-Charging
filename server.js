// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB, getCollection } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to DB first, then start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});

// Routes
app.get("/", (req, res) => {
  res.json({ message: "EV Charger API is running" });
});

app.get("/all-stations", async (req, res) => {
  try {
    const stations = await getCollection().find(
      {},
      {
        projection: {
          _id: 1,
          name: 1,
          latitude: 1,
          longitude: 1,
          address: 1,
          provider: 1,
          source: 1
        }
      }
    ).toArray();

    res.json(stations.map(s => ({ ...s, _id: s._id.toString() })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stations" });
  }
});

app.get("/stations", async (req, res) => {
  try {
    const { provider, source, lat, lon, limit = 50 } = req.query;

    const query = {};
    if (provider) query.provider = provider;
    if (source) query.source = source;

    if (lat && lon) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);
      query.latitude = { $gte: latitude - 0.1, $lte: latitude + 0.1 };
      query.longitude = { $gte: longitude - 0.1, $lte: longitude + 0.1 };
    }

    const stations = await getCollection().find(query).limit(Number(limit)).toArray();
    res.json(stations.map(s => {
      const { last_updated, ...rest } = s;
      return { ...rest, _id: s._id.toString() };
    }));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stations" });
  }
});
