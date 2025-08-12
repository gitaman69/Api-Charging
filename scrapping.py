from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
from datetime import datetime
import pymongo
import time

# Setup MongoDB
client = pymongo.MongoClient("mongodb+srv://aman:aman69@evcharging.8t9nhyf.mongodb.net/?retryWrites=true&w=majority&appName=EvCharging")
try:
    client.admin.command('ismaster')
    print("✅ MongoDB connection successful.")
except Exception as e:
    print("❌ MongoDB connection failed:", e)


db = client.ev_chargers
collection = db.stations

# Start headless browser
options = webdriver.ChromeOptions()
options.add_argument("--headless")
driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

# Load page
driver.get("https://www.statiq.in/charging-stations-map")
time.sleep(10)  # wait for JS to load stations

soup = BeautifulSoup(driver.page_source, "html.parser")
driver.quit()

stations = []
for div in soup.select(".station-card"):  # Update this selector after inspecting actual HTML
    name = div.get("data-name")
    lat = float(div["data-lat"])
    lon = float(div["data-lng"])
    address = div.get("data-address")
    station = {
        "name": name,
        "address": address,
        "latitude": lat,
        "longitude": lon,
        "provider": "Statiq",
        "source": "StatiqScrape",
        "last_updated": datetime.utcnow()
    }
    stations.append(station)

for s in stations:
    collection.update_one(
        {"name": s["name"], "latitude": s["latitude"], "longitude": s["longitude"]},
        {"$set": s}, upsert=True
    )

print("✅ Added Statiq stations:", db.stations.count_documents({"provider": "Statiq"}))
