import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { collection, doc, getDoc, getFirestore, limit, onSnapshot, query, runTransaction, serverTimestamp, setDoc, where } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (selector) => document.querySelector(selector);

const state = {
  user: null,
  profile: null,
  online: false,
  available: [],
  visible: null,
  active: null,
  unsubAvailable: null,
  unsubActive: null
};

function toast(message, error = false) {
  const element = $('#toast');
  if (!element) return;
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.className = 'toast';
  }, 3200);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function km(pointA, pointB) {
  if (!pointA || !pointB) return Infinity;
  const lat1 = number(pointA.latitude ?? pointA.lat, NaN);
  const lon1 = number(pointA.longitude ?? pointA.lng, NaN);
  const lat2 = number(pointB.latitude ?? pointB.lat, NaN);
  const lon2 = number(pointB.longitude ?? pointB.lng, NaN);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;

  const radians = (value) => value * Math.PI / 180;
  const latitudeDistance = radians(lat2 - lat1);
  const longitudeDistance = radians(lon2 - lon1);
  const calculation = Math.sin(latitudeDistance / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2))
    * Math.sin(longitudeDistance / 2) ** 2;

  return 6371 * 2 * Math.atan2(Math.sqrt(calculation), Math.sqrt(1 - calculation));
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
      ? 'Ready pickup orders will appear automatically.'
      : 'Go online to receive delivery requests.';
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

function availableOrdersError(error) {
  console.error('Ready orders listener failed:', error);
  state.available = [];
  state.visible = null;
  $('#order-request')?.classList.add('hidden');
  $('#request-count').textContent = '0 available';

  if (error?.code === 'permission-denied') {
    toast('Rider order permission denied. Latest Firestore rules publish karo.', true);
    return;
  }

  if (error?.code === 'failed-precondition') {
    toast('Firestore index required. Error link se index create karo.', true);
    return;
  }

  toast('Ready orders load nahi hue. Internet aur Firebase check karo.', true);
}

function listenAvailable() {
  state.unsubAvailable?.();

  const readyOrdersQuery = query(
    collection(db, 'orders'),
    where('status', '==', 'ready_for_pickup'),
    limit(50)
  );

  state.unsubAvailable = onSnapshot(readyOrdersQuery, (snapshot) => {
    // MVP behavior: do not silently discard valid orders because of inaccurate
    // rider/store coordinates. Nearby orders are sorted first; all ready orders remain visible.
    state.available = snapshot.docs
      .map(normalize)
      .sort((first, second) => {
        const firstDistance = Number.isFinite(first.kmToPickup) ? first.kmToPickup : Number.MAX_SAFE_INTEGER;
        const secondDistance = Number.isFinite(second.kmToPickup) ? second.kmToPickup : Number.MAX_SAFE_INTEGER;
        return firstDistance - secondDistance;
      });

    if (state.visible && !state.available.some((order) => order.firestoreId === state.visible.firestoreId)) {
      state.visible = null;
    }

    $('#request-count').textContent = `${state.available.length} available`;
    nextRequest();
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
      $('#active-order-card')?.classList.add('hidden');
      return;
    }

    const order = normalize(snapshot);
    if (order.raw.assignedRiderId !== state.user?.uid
      || !['accepted', 'arrived_pickup', 'picked_up'].includes(order.status)) {
      state.active = null;
      $('#active-order-card')?.classList.add('hidden');
      nextRequest();
      return;
    }

    state.active = order;
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
    state.visible = null;
    $('#order-request')?.classList.add('hidden');
    listenActive(order.firestoreId);
    renderActive();
    toast('Order accepted.');
  } catch (error) {
    console.error('Order acceptance failed:', error);
    if (error.message === 'TAKEN') toast('Ye order kisi aur rider ne accept kar liya.', true);
    else if (error?.code === 'permission-denied') toast('Accept permission denied. Latest Firestore rules publish karo.', true);
    else toast('Order accept nahi hua.', true);
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
      if (data.assignedRiderId !== state.user.uid || data.status !== order.status) {
        throw new Error('INVALID');
      }

      const patch = {
        status: nextStatus,
        updatedAt: serverTimestamp()
      };
      if (nextStatus === 'arrived_pickup') patch.arrivedPickupAt = serverTimestamp();
      if (nextStatus === 'picked_up') patch.pickedUpAt = serverTimestamp();
      if (nextStatus === 'completed') patch.completedAt = serverTimestamp();
      transaction.update(orderRef, patch);
    });

    if (nextStatus === 'completed') {
      state.active = null;
      $('#active-order-card')?.classList.add('hidden');
      toast('Delivery completed.');
      nextRequest();
    }
  } catch (error) {
    console.error('Order status update failed:', error);
    toast(error?.code === 'permission-denied'
      ? 'Order update permission denied. Firestore rules publish karo.'
      : 'Order update failed.', true);
  } finally {
    button.disabled = false;
  }
}

function openNavigation() {
  const order = state.active;
  if (!order) return;
  const target = order.status === 'picked_up' ? order.dropLocation : order.pickupLocation;
  if (!target) {
    toast('Location unavailable.', true);
    return;
  }
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${target.latitude},${target.longitude}`, '_blank');
}

$('#online-toggle')?.addEventListener('change', async (event) => {
  setOnlineUi(event.target.checked);
  try {
    await savePresence();
    if (state.online) nextRequest();
  } catch (error) {
    console.error('Online status save failed:', error);
    toast('Online status save nahi hua.', true);
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

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  state.unsubAvailable?.();
  state.unsubActive?.();
  state.available = [];
  state.visible = null;
  state.active = null;

  if (!user) return;

  try {
    const snapshot = await getDoc(doc(db, 'riders', user.uid));
    state.profile = snapshot.exists() ? snapshot.data() : null;
    if (!state.profile?.onboardingComplete) return;

    setOnlineUi(Boolean(state.profile.isOnline));
    listenAvailable();
    recoverActive();
  } catch (error) {
    console.error('Rider profile load failed:', error);
    toast('Rider profile load nahi hua.', true);
  }
});
