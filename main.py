from fastapi import FastAPI, Query
from typing import Optional, List
from pymongo import MongoClient
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()  # Load from .env file locally, Vercel uses Environment Variables in settings

MONGO_URI = os.getenv("MONGO_URI")

app = FastAPI(title="EV Charging Stations API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Or specify domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# MongoDB connection
client = MongoClient(MONGO_URI)
db = client.ev_chargers
collection = db.stations

# Pydantic model
class Station(BaseModel):
    name: str
    address: Optional[str]
    latitude: float
    longitude: float
    provider: Optional[str]
    source: Optional[str]

@app.get("/")
def root():
    return {"message": "EV Charger API is running"}

@app.get("/all-stations")
def get_all_stations():
    stations = list(collection.find({}, {
        "_id": 1,
        "name": 1,
        "latitude": 1,
        "longitude": 1,
        "address": 1,
        "provider": 1,
        "source": 1
    }))
    # Convert ObjectId to string
    for s in stations:
        s["_id"] = str(s["_id"])
    return stations

@app.get("/stations", response_model=List[Station])
def get_stations(
    provider: Optional[str] = Query(None, description="Filter by provider like 'Ather Grid'"),
    source: Optional[str] = Query(None, description="Filter by data source like 'GooglePlacesV1'"),
    lat: Optional[float] = Query(None, description="Latitude for nearby filtering"),
    lon: Optional[float] = Query(None, description="Longitude for nearby filtering"),
    limit: int = Query(50, ge=1, le=1000, description="Limit the number of results")
):
    query = {}

    if provider:
        query["provider"] = provider
    if source:
        query["source"] = source
    if lat is not None and lon is not None:
        query["latitude"] = {"$gte": lat - 0.1, "$lte": lat + 0.1}
        query["longitude"] = {"$gte": lon - 0.1, "$lte": lon + 0.1}

    stations = list(collection.find(query).limit(limit))

    for s in stations:
        s["_id"] = str(s["_id"])
        s.pop("last_updated", None)

    return JSONResponse(content=stations)

# For Vercel ASGI
app_handler = app