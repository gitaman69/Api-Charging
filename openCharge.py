import requests, pymongo
from datetime import datetime
from dotenv import load_dotenv
import os

# ✅ Load environment variables from .env
load_dotenv()

OCM_KEY = os.getenv("openCharge")
MONGO_URI = os.getenv("MONGO_URI")

# MongoDB setup
client = pymongo.MongoClient(MONGO_URI)
try:
    client.admin.command('ismaster')
    print("✅ MongoDB connection successful.")
except Exception as e:
    print("❌ MongoDB connection failed:", e)
    exit()

db = client.ev_chargers
collection = db.stations

# Create unique index to prevent duplicates
collection.create_index([("name", 1), ("latitude", 1), ("longitude", 1)], unique=True)

# OpenChargeMap API setup
ocm_url = "https://api.openchargemap.io/v3/poi/"
batch_size = 200
offset = 0
total_inserted = 0
MAX_OFFSET = 20000  # Limit fetching to offset 20000

while offset <= MAX_OFFSET:
    params = {
        "output": "json",
        "countrycode": "IN",
        "maxresults": batch_size,
        "offset": offset,
        "compact": True,
        "verbose": False,
        "key": OCM_KEY
    }

    resp = requests.get(ocm_url, params=params)
    resp.raise_for_status()
    results = resp.json()

    if not results:
        break  # No more data to fetch

    for s in results:
        info = s.get("AddressInfo", {})
        station = {
            "name": info.get("Title"),
            "address": info.get("AddressLine1"),
            "latitude": info.get("Latitude"),
            "longitude": info.get("Longitude"),
            "provider": s.get("OperatorInfo", {}).get("Title", "OpenChargeMap"),
            "source": "OpenChargeMap",
            "last_updated": datetime.utcnow()
        }

        try:
            result = collection.update_one(
                {"name": station["name"], "latitude": station["latitude"], "longitude": station["longitude"]},
                {"$set": station},
                upsert=True
            )
            if result.upserted_id:
                total_inserted += 1
        except pymongo.errors.DuplicateKeyError:
            pass  # Skip duplicates

    print(f"✅ Fetched and upserted {len(results)} entries from offset {offset}")
    offset += batch_size

print("✅ Final MongoDB document count:", collection.count_documents({}))
print("✅ New stations inserted:", total_inserted)
