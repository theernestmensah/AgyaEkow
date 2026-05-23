const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

// Load local .env configuration synchronously if present
try {
  const envPath = fs.existsSync(path.join(__dirname, ".env"))
    ? path.join(__dirname, ".env")
    : path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex !== -1) {
        const key = trimmed.substring(0, equalIndex).trim();
        let value = trimmed.substring(equalIndex + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        // Do not overwrite existing environment variables
        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }
} catch (err) {
  console.warn("Could not load local .env file:", err);
}

const PORT = Number(process.env.PORT || 4173);
const ROOT = path.resolve(__dirname, "..");

let firebaseAdminInitialized = false;
let db;

function initFirebaseAdmin() {
  if (firebaseAdminInitialized) return;
  
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

  try {
    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath)
      });
      firebaseAdminInitialized = true;
      db = admin.firestore();
      console.log(`Firebase Admin initialized using credential file: ${path.basename(serviceAccountPath)}`);
      seedFirestoreIfNeeded();
    } else {
      let projectId = process.env.FIREBASE_PROJECT_ID;
      let clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;

      // Helper to strip surrounding quotes
      const stripQuotes = (str) => {
        if (!str) return str;
        str = str.trim();
        if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
          return str.slice(1, -1);
        }
        return str;
      };

      projectId = stripQuotes(projectId);
      clientEmail = stripQuotes(clientEmail);
      privateKey = stripQuotes(privateKey);

      if (projectId && clientEmail && privateKey) {
        // Correct escaping of newlines in private key
        const formattedPrivateKey = privateKey.replace(/\\n/g, "\n");
        admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            privateKey: formattedPrivateKey
          })
        });
        firebaseAdminInitialized = true;
        db = admin.firestore();
        console.log(`Firebase Admin initialized using environment variables for Project: ${projectId}`);
        seedFirestoreIfNeeded();
      } else if (projectId) {
        admin.initializeApp({
          projectId: projectId
        });
        firebaseAdminInitialized = true;
        db = admin.firestore();
        console.log(`Firebase Admin initialized with Project ID (Local/Google environment fallback): ${projectId}`);
        seedFirestoreIfNeeded();
      } else {
        console.warn("Warning: Firebase Admin SDK was not initialized. Verify token functionality will fail. Please set GOOGLE_APPLICATION_CREDENTIALS, or FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY/FIREBASE_PROJECT_ID.");
      }
    }
  } catch (error) {
    console.error("Error initializing Firebase Admin SDK:", error);
  }
}

const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const VIDEO_UPLOADS_DIR = path.join(UPLOADS_DIR, "videos");
const PHOTO_UPLOADS_DIR = path.join(UPLOADS_DIR, "photos");
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-this-review-key";
const ALLOWED_ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "eanmensah@gmail.com,uriahmensah@gmail.com")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
);
const FIREBASE_WEB_CONFIG = {
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.FIREBASE_PROJECT_ID || "",
  appId: process.env.FIREBASE_APP_ID || ""
};
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_PUBLIC_BASE_URL = String(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/$/, "");
const R2_ENDPOINT = R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "";

const seedTributes = [];

async function seedFirestoreIfNeeded() {
  try {
    const tributesRef = db.collection("tributes");
    const snapshot = await tributesRef.limit(1).get();
    if (snapshot.empty && seedTributes.length > 0) {
      console.log("Seeding Firestore with default tributes...");
      const batch = db.batch();
      for (const t of seedTributes) {
        const docRef = tributesRef.doc(t.id);
        batch.set(docRef, {
          name: t.name,
          relationship: t.relationship,
          message: t.message,
          status: "approved",
          date: t.date,
          createdAt: t.createdAt
        });
      }
      await batch.commit();
      console.log("Firestore seeding completed.");
    }
  } catch (error) {
    console.error("Error seeding Firestore:", error);
  }
}

async function getCandleCount() {
  const doc = await db.doc("meta/candles").get();
  if (!doc.exists) return 0;
  return doc.data().count || 0;
}

