// redisClient.js
import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();


// Use the full connection string from .env
const client = new Redis(process.env.REDIS_URL);

client.on("connect", () => {
  console.log("✅ Connected to Upstash Redis");
});

client.on("error", (err) => {
  console.error("❌ Redis Client Error:", err);
});

export default client;
