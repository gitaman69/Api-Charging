import fetch from "node-fetch";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const client = new MongoClient(process.env.MONGODB_URI);

// declare globally
let stations;

async function connectDB() {
  await client.connect();
  const db = client.db("ev_chargers"); // ✅ correct database
  stations = db.collection("stations"); // ✅ correct collection
}

async function fetchStation(id) {
  const res = await fetch(
    "https://evyatra.beeindia.gov.in/bee-ev-backend/getPCSdetailsbystationid",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ station_id: id }),
    }
  );

  const data = await res.json();
  if (!data.value) return null;

  const station = data.value;

  // Deduplication check
  const existing = await stations.findOne({
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [station.lng, station.lat] },
        $maxDistance: 100, // meters
      },
    },
  });

  const doc = {
    _id: "bee-" + station.id,
    name: station.station_name,
    address: station.address,
    latitude: station.lat,
    longitude: station.lng,
    provider: station.companyname,
    source: "BEE",
    last_updated: new Date(),
    location: {
      type: "Point",
      coordinates: [station.lng, station.lat],
    },
    city: station.city_name,
    is_24x7: station.is_tweenty_four_seven === "t",
    is_fourwheeler: station.is_fourwheeler,
    chargers: station.charger.map((c) => ({
      id: c.id,
      chargerType: c.chargerType,
      ratedCapacity_kW: c.ratedCapacity,
      power_type: c.power_type,
      status: c.wkStatus,
      tariff_rate: c.tariff_rate,
    })),
  };

  if (existing) {
    await stations.updateOne(
      { _id: existing._id },
      {
        $addToSet: { chargers: { $each: doc.chargers } },
        $set: { source: existing.source + ",BEE" },
      }
    );
  } else {
    await stations.insertOne(doc);
  }
}

async function main() {
  try {
    await connectDB();

    for (let i = 26248; i <= 26367; i++) {
      try {
        await fetchStation(i);
        console.log(`Loaded station ${i}`);
      } catch (e) {
        console.error("Error on station", i, e);
      }
    }
  } finally {
    await client.close();
  }
}

main();
