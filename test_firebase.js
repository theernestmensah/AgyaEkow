const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

// Load local .env configuration synchronously if present
const ROOT = ".";
try {
  const envPath = path.join(ROOT, ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex !== -1) {
        const key = trimmed.substring(0, equalIndex).trim();
        let value = trimmed.substring(equalIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }
} catch (err) {
  console.warn("Could not load local .env file:", err);
}

let serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!serviceAccountPath) {
  try {
    const files = fs.readdirSync(ROOT);
    const keyFile = files.find(file => file.endsWith(".json") && file.includes("firebase-adminsdk"));
    if (keyFile) {
      serviceAccountPath = path.join(ROOT, keyFile);
    }
  } catch (_) {}
}

console.log("Service Account Path:", serviceAccountPath);

try {
  if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath)
    });
    console.log("Initialized using JSON cert.");
  } else {
    console.log("JSON cert not found, trying env variables.");
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey })
    });
  }

  const db = admin.firestore();
  console.log("Attempting to read doc meta/candles...");
  db.doc("meta/candles").get()
    .then(doc => {
      console.log("Exists:", doc.exists);
      if (doc.exists) {
        console.log("Data:", doc.data());
      } else {
        console.log("Document does not exist.");
      }
      process.exit(0);
    })
    .catch(err => {
      console.error("Error reading meta/candles:", err);
      process.exit(1);
    });
} catch (err) {
  console.error("Initialization error:", err);
  process.exit(1);
}
