import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "10.12.5";
const UPDATE_INTERVAL_MS = 25_000;
const MIN_MOVEMENT_METERS = 40;
const ACTIVE_STATUSES = ["accepted", "arrived_pickup", "picked_up"];

const state = {
  auth: null,
  db: null,
  api: null,
  user: null,
  watchId: null,
  heartbeatId: null,
  lastPosition: null,
  lastWriteAt: 0,
  writing: false,
  pendingPosition: null
};

function radians(value) {
  return value * Math.PI / 180;
}

function distanceMeters(from, to) {
  if (!from || !to) return Infinity;
  const lat1 = Number(from.latitude);
  const lon1 = Number(from.longitude);
  const lat2 = Number(to.latitude);
  const lon2 = Number(to.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function currentReadableAddress() {
  const value = globalThis.myQkRiderLocationAddress;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof state.lastPosition?.address === "string" && state.lastPosition.address.trim()) {
    return state.lastPosition.address.trim();
  }
  return "";
}

function normalizedPosition(position) {
  const location = {
    latitude: Number(position.coords.latitude.toFixed(6)),
    longitude: Number(position.coords.longitude.toFixed(6)),
    accuracy: Math.round(position.coords.accuracy || 0),
    heading: Number.isFinite(position.coords.heading) ? Math.round(position.coords.heading) : null,
    speed: Number.isFinite(position.coords.speed) ? Number(position.coords.speed.toFixed(2)) : null
  };

  const address = currentReadableAddress();
  if (address) location.address = address;
  return location;
}

function shouldTrack() {
  const online = Boolean(document.querySelector("#online-toggle")?.checked);
  const activeCardVisible = !document.querySelector("#active-order-card")?.classList.contains("hidden");
  return Boolean(state.user && (online || activeCardVisible));
}

async function findActiveOrderRef() {
  const ordersQuery = state.api.query(
    state.api.collection(state.db, "orders"),
    state.api.where("assignedRiderId", "==", state.user.uid),
    state.api.limit(20)
  );
  const snapshot = await state.api.getDocs(ordersQuery);
  const active = snapshot.docs.find((item) => ACTIVE_STATUSES.includes(item.data().status));
  return active ? state.api.doc(state.db, "orders", active.id) : null;
}

async function writeLocation(location, force = false) {
  if (!state.user || !state.db || !shouldTrack()) return;
  const elapsed = Date.now() - state.lastWriteAt;
  const moved = distanceMeters(state.lastPosition, location);
  if (!force && elapsed < UPDATE_INTERVAL_MS && moved < MIN_MOVEMENT_METERS) return;

  if (state.writing) {
    state.pendingPosition = location;
    return;
  }

  state.writing = true;
  try {
    const address = location.address || currentReadableAddress();
    const locationPayload = {
      ...location,
      ...(address ? { address } : {}),
      updatedAt: state.api.serverTimestamp()
    };

    await state.api.setDoc(state.api.doc(state.db, "riders", state.user.uid), {
      location: locationPayload,
      lastLocationAt: state.api.serverTimestamp(),
      lastSeenAt: state.api.serverTimestamp()
    }, { merge: true });

    const activeOrderRef = await findActiveOrderRef();
    if (activeOrderRef) {
      await state.api.updateDoc(activeOrderRef, {
        riderLocation: locationPayload,
        riderLocationUpdatedAt: state.api.serverTimestamp(),
        updatedAt: state.api.serverTimestamp()
      });
    }

    state.lastPosition = { ...location, ...(address ? { address } : {}) };
    state.lastWriteAt = Date.now();
  } catch (error) {
    console.error("Rider live location update failed:", error);
  } finally {
    state.writing = false;
    if (state.pendingPosition) {
      const pending = state.pendingPosition;
      state.pendingPosition = null;
      writeLocation(pending, false);
    }
  }
}

function handlePosition(position, force = false) {
  const location = normalizedPosition(position);
  window.dispatchEvent(new CustomEvent("myqk:rider-position", { detail: location }));
  writeLocation(location, force);
}

function requestHeartbeatLocation() {
  if (!shouldTrack() || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (position) => handlePosition(position, true),
    (error) => console.warn("Rider heartbeat location unavailable:", error),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }
  );
}

function startTracking() {
  if (!shouldTrack() || !navigator.geolocation || state.watchId !== null) return;

  state.watchId = navigator.geolocation.watchPosition(
    (position) => handlePosition(position, false),
    (error) => console.warn("Rider live location unavailable:", error),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 }
  );

  requestHeartbeatLocation();
  state.heartbeatId = window.setInterval(requestHeartbeatLocation, UPDATE_INTERVAL_MS);
}

function stopTracking() {
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  if (state.heartbeatId !== null) window.clearInterval(state.heartbeatId);
  state.watchId = null;
  state.heartbeatId = null;
  state.pendingPosition = null;
}

function syncTrackingState() {
  window.setTimeout(() => {
    if (shouldTrack()) startTracking();
    else stopTracking();
  }, 0);
}

async function initialize() {
  try {
    const appModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const authModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
    const firestoreModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
    const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
    state.auth = authModule.getAuth(app);
    state.db = firestoreModule.getFirestore(app);
    state.api = { ...authModule, ...firestoreModule };

    document.querySelector("#online-toggle")?.addEventListener("change", syncTrackingState);
    document.querySelector("#accept-order-btn")?.addEventListener("click", () => window.setTimeout(syncTrackingState, 500));
    document.querySelector("#advance-order-btn")?.addEventListener("click", () => window.setTimeout(syncTrackingState, 700));
    document.querySelector("#logout-btn")?.addEventListener("click", stopTracking);
    document.querySelector("#onboarding-logout-btn")?.addEventListener("click", stopTracking);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") syncTrackingState();
    });

    authModule.onAuthStateChanged(state.auth, (user) => {
      state.user = user;
      state.lastPosition = null;
      state.lastWriteAt = 0;
      if (!user) stopTracking();
      else window.setTimeout(syncTrackingState, 900);
    });
  } catch (error) {
    console.error("Rider location module failed:", error);
  }
}

initialize();
