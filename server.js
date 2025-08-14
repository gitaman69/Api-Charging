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
    const { skip = 0, limit = 500 } = req.query;

    const stations = await getCollection()
      .find(
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
      )
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .toArray();

    res.json(stations.map(s => ({ ...s, _id: s._id.toString() })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stations" });
  }
});


app.get("/stations", async (req, res) => {
  try {
    const { provider, source, lat, lon, limit = 20, skip = 0, maxDistance = 5000 } = req.query;

    // Build base filter
    const query = {};
    if (provider) query.provider = provider;
    if (source) query.source = source;

    let cursor;

    if (lat && lon) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);

      // Geospatial filter - make sure you have a 2dsphere index on `location`
      query.location = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude] // GeoJSON uses [lon, lat]
          },
          $maxDistance: parseInt(maxDistance) // in meters
        }
      };

      cursor = getCollection()
        .find(query)
        .skip(parseInt(skip)) // for pagination
        .limit(parseInt(limit));
    } else {
      // If no location provided, just return recent stations
      cursor = getCollection()
        .find(query)
        .skip(parseInt(skip))
        .limit(parseInt(limit));
    }

    const stations = await cursor.toArray();

    res.json(stations.map(s => {
      const { last_updated, ...rest } = s;
      return { ...rest, _id: s._id.toString() };
    }));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch stations" });
  }
});

