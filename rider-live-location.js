import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VERSION = '10.12.5';
const ACTIVE_STATUSES = ['accepted', 'arrived_pickup', 'picked_up'];
const ACTIVE_MIN_INTERVAL_MS = 8_000;
const ACTIVE_HEARTBEAT_MS = 16_000;
const ACTIVE_MIN_DISTANCE_METERS = 15;
const IDLE_MIN_INTERVAL_MS = 45_000;
const IDLE_HEARTBEAT_MS = 65_000;
const IDLE_MIN_DISTANCE_METERS = 60;
const PROFILE_WRITE_INTERVAL_MS = 45_000;
const WATCHDOG_INTERVAL_MS = 10_000;
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 3_000
};

const state = {
  auth: null,
  db: null,
  api: null,
  user: null,
  watchId: null,
  heartbeatId: null,
  lastPosition: null,
  lastFixAt: 0,
  lastUploadAt: 0,
  lastProfileWriteAt: 0,
  lastUploadedPosition: null,
  activeOrderId: null,
  activeOrderStatus: null,
  locationErrorCount: 0,
  writing: false,
  pendingPosition: null,
  pendingForce: false
};

function currentReadableAddress() {
  const value = globalThis.myQkRiderLocationAddress;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof state.lastPosition?.address === 'string' && state.lastPosition.address.trim()) {
    return state.lastPosition.address.trim();
  }
  return '';
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

function distanceMeters(from, to) {
  if (!from || !to) return Infinity;
  const fromLatitude = Number(from.latitude);
  const fromLongitude = Number(from.longitude);
  const toLatitude = Number(to.latitude);
  const toLongitude = Number(to.longitude);
  if (![fromLatitude, fromLongitude, toLatitude, toLongitude].every(Number.isFinite)) return Infinity;
  const radians = (value) => value * Math.PI / 180;
  const latitudeDistance = radians(toLatitude - fromLatitude);
  const longitudeDistance = radians(toLongitude - fromLongitude);
  const calculation = Math.sin(latitudeDistance / 2) ** 2
    + Math.cos(radians(fromLatitude))
    * Math.cos(radians(toLatitude))
    * Math.sin(longitudeDistance / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(calculation), Math.sqrt(1 - calculation));
}

function hasActiveDelivery() {
  const activeCard = document.querySelector('#active-order-card');
  return Boolean(state.activeOrderId || (activeCard && !activeCard.classList.contains('hidden')));
}

function shouldTrack() {
  const online = Boolean(document.querySelector('#online-toggle')?.checked);
  return Boolean(state.user && (online || hasActiveDelivery()));
}

async function findActiveOrderRef() {
  if (state.activeOrderId) {
    return state.api.doc(state.db, 'orders', state.activeOrderId);
  }
  const ordersQuery = state.api.query(
    state.api.collection(state.db, 'orders'),
    state.api.where('assignedRiderId', '==', state.user.uid),
    state.api.limit(20)
  );
  const snapshot = await state.api.getDocs(ordersQuery);
  const active = snapshot.docs.find((item) => ACTIVE_STATUSES.includes(item.data().status));
  if (!active) return null;
  state.activeOrderId = active.id;
  state.activeOrderStatus = active.data().status;
  globalThis.myQkActiveOrderId = active.id;
  return state.api.doc(state.db, 'orders', active.id);
}

function uploadPolicy() {
  return hasActiveDelivery()
    ? {
      minimumInterval: ACTIVE_MIN_INTERVAL_MS,
      heartbeat: ACTIVE_HEARTBEAT_MS,
      minimumDistance: ACTIVE_MIN_DISTANCE_METERS
    }
    : {
      minimumInterval: IDLE_MIN_INTERVAL_MS,
      heartbeat: IDLE_HEARTBEAT_MS,
      minimumDistance: IDLE_MIN_DISTANCE_METERS
    };
}

function shouldUpload(location, force = false) {
  if (force || !state.lastUploadedPosition || !state.lastUploadAt) return true;
  const policy = uploadPolicy();
  const elapsed = Date.now() - state.lastUploadAt;
  if (elapsed < policy.minimumInterval) return false;
  return elapsed >= policy.heartbeat
    || distanceMeters(state.lastUploadedPosition, location) >= policy.minimumDistance;
}

async function writeLocation(location, force = false) {
  if (!state.user || !state.db || !shouldTrack() || !shouldUpload(location, force)) return;
  if (state.writing) {
    state.pendingPosition = location;
    state.pendingForce = state.pendingForce || force;
    return;
  }

  state.writing = true;
  try {
    const uploadTime = Date.now();
    const address = location.address || currentReadableAddress();
    const locationPayload = {
      ...location,
      ...(address ? { address } : {}),
      updatedAt: state.api.serverTimestamp()
    };

    const activeOrderRef = await findActiveOrderRef();
    const profileWriteDue = !activeOrderRef
      || force
      || uploadTime - state.lastProfileWriteAt >= PROFILE_WRITE_INTERVAL_MS;

    if (profileWriteDue) {
      await state.api.setDoc(state.api.doc(state.db, 'riders', state.user.uid), {
        location: locationPayload,
        lastLocationAt: state.api.serverTimestamp(),
        lastSeenAt: state.api.serverTimestamp(),
        updatedAt: state.api.serverTimestamp()
      }, { merge: true });
      state.lastProfileWriteAt = uploadTime;
    }

    if (activeOrderRef) {
      await state.api.updateDoc(activeOrderRef, {
        riderLocation: locationPayload,
        riderLocationUpdatedAt: state.api.serverTimestamp(),
        updatedAt: state.api.serverTimestamp()
      });
    }

    state.lastPosition = { ...location, ...(address ? { address } : {}) };
    state.lastUploadedPosition = state.lastPosition;
    state.lastUploadAt = uploadTime;
    globalThis.myQkRiderCurrentLocation = state.lastPosition;
  } catch (error) {
    console.error('Rider live location update failed:', error);
  } finally {
    state.writing = false;
    if (state.pendingPosition) {
      const pending = state.pendingPosition;
      const forcePending = state.pendingForce;
      state.pendingPosition = null;
      state.pendingForce = false;
      writeLocation(pending, forcePending);
    }
  }
}

