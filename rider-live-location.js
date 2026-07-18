import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VERSION = '10.12.5';
const UPDATE_INTERVAL_MS = 60_000;
const ACTIVE_STATUSES = ['accepted', 'arrived_pickup', 'picked_up'];

const state = {
  auth: null,
  db: null,
  api: null,
  user: null,
  heartbeatId: null,
  lastPosition: null,
  writing: false,
  pendingPosition: null
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

function shouldTrack() {
  const online = Boolean(document.querySelector('#online-toggle')?.checked);
  const activeCardVisible = !document.querySelector('#active-order-card')?.classList.contains('hidden');
  return Boolean(state.user && (online || activeCardVisible));
}

async function findActiveOrderRef() {
  const ordersQuery = state.api.query(
    state.api.collection(state.db, 'orders'),
    state.api.where('assignedRiderId', '==', state.user.uid),
    state.api.limit(20)
  );
  const snapshot = await state.api.getDocs(ordersQuery);
  const active = snapshot.docs.find((item) => ACTIVE_STATUSES.includes(item.data().status));
  return active ? state.api.doc(state.db, 'orders', active.id) : null;
}

async function writeLocation(location) {
  if (!state.user || !state.db || !shouldTrack()) return;
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

    await state.api.setDoc(state.api.doc(state.db, 'riders', state.user.uid), {
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
    globalThis.myQkRiderCurrentLocation = state.lastPosition;
  } catch (error) {
    console.error('Rider live location update failed:', error);
  } finally {
    state.writing = false;
    if (state.pendingPosition) {
      const pending = state.pendingPosition;
      state.pendingPosition = null;
      writeLocation(pending);
    }
  }
}

function handlePosition(position) {
  const location = normalizedPosition(position);
  window.dispatchEvent(new CustomEvent('myqk:rider-position', { detail: location }));
  writeLocation(location);
}

function forceOfflineBecauseLocationFailed(error) {
  console.warn('Rider current location unavailable:', error);
  const toggle = document.querySelector('#online-toggle');
  if (!toggle?.checked) return;
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  const toast = document.querySelector('#toast');
  if (toast) {
    toast.textContent = 'Location unavailable. Rider ko Offline kar diya gaya.';
    toast.className = 'toast show error';
  }
}

function requestHeartbeatLocation() {
  if (!shouldTrack() || !navigator.geolocation) {
    if (!navigator.geolocation) forceOfflineBecauseLocationFailed(new Error('LOCATION_UNSUPPORTED'));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    handlePosition,
    forceOfflineBecauseLocationFailed,
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
  );
}

function startTracking() {
  if (!shouldTrack() || !navigator.geolocation || state.heartbeatId !== null) return;
  requestHeartbeatLocation();
  state.heartbeatId = window.setInterval(requestHeartbeatLocation, UPDATE_INTERVAL_MS);
}

function stopTracking() {
  if (state.heartbeatId !== null) window.clearInterval(state.heartbeatId);
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

    document.querySelector('#online-toggle')?.addEventListener('change', () => {
      window.setTimeout(syncTrackingState, 1200);
    });
    document.querySelector('#accept-order-btn')?.addEventListener('click', () => window.setTimeout(syncTrackingState, 700));
    document.querySelector('#advance-order-btn')?.addEventListener('click', () => window.setTimeout(syncTrackingState, 900));
    document.querySelector('#logout-btn')?.addEventListener('click', stopTracking);
    document.querySelector('#onboarding-logout-btn')?.addEventListener('click', stopTracking);
    window.addEventListener('myqk:rider-position', () => window.setTimeout(syncTrackingState, 1500));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        requestHeartbeatLocation();
        syncTrackingState();
      }
    });

    authModule.onAuthStateChanged(state.auth, (user) => {
      state.user = user;
      state.lastPosition = null;
      if (!user) stopTracking();
      else window.setTimeout(syncTrackingState, 1200);
    });
  } catch (error) {
    console.error('Rider location module failed:', error);
  }
}

initialize();
