import { firebaseConfig } from './firebase-config.js';
import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { collection, doc, getDoc, getFirestore, limit, onSnapshot, query, runTransaction, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (selector) => document.querySelector(selector);

const MAX_ORDER_RADIUS_KM = 20;
const LOCATION_FRESHNESS_MS = 90_000;
const LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0
};

const state = {
  user: null,
  profile: null,
  online: false,
  available: [],
  readyDocs: [],
  visible: null,
  active: null,
  locationCapturedAt: 0,
  unsubAvailable: null,
  unsubActive: null
};

function announceActiveOrder(order = null) {
  const detail = order
    ? { orderId: order.firestoreId, status: order.status }
    : null;
  globalThis.myQkActiveOrderId = detail?.orderId || null;
  window.dispatchEvent(new CustomEvent('myqk:active-order', { detail }));
}

function toast(message, error = false) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.className = 'toast';
  }, 3400);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function validCoordinates(value) {
  if (!value || typeof value !== 'object') return false;
  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng);
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function km(pointA, pointB) {
  if (!validCoordinates(pointA) || !validCoordinates(pointB)) return Infinity;
  const lat1 = Number(pointA.latitude ?? pointA.lat);
  const lon1 = Number(pointA.longitude ?? pointA.lng);
  const lat2 = Number(pointB.latitude ?? pointB.lat);
  const lon2 = Number(pointB.longitude ?? pointB.lng);
  const radians = (value) => value * Math.PI / 180;
  const latitudeDistance = radians(lat2 - lat1);
  const longitudeDistance = radians(lon2 - lon1);
  const calculation = Math.sin(latitudeDistance / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2))
    * Math.sin(longitudeDistance / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(calculation), Math.sqrt(1 - calculation));
}

function readableAddress() {
  const address = globalThis.myQkRiderLocationAddress;
  return typeof address === 'string' ? address.trim() : '';
}

function normalizeBrowserPosition(position) {
  const location = {
    latitude: Number(position.coords.latitude.toFixed(6)),
    longitude: Number(position.coords.longitude.toFixed(6)),
    accuracy: Math.round(position.coords.accuracy || 0),
    heading: Number.isFinite(position.coords.heading) ? Math.round(position.coords.heading) : null,
    speed: Number.isFinite(position.coords.speed) ? Number(position.coords.speed.toFixed(2)) : null
  };
  const address = readableAddress();
  if (address) location.address = address;
  return location;
}

function requestCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('LOCATION_UNSUPPORTED'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(normalizeBrowserPosition(position)),
      (error) => reject(error),
      LOCATION_OPTIONS
    );
  });
}

