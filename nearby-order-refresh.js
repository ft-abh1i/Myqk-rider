import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "10.12.5";
const MIN_REFRESH_MS = 20_000;
const MIN_MOVEMENT_METERS = 25;

let lastLocation = null;
let lastRefreshAt = 0;

function radians(value) {
  return value * Math.PI / 180;
}

function distanceMeters(from, to) {
  if (!from || !to) return Infinity;
  const lat1 = Number(from.latitude ?? from.lat);
  const lon1 = Number(from.longitude ?? from.lng);
  const lat2 = Number(to.latitude ?? to.lat);
  const lon2 = Number(to.longitude ?? to.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function refreshNearbyOrders(location) {
  const toggle = document.querySelector("#online-toggle");
  const activeOrderVisible = !document.querySelector("#active-order-card")?.classList.contains("hidden");
  if (!toggle?.checked || activeOrderVisible) return;

  const elapsed = Date.now() - lastRefreshAt;
  const moved = distanceMeters(lastLocation, location);
  if (elapsed < MIN_REFRESH_MS && moved < MIN_MOVEMENT_METERS) return;

  lastLocation = location;
  lastRefreshAt = Date.now();
  toggle.dispatchEvent(new Event("change", { bubbles: true }));

  window.setTimeout(() => {
    const toast = document.querySelector("#toast");
    if (toast?.textContent === "You are now online.") toast.className = "toast";
  }, 80);
}

async function initialize() {
  try {
    const appModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const authModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
    const firestoreModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
    const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
    const auth = authModule.getAuth(app);
    const db = firestoreModule.getFirestore(app);

    authModule.onAuthStateChanged(auth, (user) => {
      if (!user) return;
      firestoreModule.onSnapshot(firestoreModule.doc(db, "riders", user.uid), (snapshot) => {
        const location = snapshot.data()?.location;
        if (!location) return;
        refreshNearbyOrders(location);
      }, (error) => console.error("Nearby order refresh listener failed:", error));
    });
  } catch (error) {
    console.error("Nearby order refresh module failed:", error);
  }
}

initialize();