async function incrementCandleCount() {
  const docRef = db.doc("meta/candles");
  let nextCount = 1;
  await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(docRef);
    if (!doc.exists) {
      transaction.set(docRef, { count: 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    } else {
      nextCount = (doc.data().count || 0) + 1;
      transaction.update(docRef, { count: nextCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  });
  return nextCount;
}

function firestoreCollectionForType(type) {
  if (type === "tribute") return "tributes";
  if (type === "video") return "videoTributes";
  if (type === "photo") return "photos";
  if (type === "condolence") return "condolences";
  return null;
}

async function fetchSubmissions(status) {
  const queryCollection = async (colName, type) => {
    let q = db.collection(colName);
    if (status) {
      q = q.where("status", "==", status);
    }
    const snapshot = await q.get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      type,
      ...doc.data()
    }));
  };

  const [tributes, videos, photos, condolences] = await Promise.all([
    queryCollection("tributes", "tribute"),
    queryCollection("videoTributes", "video"),
    queryCollection("photos", "photo"),
    queryCollection("condolences", "condolence")
  ]);

  return [...tributes, ...videos, ...photos, ...condolences].sort((a, b) => 
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v"
};

function ensureUploadDirs() {
  try {
    fs.mkdirSync(VIDEO_UPLOADS_DIR, { recursive: true });
    fs.mkdirSync(PHOTO_UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.warn("Warning: Could not create local upload directories (expected on read-only environments like Vercel):", err.message);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function readBody(req, maxBytes = 1024 * 64) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(Object.assign(new Error("Payload too large"), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function cleanText(value, maxLength) {
  const str = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (maxLength !== undefined) {
    return str.slice(0, maxLength);
  }
  return str;
}

function r2Enabled() {
  return Boolean(R2_ACCOUNT_ID && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}

function sha256(value, encoding = "hex") {
  return crypto.createHash("sha256").update(value).digest(encoding);
}

function encodeR2Key(key) {
  return String(key).split("/").map(segment => encodeURIComponent(segment)).join("/");
}

function r2SigningKey(dateStamp) {
  const kDate = hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function r2SignedRequest({ method, key, body = Buffer.alloc(0), contentType = "application/octet-stream" }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const payloadHash = sha256(body);
  const canonicalUri = `/${R2_BUCKET}/${encodeR2Key(key)}`;
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };

  if (contentType) headers["content-type"] = contentType;

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(header => `${header}:${headers[header]}\n`)
    .join("");
  const canonicalRequest = [
    method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const signature = hmac(r2SigningKey(dateStamp), stringToSign, "hex");

  return {
    url: `${R2_ENDPOINT}${canonicalUri}`,
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  };
}

async function putR2Object(key, buffer, contentType) {
  const request = r2SignedRequest({ method: "PUT", key, body: buffer, contentType });
  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body: buffer
  });
  if (!response.ok) {
    throw new Error(`R2 upload failed with status ${response.status}.`);
  }
}

async function deleteR2Object(key) {
  const request = r2SignedRequest({ method: "DELETE", key, contentType: "" });
  const response = await fetch(request.url, {
    method: "DELETE",
    headers: request.headers
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed with status ${response.status}.`);
  }
}

async function getR2Object(key) {
  const request = r2SignedRequest({ method: "GET", key, contentType: "" });
  return fetch(request.url, {
    method: "GET",
    headers: request.headers
  });
}

async function storeMediaObject({ kind, storedName, buffer, mimeType }) {
  const objectKey = `${kind}/${storedName}`;

  if (r2Enabled()) {
    await putR2Object(objectKey, buffer, mimeType);
    return {
      storage: "r2",
      objectKey,
      url: R2_PUBLIC_BASE_URL ? `${R2_PUBLIC_BASE_URL}/${objectKey}` : `/media/${objectKey}`
    };
  }

  const directory = kind === "videos" ? VIDEO_UPLOADS_DIR : PHOTO_UPLOADS_DIR;
  fs.writeFileSync(path.join(directory, storedName), buffer);
  return {
    storage: "local",
    objectKey,
    url: `/uploads/${objectKey}`
  };
}

function videoExtension(fileName, mimeType) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if ([".mp4", ".webm", ".mov", ".m4v"].includes(ext)) return ext;
  if (mimeType === "video/webm") return ".webm";
  if (mimeType === "video/quicktime") return ".mov";
  if (mimeType === "video/x-m4v") return ".m4v";
  return ".mp4";
}

function parseBase64Video(data) {
  const value = String(data || "");
  const match = value.match(/^data:(video\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64")
  };
}

function parseBase64Image(data) {
  const value = String(data || "");
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64")
  };
}

function imageExtension(fileName, mimeType) {
  const ext = path.extname(String(fileName || "")).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function approvedOnly(items) {
  return items.filter(item => item.status === "approved");
}

function base64UrlToJson(value) {
  try {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch (_) {
    return null;
  }
}

async function requireAdmin(req, res) {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  
  if (match) {
    const idToken = match[1];
    if (firebaseAdminInitialized) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const email = String(decodedToken.email || "").toLowerCase();
        if (email && ALLOWED_ADMIN_EMAILS.has(email)) {
          return true;
        }
        sendJson(res, 403, { error: "This Google account is not an approved admin." });
        return false;
      } catch (error) {
        console.error("Firebase token verification failed:", error.message);
        sendJson(res, 401, { error: "Invalid Google login session." });
        return false;
      }
    } else {
      console.error("Authorization rejected: Firebase Admin SDK is not initialized.");
      sendJson(res, 500, { error: "Authentication system configuration error." });
      return false;
    }
  }

  const token = req.headers["x-admin-token"];
  if (!ADMIN_TOKEN || ADMIN_TOKEN === "change-this-review-key" || token !== ADMIN_TOKEN) {
    sendJson(res, 401, { error: "Approved Google admin login is required." });
    return false;
  }
  return true;
}

// Local database functions submissionList and collectionForType removed

async function deleteUploadIfRejected(item) {
  if (item.storage === "r2" && item.objectKey) {
    await deleteR2Object(item.objectKey);
    return;
  }

  const publicPath = item.videoUrl || item.imageUrl;
  if (!publicPath || !publicPath.startsWith("/uploads/")) return;
  const filePath = path.normalize(path.join(ROOT, publicPath));
  if (!filePath.startsWith(UPLOADS_DIR)) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

function isApiPath(pathname) {
  return pathname === "/api/config" ||
    pathname === "/api/health" ||
    pathname === "/api/tributes" ||
    pathname === "/api/video-tributes" ||
    pathname === "/api/photos" ||
    pathname === "/api/condolences" ||
    pathname === "/api/admin/submissions" ||
    pathname === "/api/admin/review" ||
    pathname === "/api/candles";
}

async function serveR2Media(req, res, pathname) {
  if (!r2Enabled()) {
    sendText(res, 404, "R2 is not configured.");
    return;
  }

  const objectKey = decodeURIComponent(pathname.replace(/^\/media\//, ""));
  if (!objectKey || objectKey.includes("..") || !/^(photos|videos)\//.test(objectKey)) {
    sendText(res, 404, "Media not found.");
    return;
  }

  try {
    const response = await getR2Object(objectKey);
    if (!response.ok) {
      sendText(res, response.status === 404 ? 404 : 502, "Media not found.");
      return;
    }

    const ext = path.extname(objectKey).toLowerCase();
    const contentType = response.headers.get("content-type") || mimeTypes[ext] || "application/octet-stream";

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": buffer.length,
      "Cache-Control": "public, max-age=3600"
    });
    res.end(buffer);
  } catch (error) {
    console.error("Error serving R2 media:", error);
    sendText(res, 500, "Media unavailable.");
  }
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/config" && req.method === "GET") {
    const requiredKeys = ["apiKey", "authDomain", "projectId", "appId"];
    const configured = requiredKeys.every(key => FIREBASE_WEB_CONFIG[key]);
    if (!configured) {
      return sendJson(res, 503, { error: "Firebase web config is not configured." });
    }
    return sendJson(res, 200, {
      firebase: FIREBASE_WEB_CONFIG,
      adminEmails: Array.from(ALLOWED_ADMIN_EMAILS)
    });
  }

  if (pathname === "/api/health" && req.method === "GET") {
    try {
      const getCounts = async (colName) => {
        const snapshot = await db.collection(colName).get();
        let approved = 0;
        let pending = 0;
        snapshot.forEach(doc => {
          if (doc.data().status === "approved") approved++;
          else if (doc.data().status === "pending") pending++;
        });
        return { approved, pending };
      };

      const [tributesCount, videosCount, photosCount, condolencesCount, candleDoc] = await Promise.all([
        getCounts("tributes"),
        getCounts("videoTributes"),
        getCounts("photos"),
        getCounts("condolences"),
        db.doc("meta/candles").get()
      ]);

      const candlesCount = candleDoc.exists ? (candleDoc.data().count || 0) : 0;

      let rootFiles = [];
      let dirFiles = [];
      try { rootFiles = fs.readdirSync(ROOT); } catch (e) { rootFiles = [e.message]; }
      try { dirFiles = fs.readdirSync(__dirname); } catch (e) { dirFiles = [e.message]; }

      return sendJson(res, 200, {
        ok: true,
        tributes: tributesCount.approved,
        pendingTributes: tributesCount.pending,
        videoTributes: videosCount.approved,
        pendingVideoTributes: videosCount.pending,
        photos: photosCount.approved,
        pendingPhotos: photosCount.pending,
        condolences: condolencesCount.approved,
        pendingCondolences: condolencesCount.pending,
        candles: candlesCount,
        debug: {
          __dirname,
          ROOT,
          rootFiles,
          dirFiles
        }
      });
    } catch (error) {
      console.error("Health check error:", error);
      return sendJson(res, 500, { error: "Failed to fetch health metrics." });
    }
  }

  // All endpoints past this point require Firestore to be initialized
  if (!db) {
    return sendJson(res, 503, { error: "Database not initialized. Please configure credentials." });
  }

  if (pathname === "/api/tributes" && req.method === "GET") {
    try {
      const snapshot = await db.collection("tributes").get();
      const tributes = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(item => item.status === "approved")
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 250);
      return sendJson(res, 200, { tributes });
    } catch (error) {
      console.error("Fetch tributes error:", error);
      return sendJson(res, 500, { error: "Failed to fetch tributes." });
    }
  }

  if (pathname === "/api/tributes" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: "Invalid tribute payload." });
    }

    const name = cleanText(payload.name, 80);
    const relationship = cleanText(payload.relationship, 80);
    const message = cleanText(payload.message);

    if (!name || !message) {
      return sendJson(res, 422, { error: "Name and tribute are required." });
    }

    const tribute = {
      name,
      relationship,
      message,
      status: "pending",
      date: new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date()),
      createdAt: new Date().toISOString()
    };

    try {
      const docRef = await db.collection("tributes").add(tribute);
      return sendJson(res, 201, { tribute: { id: docRef.id, ...tribute }, pending: true });
    } catch (error) {
      console.error("Create tribute error:", error);
      return sendJson(res, 500, { error: "Failed to submit tribute." });
    }
  }

  if (pathname === "/api/condolences" && req.method === "GET") {
    try {
      const snapshot = await db.collection("condolences").get();
      const condolences = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(item => item.status === "approved")
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 500);
      return sendJson(res, 200, { condolences });
    } catch (error) {
      console.error("Fetch condolences error:", error);
      return sendJson(res, 500, { error: "Failed to fetch condolences." });
    }
  }

  if (pathname === "/api/condolences" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: "Invalid condolence payload." });
    }

    const name = cleanText(payload.name, 80);
    const location = cleanText(payload.location, 100);
    const message = cleanText(payload.message);

    if (!name || !message) {
      return sendJson(res, 422, { error: "Name and message are required." });
    }

    const condolence = {
      name,
      location: location || "",
      message,
      status: "pending",
      date: new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date()),
      createdAt: new Date().toISOString()
    };

    try {
      const docRef = await db.collection("condolences").add(condolence);
      return sendJson(res, 201, { condolence: { id: docRef.id, ...condolence }, pending: true });
    } catch (error) {
      console.error("Create condolence error:", error);
      return sendJson(res, 500, { error: "Failed to submit condolence." });
    }
  }

  if (pathname === "/api/video-tributes" && req.method === "GET") {
    try {
      const snapshot = await db.collection("videoTributes").get();
      const videoTributes = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(item => item.status === "approved")
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 100);
      return sendJson(res, 200, { videoTributes });
    } catch (error) {
      console.error("Fetch video tributes error:", error);
      return sendJson(res, 500, { error: "Failed to fetch video tributes." });
    }
  }

  if (pathname === "/api/video-tributes" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req, MAX_VIDEO_BYTES * 2));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: "Invalid video tribute payload." });
    }

    const name = cleanText(payload.name, 80);
    const relationship = cleanText(payload.relationship, 80);
    const message = cleanText(payload.message);
    const parsedVideo = parseBase64Video(payload.videoData);

    if (!name || !parsedVideo) {
      return sendJson(res, 422, { error: "Name and video are required." });
    }

    if (!["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"].includes(parsedVideo.mimeType)) {
      return sendJson(res, 415, { error: "Please upload an MP4, WebM, MOV, or M4V video." });
    }

    if (parsedVideo.buffer.length > MAX_VIDEO_BYTES) {
      return sendJson(res, 413, { error: "Video must be 80MB or smaller." });
    }

    const id = crypto.randomUUID();
    const ext = videoExtension(payload.fileName, parsedVideo.mimeType);
    const storedName = `${id}${ext}`;
    const storedVideo = await storeMediaObject({
      kind: "videos",
      storedName,
      buffer: parsedVideo.buffer,
      mimeType: parsedVideo.mimeType
    });

    const videoTribute = {
      name,
      relationship,
      message,
      videoUrl: storedVideo.url,
      storage: storedVideo.storage,
      objectKey: storedVideo.objectKey,
      mimeType: parsedVideo.mimeType,
      size: parsedVideo.buffer.length,
      status: "pending",
      date: new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date()),
      createdAt: new Date().toISOString()
    };

    try {
      const docRef = await db.collection("videoTributes").add(videoTribute);
      return sendJson(res, 201, { videoTribute: { id: docRef.id, ...videoTribute }, pending: true });
    } catch (error) {
      console.error("Create video tribute error:", error);
      return sendJson(res, 500, { error: "Failed to submit video tribute." });
    }
  }

  if (pathname === "/api/photos" && req.method === "GET") {
    try {
      const snapshot = await db.collection("photos").get();
      const photos = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(item => item.status === "approved")
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
        .slice(0, 300);
      return sendJson(res, 200, { photos });
    } catch (error) {
      console.error("Fetch photos error:", error);
      return sendJson(res, 500, { error: "Failed to fetch photos." });
    }
  }

  if (pathname === "/api/photos" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req, MAX_PHOTO_BYTES * 2));
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: "Invalid photo payload." });
    }

    const name = cleanText(payload.name, 80);
    const caption = cleanText(payload.caption, 180);
    const parsedPhoto = parseBase64Image(payload.photoData);

    if (!parsedPhoto) {
      return sendJson(res, 422, { error: "Photo is required." });
    }

    if (!["image/jpeg", "image/png", "image/webp"].includes(parsedPhoto.mimeType)) {
      return sendJson(res, 415, { error: "Please upload a JPG, PNG, or WebP image." });
    }

    if (parsedPhoto.buffer.length > MAX_PHOTO_BYTES) {
      return sendJson(res, 413, { error: "Photo must be 8MB or smaller." });
    }

    const id = crypto.randomUUID();
    const ext = imageExtension(payload.fileName, parsedPhoto.mimeType);
    const storedName = `${id}${ext}`;
    const storedPhoto = await storeMediaObject({
      kind: "photos",
      storedName,
      buffer: parsedPhoto.buffer,
      mimeType: parsedPhoto.mimeType
    });

    const photo = {
      name,
      caption,
      imageUrl: storedPhoto.url,
      storage: storedPhoto.storage,
      objectKey: storedPhoto.objectKey,
      mimeType: parsedPhoto.mimeType,
      size: parsedPhoto.buffer.length,
      status: "pending",
      date: new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date()),
      createdAt: new Date().toISOString()
    };

    try {
      const docRef = await db.collection("photos").add(photo);
      return sendJson(res, 201, { photo: { id: docRef.id, ...photo }, pending: true });
    } catch (error) {
      console.error("Create photo error:", error);
      return sendJson(res, 500, { error: "Failed to submit photo." });
    }
  }

  if (pathname === "/api/admin/submissions" && req.method === "GET") {
    if (!await requireAdmin(req, res)) return;
    try {
      const status = new URL(req.url, `http://${req.headers.host || "localhost"}`).searchParams.get("status");
      const submissions = await fetchSubmissions(status);
      return sendJson(res, 200, { submissions });
    } catch (error) {
      console.error("Fetch admin submissions error:", error);
      return sendJson(res, 500, { error: "Failed to fetch submissions." });
    }
  }

  if (pathname === "/api/admin/review" && req.method === "POST") {
    if (!await requireAdmin(req, res)) return;
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (error) {
      return sendJson(res, 400, { error: "Invalid review payload." });
    }

    const type = cleanText(payload.type, 20);
    const id = cleanText(payload.id, 80);
    const status = cleanText(payload.status, 20);

    if (!["approved", "rejected"].includes(status)) {
      return sendJson(res, 422, { error: "Review status must be approved or rejected." });
    }

    const colName = firestoreCollectionForType(type);
    if (!colName) return sendJson(res, 400, { error: "Invalid submission type." });

    try {
      const docRef = db.collection(colName).doc(id);
      const doc = await docRef.get();
      if (!doc.exists) return sendJson(res, 404, { error: "Submission not found." });

      const item = doc.data();
      const updatedFields = {
        status,
        reviewedAt: new Date().toISOString()
      };

      await docRef.update(updatedFields);

      if (status === "rejected") {
        await deleteUploadIfRejected(item);
      }

      return sendJson(res, 200, { submission: { id, type, ...item, ...updatedFields } });
    } catch (error) {
      console.error("Review submission error:", error);
      return sendJson(res, 500, { error: "Failed to review submission." });
    }
  }

  if (pathname === "/api/candles" && req.method === "GET") {
    try {
      const count = await getCandleCount();
      return sendJson(res, 200, { count });
    } catch (error) {
      console.error("Get candle count error:", error);
      return sendJson(res, 500, { error: "Failed to fetch candle count." });
    }
  }

  if (pathname === "/api/candles" && req.method === "POST") {
    try {
      const count = await incrementCandleCount();
      return sendJson(res, 201, { count });
    } catch (error) {
      console.error("Increment candle count error:", error);
      return sendJson(res, 500, { error: "Failed to light candle." });
    }
  }

  return sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT) || filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600"
    };
    if (path.basename(filePath) === "admin.html") {
      headers["X-Robots-Tag"] = "noindex, nofollow, noarchive";
    }
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (isApiPath(url.pathname)) {
    handleApi(req, res, url.pathname).catch(error => {
      console.error(error);
      sendJson(res, 500, { error: "Something went wrong." });
    });
    return;
  }

  if (url.pathname.startsWith("/media/")) {
    serveR2Media(req, res, url.pathname).catch(error => {
      console.error(error);
      sendText(res, 500, "Media unavailable.");
    });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  serveStatic(req, res, url.pathname);
});

ensureUploadDirs();
initFirebaseAdmin();

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Ekow Mensah memorial running at http://127.0.0.1:${PORT}`);
  });
} else {
  module.exports = server;
}
