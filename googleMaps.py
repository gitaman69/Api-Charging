import os
import requests
import pymongo
from datetime import datetime
import time
from dotenv import load_dotenv

# ✅ Load environment variables from .env
load_dotenv()

# ✅ Get secrets from environment
MONGO_URI = os.getenv("MONGO_URI")
API_KEY = os.getenv("GOOGLE")

# ✅ MongoDB Connection
client = pymongo.MongoClient(MONGO_URI)
try:
    client.admin.command('ismaster')
    print("✅ MongoDB connection successful.")
except Exception as e:
    print("❌ MongoDB connection failed:", e)

db = client.ev_chargers
collection = db.stations

places_url = "https://places.googleapis.com/v1/places:searchNearby"

headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": API_KEY,
    "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress,places.id"
}

# ✅ Major Indian cities with lat/lng
cities = {
    "Delhi": (28.6139, 77.2090),
    "Mumbai": (19.0760, 72.8777),
    "Bangalore": (12.9716, 77.5946),
    "Hyderabad": (17.3850, 78.4867),
    "Chennai": (13.0827, 80.2707),
    "Jaipur": (26.9124, 75.7873),
    "Ahmedabad": (23.0225, 72.5714),
}

# 🔁 Offset coordinates around center city (in degrees)
offsets = [-0.1, 0, 0.1]  # 3x3 grid for each city
RADIUS = 10000  # meters (10km per point)
MAX_RESULTS = 20

inserted_total = 0

for city, (lat_center, lng_center) in cities.items():
    print(f"\n🌆 Scanning {city}...")
    for dlat in offsets:
        for dlng in offsets:
            lat = lat_center + dlat
            lng = lng_center + dlng

            payload = {
                "includedTypes": ["electric_vehicle_charging_station"],
                "maxResultCount": MAX_RESULTS,
                "locationRestriction": {
                    "circle": {
                        "center": {"latitude": lat, "longitude": lng},
                        "radius": RADIUS
                    }
                }
            }

            try:
                response = requests.post(places_url, headers=headers, json=payload)
                response.raise_for_status()
                results = response.json().get("places", [])
            except Exception as e:
                print(f"❌ API error at {lat},{lng} in {city}:", e)
                continue

            print(f"📍 {len(results)} stations at {round(lat, 3)}, {round(lng, 3)}")

            for place in results:
                if not place.get("id"):
                    continue

                station = {
                    "name": place.get("displayName", {}).get("text", "Unknown"),
                    "address": place.get("formattedAddress"),
                    "latitude": place["location"]["latitude"],
                    "longitude": place["location"]["longitude"],
                    "provider": "Ather Grid",  # Customize this if needed
                    "source": "GooglePlacesV1",
                    "place_id": place["id"],
                    "last_updated": datetime.utcnow()
                }

                result = collection.update_one(
                    {"place_id": station["place_id"]},
                    {"$set": station},
                    upsert=True
                )
                if result.upserted_id:
                    print("➕ Inserted:", station["name"])
                    inserted_total += 1

            time.sleep(1)  # ⏳ Respect rate limits

print(f"\n✅ Total new stations inserted: {inserted_total}")
print(f"📊 Total 'Ather Grid' stations in DB: {collection.count_documents({'provider': 'Ather Grid'})}")