async function captureFreshLocation() {
  const location = await requestCurrentLocation();
  state.locationCapturedAt = Date.now();
  state.profile = { ...(state.profile || {}), location };
  globalThis.myQkRiderCurrentLocation = location;
  window.dispatchEvent(new CustomEvent('myqk:rider-position', { detail: location }));

  if (state.user) {
    await setDoc(doc(db, 'riders', state.user.uid), {
      location: {
        ...location,
        updatedAt: serverTimestamp()
      },
      lastLocationAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  applyRadiusFilter();
  return location;
}

function hasFreshLocation() {
  return validCoordinates(state.profile?.location)
    && Date.now() - state.locationCapturedAt <= LOCATION_FRESHNESS_MS;
}

function normalize(snapshot) {
  const data = snapshot.data();
  const pickup = data.pickup || {};
  const drop = data.drop || {};
  const pickupLocation = pickup.location || data.pickupLocation;
  const distance = km(state.profile?.location, pickupLocation);

  return {
    firestoreId: snapshot.id,
    id: data.orderNumber || snapshot.id,
    status: data.status,
    pickup: pickup.name || data.pickupName || data.storeName || 'Pickup store',
    pickupAddress: pickup.address || data.pickupAddress || '',
    pickupLocation,
    pickupDistance: Number.isFinite(distance) ? `${distance.toFixed(1)} km away` : 'Location unavailable',
    drop: drop.name || data.customerName || 'Customer',
    dropAddress: drop.address || data.dropAddress || '',
    dropLocation: drop.location || data.dropLocation,
    distance: data.distanceText || 'Distance will update after acceptance',
    duration: data.durationText || '20–30 min',
    items: `${number(data.itemCount, Array.isArray(data.items) ? data.items.length : 1)} items`,
    payment: data.paymentMode || 'Cash on Delivery',
    payout: number(data.riderPayout ?? data.payout, 25),
    customerPhone: data.customerPhone || '',
    raw: data,
    kmToPickup: distance
  };
}

function setOnlineUi(online) {
  state.online = online;
  const toggle = $('#online-toggle');
  if (toggle) toggle.checked = online;

  const badge = $('#availability-badge');
  const title = $('#availability-title');
  const text = $('#availability-text');
  if (badge) {
    badge.textContent = online ? 'Online' : 'Offline';
    badge.className = `availability-badge ${online ? 'online' : 'offline'}`;
  }
  if (title) title.textContent = online ? 'You are online' : 'You are offline';
  if (text) {
    text.textContent = online
      ? `Showing ready orders within ${MAX_ORDER_RADIUS_KM} km of your live location.`
      : 'Turn on location and go online to receive delivery requests.';
  }

  $('#offline-state')?.classList.toggle('hidden', online || Boolean(state.active));
  $('#searching-state')?.classList.toggle('hidden', !online || Boolean(state.visible) || Boolean(state.active));
  if (!online) $('#order-request')?.classList.add('hidden');
}

async function savePresence() {
  if (!state.user) return;
  await setDoc(doc(db, 'riders', state.user.uid), {
    isOnline: state.online,
    status: state.online ? 'online' : 'offline',
    location: state.profile?.location || null,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function fillRequest(order) {
  state.visible = order;
  $('#order-id').textContent = `#${order.id}`;
  $('#order-payout').textContent = `₹${order.payout}`;
  $('#pickup-store').textContent = order.pickup;
  $('#pickup-distance').textContent = order.pickupDistance;
  $('#drop-area').textContent = order.dropAddress || order.drop;
  $('#order-distance').textContent = order.distance;
  $('#order-time').textContent = order.duration;
  $('#order-items').textContent = order.items;
  $('#payment-mode').textContent = order.payment;
  $('#searching-state')?.classList.add('hidden');
  $('#order-request')?.classList.remove('hidden');
  $('#request-count').textContent = `${state.available.length} available`;
}

function nextRequest() {
  if (!state.online || state.active) return;
  const next = state.available.find((order) => order.firestoreId !== state.visible?.firestoreId)
    || state.available[0];
  if (next) {
    fillRequest(next);
    return;
  }
  state.visible = null;
  $('#order-request')?.classList.add('hidden');
  $('#searching-state')?.classList.remove('hidden');
  $('#request-count').textContent = '0 available';
}

function applyRadiusFilter() {
  state.available = state.readyDocs
    .map(normalize)
    .filter((order) => Number.isFinite(order.kmToPickup) && order.kmToPickup <= MAX_ORDER_RADIUS_KM)
    .sort((first, second) => first.kmToPickup - second.kmToPickup);

  if (state.visible && !state.available.some((order) => order.firestoreId === state.visible.firestoreId)) {
    state.visible = null;
  }
  $('#request-count').textContent = `${state.available.length} available`;
  if (state.online) nextRequest();
}

function availableOrdersError(error) {
  console.error('Ready orders listener failed:', error);
  state.available = [];
  state.readyDocs = [];
  state.visible = null;
  $('#order-request')?.classList.add('hidden');
  $('#request-count').textContent = '0 available';
  if (error?.code === 'permission-denied') {
    toast('Order access was denied. Publish the latest Firestore rules.', true);
    return;
  }
  if (error?.code === 'failed-precondition') {
    toast('A Firestore index is required. Open the error link to create it.', true);
    return;
  }
  toast('Ready orders could not be loaded. Check your internet connection and Firebase setup.', true);
}

function listenAvailable() {
  state.unsubAvailable?.();
  const readyOrdersQuery = query(
    collection(db, 'orders'),
    where('status', '==', 'ready_for_pickup'),
    limit(50)
  );
  state.unsubAvailable = onSnapshot(readyOrdersQuery, (snapshot) => {
    state.readyDocs = snapshot.docs;
    applyRadiusFilter();
  }, availableOrdersError);
}

function renderActive() {
  const order = state.active;
  if (!order) return;
  $('#active-order-card')?.classList.remove('hidden');
  $('#active-order-id').textContent = `Order #${order.id}`;
  if (order.status === 'accepted') {
    $('#active-step-label').textContent = 'TO PICKUP';
    $('#active-progress').style.width = '25%';
    $('#active-destination-type').textContent = 'Pickup from';
    $('#active-destination-name').textContent = order.pickup;
    $('#active-destination-address').textContent = order.pickupAddress;
    $('#advance-order-btn').textContent = 'I have arrived';
  } else if (order.status === 'arrived_pickup') {
    $('#active-step-label').textContent = 'AT STORE';
    $('#active-progress').style.width = '50%';
    $('#active-destination-type').textContent = 'Pickup from';
    $('#active-destination-name').textContent = order.pickup;
    $('#active-destination-address').textContent = order.pickupAddress;
    $('#advance-order-btn').textContent = 'Order picked up';
  } else if (order.status === 'picked_up') {
    $('#active-step-label').textContent = 'TO CUSTOMER';
    $('#active-progress').style.width = '75%';
    $('#active-destination-type').textContent = 'Deliver to';
    $('#active-destination-name').textContent = order.drop;
    $('#active-destination-address').textContent = order.dropAddress;
    $('#advance-order-btn').textContent = 'Complete delivery';
  }
}

function listenActive(orderId) {
  state.unsubActive?.();
  state.unsubActive = onSnapshot(doc(db, 'orders', orderId), (snapshot) => {
    if (!snapshot.exists()) {
      state.active = null;
      announceActiveOrder();
      $('#active-order-card')?.classList.add('hidden');
      return;
    }
    const order = normalize(snapshot);
    if (order.raw.assignedRiderId !== state.user?.uid
      || !['accepted', 'arrived_pickup', 'picked_up'].includes(order.status)) {
      state.active = null;
      announceActiveOrder();
      $('#active-order-card')?.classList.add('hidden');
      nextRequest();
      return;
    }
    state.active = order;
    announceActiveOrder(order);
    renderActive();
  }, (error) => {
    console.error('Active order listener failed:', error);
    toast('Active order sync failed.', true);
  });
}

async function recoverActive() {
  const activeOrdersQuery = query(
    collection(db, 'orders'),
    where('assignedRiderId', '==', state.user.uid),
    limit(10)
  );
  let unsubscribe = null;
  unsubscribe = onSnapshot(activeOrdersQuery, (snapshot) => {
    const found = snapshot.docs
      .map(normalize)
      .find((order) => ['accepted', 'arrived_pickup', 'picked_up'].includes(order.status));
    if (found && !state.active) {
      state.active = found;
      announceActiveOrder(found);
      listenActive(found.firestoreId);
      renderActive();
    }
    unsubscribe?.();
  }, (error) => {
    console.error('Active order recovery failed:', error);
    unsubscribe?.();
  });
}

async function accept() {
  const order = state.visible;
  if (!order || !state.user || state.active) return;
  if (!state.online || !hasFreshLocation()) {
    toast('You cannot accept an order without a fresh GPS location.', true);
    return;
  }
  if (!Number.isFinite(order.kmToPickup) || order.kmToPickup > MAX_ORDER_RADIUS_KM) {
    state.visible = null;
    applyRadiusFilter();
    toast(`You can only accept orders within ${MAX_ORDER_RADIUS_KM} km of your current location.`, true);
    return;
  }

  const button = $('#accept-order-btn');
  button.disabled = true;
  button.textContent = 'Accepting…';
  try {
    const orderRef = doc(db, 'orders', order.firestoreId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists()) throw new Error('NOT_FOUND');
      const data = snapshot.data();
      if (data.status !== 'ready_for_pickup' || data.assignedRiderId) throw new Error('TAKEN');
      const pickupLocation = data.pickup?.location || data.pickupLocation;
      const liveDistance = km(state.profile.location, pickupLocation);
      if (!Number.isFinite(liveDistance) || liveDistance > MAX_ORDER_RADIUS_KM) {
        throw new Error('OUT_OF_RADIUS');
      }
      transaction.update(orderRef, {
        status: 'accepted',
        assignedRiderId: state.user.uid,
        assignedRiderName: state.profile?.fullName || state.user.displayName || 'Rider',
        riderAcceptedAt: serverTimestamp(),
        acceptedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    state.active = { ...order, status: 'accepted' };
    announceActiveOrder(state.active);
    state.visible = null;
    $('#order-request')?.classList.add('hidden');
    listenActive(order.firestoreId);
    renderActive();
    toast('Order accepted.');
  } catch (error) {
    console.error('Order acceptance failed:', error);
    if (error.message === 'TAKEN') toast('Another rider has already accepted this order.', true);
    else if (error.message === 'OUT_OF_RADIUS') toast(`This order is outside your ${MAX_ORDER_RADIUS_KM} km delivery radius.`, true);
    else if (error?.code === 'permission-denied') toast('Order acceptance was denied. Publish the latest Firestore rules.', true);
    else toast('The order could not be accepted.', true);
    nextRequest();
  } finally {
    button.disabled = false;
    button.textContent = 'Accept order';
  }
}

async function advance() {
  const order = state.active;
  if (!order) return;
  const nextStatus = {
    accepted: 'arrived_pickup',
    arrived_pickup: 'picked_up',
    picked_up: 'completed'
  }[order.status];
  if (!nextStatus) return;
  const button = $('#advance-order-btn');
  button.disabled = true;
  try {
    const orderRef = doc(db, 'orders', order.firestoreId);
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(orderRef);
      if (!snapshot.exists()) throw new Error('NOT_FOUND');
      const data = snapshot.data();
      if (data.assignedRiderId !== state.user.uid || data.status !== order.status) throw new Error('INVALID');
      const patch = { status: nextStatus, updatedAt: serverTimestamp() };
      if (nextStatus === 'arrived_pickup') patch.arrivedPickupAt = serverTimestamp();
      if (nextStatus === 'picked_up') patch.pickedUpAt = serverTimestamp();
      if (nextStatus === 'completed') patch.completedAt = serverTimestamp();
      transaction.update(orderRef, patch);
    });
    if (nextStatus === 'completed') {
      state.active = null;
      announceActiveOrder();
      $('#active-order-card')?.classList.add('hidden');
      toast('Delivery completed.');
      nextRequest();
    }
  } catch (error) {
    console.error('Order status update failed:', error);
    toast(error?.code === 'permission-denied'
      ? 'The order update was denied. Publish the latest Firestore rules.'
      : 'Order update failed.', true);
  } finally {
    button.disabled = false;
  }
}

function openNavigation() {
  const order = state.active;
  if (!order) return;
  const target = order.status === 'picked_up' ? order.dropLocation : order.pickupLocation;
  if (!validCoordinates(target)) {
    toast('Location unavailable.', true);
    return;
  }
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}`, '_blank');
}

$('#online-toggle')?.addEventListener('change', async (event) => {
  const toggle = event.currentTarget;
  const wantsOnline = toggle.checked;
  toggle.disabled = true;

  if (!wantsOnline) {
    setOnlineUi(false);
    try {
      await savePresence();
    } catch (error) {
      console.error('Offline status save failed:', error);
      toast('Your offline status could not be saved.', true);
    } finally {
      toggle.disabled = false;
    }
    return;
  }

  setOnlineUi(false);
  toast('Verifying your current location…');
  try {
    await captureFreshLocation();
    setOnlineUi(true);
    await savePresence();
    nextRequest();
    toast('Location verified. You are online.');
  } catch (error) {
    console.error('Current location verification failed:', error);
    setOnlineUi(false);
    await savePresence().catch(() => {});
    toast('Turn on location services and allow current-location access before going online.', true);
  } finally {
    toggle.disabled = false;
  }
});

$('#accept-order-btn')?.addEventListener('click', accept);
$('#reject-order-btn')?.addEventListener('click', () => {
  state.visible = null;
  nextRequest();
});
$('#advance-order-btn')?.addEventListener('click', advance);
$('#open-navigation-btn')?.addEventListener('click', openNavigation);
$('#call-action-btn')?.addEventListener('click', () => {
  if (state.active?.customerPhone) {
    location.href = `tel:${String(state.active.customerPhone).replace(/[^+\d]/g, '')}`;
  } else {
    toast('Customer phone unavailable.', true);
  }
});

window.addEventListener('myqk:rider-position', (event) => {
  if (!validCoordinates(event.detail)) return;
  const address = readableAddress();
  state.profile = {
    ...(state.profile || {}),
    location: {
      ...event.detail,
      ...(address ? { address } : {})
    }
  };
  state.locationCapturedAt = Date.now();
  globalThis.myQkRiderCurrentLocation = state.profile.location;
  applyRadiusFilter();
});

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.unsubAvailable?.();
  state.unsubActive?.();
  state.available = [];
  state.readyDocs = [];
  state.visible = null;
  state.active = null;
  announceActiveOrder();
  state.locationCapturedAt = 0;
  if (!user) return;

  try {
    const snapshot = await getDoc(doc(db, 'riders', user.uid));
    state.profile = snapshot.exists() ? snapshot.data() : null;
    if (!state.profile?.onboardingComplete) return;

    // A saved location is not enough to start a new online session.
    // The rider must explicitly provide a fresh current GPS position.
    setOnlineUi(false);
    if (state.profile.isOnline) await savePresence().catch(() => {});
    listenAvailable();
    recoverActive();
  } catch (error) {
    console.error('Rider profile load failed:', error);
    toast('Your rider profile could not be loaded.', true);
  }
});