function handlePosition(position, force = false) {
  const location = normalizedPosition(position);
  state.lastPosition = location;
  state.lastFixAt = Date.now();
  state.locationErrorCount = 0;
  globalThis.myQkRiderCurrentLocation = location;
  window.dispatchEvent(new CustomEvent('myqk:rider-position', { detail: location }));
  writeLocation(location, force);
}

function showLocationWarning(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast show error';
}

function handleLocationError(error) {
  console.warn('Rider current location unavailable:', error);
  state.locationErrorCount += 1;
  const locationUnavailable = error?.code === 1 || error?.message === 'LOCATION_UNSUPPORTED';
  if (!locationUnavailable && state.locationErrorCount < 3) return;

  if (hasActiveDelivery()) {
    showLocationWarning('Keep GPS on and allow location access for live delivery tracking.');
    return;
  }

  const toggle = document.querySelector('#online-toggle');
  if (!toggle?.checked) return;
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  showLocationWarning('Location is unavailable, so you have been switched offline.');
}

function requestFreshPosition(force = false) {
  if (!shouldTrack() || !navigator.geolocation) {
    if (!navigator.geolocation) handleLocationError(new Error('LOCATION_UNSUPPORTED'));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => handlePosition(position, force),
    handleLocationError,
    GEOLOCATION_OPTIONS
  );
}

function startTracking() {
  if (!shouldTrack() || !navigator.geolocation) return;

  let startedNow = false;
  if (state.watchId === null) {
    startedNow = true;
    state.watchId = navigator.geolocation.watchPosition(
      (position) => handlePosition(position),
      handleLocationError,
      GEOLOCATION_OPTIONS
    );
  }

  if (state.heartbeatId === null) {
    state.heartbeatId = window.setInterval(() => {
      if (!shouldTrack()) {
        stopTracking();
        return;
      }
      const maximumFixAge = hasActiveDelivery()
        ? ACTIVE_HEARTBEAT_MS
        : IDLE_HEARTBEAT_MS;
      if (!state.lastFixAt || Date.now() - state.lastFixAt >= maximumFixAge) {
        requestFreshPosition(hasActiveDelivery());
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  if (startedNow || !state.lastFixAt) requestFreshPosition(hasActiveDelivery());
}

function stopTracking() {
  if (state.watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.watchId);
  }
  state.watchId = null;
  if (state.heartbeatId !== null) window.clearInterval(state.heartbeatId);
  state.heartbeatId = null;
  state.pendingPosition = null;
  state.pendingForce = false;
}

function syncTrackingState() {
  window.setTimeout(() => {
    if (shouldTrack()) startTracking();
    else stopTracking();
  }, 0);
}

function syncActiveOrder(detail) {
  const previousOrderId = state.activeOrderId;
  const previousStatus = state.activeOrderStatus;
  state.activeOrderId = detail?.orderId || null;
  state.activeOrderStatus = detail?.status || null;
  globalThis.myQkActiveOrderId = state.activeOrderId;

  if (state.activeOrderId && state.activeOrderId !== previousOrderId) {
    state.lastUploadAt = 0;
    requestFreshPosition(true);
  } else if (state.activeOrderId && state.activeOrderStatus !== previousStatus) {
    requestFreshPosition(false);
  }
  syncTrackingState();
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

    document.querySelector('#online-toggle')?.addEventListener('change', () => {
      window.setTimeout(syncTrackingState, 1200);
    });
    document.querySelector('#accept-order-btn')?.addEventListener('click', () => window.setTimeout(syncTrackingState, 700));
    document.querySelector('#advance-order-btn')?.addEventListener('click', () => window.setTimeout(syncTrackingState, 900));
    document.querySelector('#logout-btn')?.addEventListener('click', stopTracking);
    document.querySelector('#onboarding-logout-btn')?.addEventListener('click', stopTracking);
    window.addEventListener('myqk:active-order', (event) => syncActiveOrder(event.detail));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestFreshPosition(hasActiveDelivery());
        syncTrackingState();
      }
    });

    authModule.onAuthStateChanged(state.auth, (user) => {
      state.user = user;
      state.lastPosition = null;
      state.lastFixAt = 0;
      state.lastUploadAt = 0;
      state.lastProfileWriteAt = 0;
      state.lastUploadedPosition = null;
      state.locationErrorCount = 0;
      if (!user) {
        state.activeOrderId = null;
        state.activeOrderStatus = null;
        globalThis.myQkActiveOrderId = null;
        stopTracking();
      } else {
        state.activeOrderId = globalThis.myQkActiveOrderId || null;
        window.setTimeout(syncTrackingState, 1200);
      }
    });
  } catch (error) {
    console.error('Rider location module failed:', error);
  }
}

initialize();
