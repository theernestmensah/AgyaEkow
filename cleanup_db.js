const admin = require("firebase-admin");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "ekowmensah-c16a8-firebase-adminsdk-fbsvc-9b268c3d1e.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath)
});

const db = admin.firestore();

async function cleanup() {
  // Delete all tributes
  console.log("Cleaning tributes collection...");
  const tributesSnapshot = await db.collection("tributes").get();
  const batch1 = db.batch();
  tributesSnapshot.forEach(doc => {
    console.log(`Deleting tribute: ${doc.id}`);
    batch1.delete(doc.ref);
  });
  if (!tributesSnapshot.empty) {
    await batch1.commit();
  }
  console.log("Tributes cleaned.");

  // Delete all photos
  console.log("Cleaning photos collection...");
  const photosSnapshot = await db.collection("photos").get();
  const batch2 = db.batch();
  photosSnapshot.forEach(doc => {
    console.log(`Deleting photo doc: ${doc.id}`);
    batch2.delete(doc.ref);
  });
  if (!photosSnapshot.empty) {
    await batch2.commit();
  }
  console.log("Photos cleaned.");

  console.log("Database cleanup completed successfully.");
  process.exit(0);
}

cleanup().catch(err => {
  console.error("Cleanup error:", err);
  process.exit(1);
});
