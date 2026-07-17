import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "10.12.5";
const MAX_ORDER_DISTANCE_KM = 8;

const $ = (selector) => document.querySelector(selector);
const state = {
  auth: null,
  db: null,
  api: null,
  user: null,
  profile: null,
  online: false,
  pendingOrders: [],
  visibleOrder: null,
  activeOrder: null,
  unsubscribeOrders: null,
  unsubscribeActive: null,
  step: 0
};

function toast(message, error = false) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.className = "toast"; }, 2800);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function radians(value) {
  return value * Math.PI / 180;
}

function distanceKm(from, to) {
  if (!from || !to) return Infinity;
  const lat1 = number(from.latitude ?? from.lat, NaN);
  const lon1 = number(from.longitude ?? from.lng, NaN);
  const lat2 = number(to.latitude ?? to.lat, NaN);
  const lon2 = number(to.longitude ?? to.lng, NaN);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;

  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizedOrder(snapshot) {
  const data = snapshot.data();
  const pickup = data.pickup || {};
  const drop = data.drop || {};
  const riderLocation = state.profile?.location;
  const pickupLocation = pickup.location || data.pickupLocation;
  const kmToPickup = distanceKm(riderLocation, pickupLocation);

  return {
    firestoreId: snapshot.id,
    id: data.orderNumber || snapshot.id,
    status: data.status || "pending",
    pickup: pickup.name || data.pickupName || "Pickup store",
    pickupAddress: pickup.address || data.pickupAddress || "Pickup address",
    pickupLocation,
    pickupDistance: Number.isFinite(kmToPickup) ? `${kmToPickup.toFixed(1)} km away` : "Nearby",
    drop: drop.name || data.customerName || "Customer",
    dropAddress: drop.address || data.dropAddress || "Delivery address",
    dropLocation: drop.location || data.dropLocation,
    distance: data.distanceText || (number(data.distanceKm) ? `${number(data.distanceKm).toFixed(1)} km total` : "Distance pending"),
    duration: data.durationText || "20–30 min",
    items: `${number(data.itemCount, Array.isArray(data.items) ? data.items.length : 1)} items`,
    payment: data.paymentMode || "Prepaid",
    payout: number(data.riderPayout ?? data.payout, 0),
    customerPhone: data.customerPhone ? `tel:${String(data.customerPhone).replace(/[^+\d]/g, "")}` : null,
    createdAt: data.createdAt,
    raw: data,
    kmToPickup
  };
}

function setOnlineUi(online) {
  state.online = online;
  const toggle = $("#online-toggle");
  if (toggle) toggle.checked = online;
  $("#availability-badge").textContent = online ? "Online" : "Offline";
  $("#availability-badge").className = `availability-badge ${online ? "online" : "offline"}`;
  $("#availability-title").textContent = online ? "You are online" : "You are offline";
  $("#availability-text").textContent = online
    ? "Stay ready. New requests will appear automatically."
    : "Go online to receive nearby delivery requests.";
  $("#offline-state").classList.toggle("hidden", online || Boolean(state.activeOrder));
  $("#searching-state").classList.toggle("hidden", !online || Boolean(state.visibleOrder) || Boolean(state.activeOrder));
  if (!online) {
    $("#order-request").classList.add("hidden");
    $("#request-count").textContent = state.activeOrder ? "1 active" : "0 available";
  }
}

async function saveRiderPresence(online) {
  if (!state.user || !state.db) return;
  const location = state.profile?.location || null;
  await state.api.setDoc(state.api.doc(state.db, "riders", state.user.uid), {
    status: online ? "online" : "offline",
    isOnline: online,
    location,
    lastSeenAt: state.api.serverTimestamp()
  }, { merge: true });
}

function populateRequest(order) {
  state.visibleOrder = order;
  $("#order-id").textContent = `#${order.id}`;
  $("#order-payout").textContent = `₹${order.payout}`;
  $("#pickup-store").textContent = order.pickup;
  $("#pickup-distance").textContent = order.pickupDistance;
  $("#drop-area").textContent = order.dropAddress;
  $("#order-distance").textContent = order.distance;
  $("#order-time").textContent = order.duration;
  $("#order-items").textContent = order.items;
  $("#payment-mode").textContent = order.payment;
  $("#searching-state").classList.add("hidden");
  $("#order-request").classList.remove("hidden");
  $("#request-count").textContent = `${state.pendingOrders.length} available`;
}

function showNextPendingOrder() {
  if (!state.online || state.activeOrder) return;
  const next = state.pendingOrders.find((order) => order.firestoreId !== state.visibleOrder?.firestoreId)
    || state.pendingOrders[0];
  if (next) populateRequest(next);
  else {
    state.visibleOrder = null;
    $("#order-request").classList.add("hidden");
    $("#searching-state").classList.remove("hidden");
    $("#request-count").textContent = "0 available";
  }
}

function listenForPendingOrders() {
  state.unsubscribeOrders?.();
  const ordersQuery = state.api.query(
    state.api.collection(state.db, "orders"),
    state.api.where("status", "==", "pending"),
    state.api.limit(25)
  );

  state.unsubscribeOrders = state.api.onSnapshot(ordersQuery, (snapshot) => {
    state.pendingOrders = snapshot.docs
      .map(normalizedOrder)
      .filter((order) => !Number.isFinite(order.kmToPickup) || order.kmToPickup <= MAX_ORDER_DISTANCE_KM)
      .sort((a, b) => a.kmToPickup - b.kmToPickup);

    if (state.visibleOrder && !state.pendingOrders.some((order) => order.firestoreId === state.visibleOrder.firestoreId)) {
      state.visibleOrder = null;
    }
    showNextPendingOrder();
  }, (error) => {
    console.error("Order listener failed", error);
    toast("Orders load nahi hue. Firestore rules check karo.", true);
  });
}

async function acceptVisibleOrder() {
  const order = state.visibleOrder;
  if (!order || !state.user) return;
  const button = $("#accept-order-btn");
  button.disabled = true;
  button.textContent = "Accepting…";

  try {
    const ref = state.api.doc(state.db, "orders", order.firestoreId);
    await state.api.runTransaction(state.db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists()) throw new Error("ORDER_NOT_FOUND");
      const current = snapshot.data();
      if (current.status !== "pending" || current.assignedRiderId) throw new Error("ALREADY_ACCEPTED");
      transaction.update(ref, {
        status: "accepted",
        assignedRiderId: state.user.uid,
        assignedRiderName: state.profile?.fullName || state.user.displayName || "Rider",
        acceptedAt: state.api.serverTimestamp(),
        updatedAt: state.api.serverTimestamp()
      });
    });

    state.activeOrder = order;
    state.visibleOrder = null;
    state.step = 0;
    $("#order-request").classList.add("hidden");
    $("#searching-state").classList.add("hidden");
    $("#active-order-card").classList.remove("hidden");
    $("#request-count").textContent = "1 active";
    renderActiveOrder();
    listenToActiveOrder(order.firestoreId);
    toast(`Order ${order.id} accepted.`);
  } catch (error) {
    console.error(error);
    toast(error.message === "ALREADY_ACCEPTED" ? "Ye order kisi aur rider ne accept kar liya." : "Order accept nahi hua.", true);
    showNextPendingOrder();
  } finally {
    button.disabled = false;
    button.textContent = "Accept order";
  }
}

function listenToActiveOrder(orderId) {
  state.unsubscribeActive?.();
  state.unsubscribeActive = state.api.onSnapshot(state.api.doc(state.db, "orders", orderId), (snapshot) => {
    if (!snapshot.exists()) return;
    const fresh = normalizedOrder(snapshot);
    state.activeOrder = { ...state.activeOrder, ...fresh };
    const statusToStep = { accepted: 0, arrived_pickup: 1, picked_up: 2 };
    if (statusToStep[fresh.status] !== undefined) state.step = statusToStep[fresh.status];
    if (fresh.status === "completed" || fresh.status === "cancelled") finishOrderLocally(fresh.status);
    else renderActiveOrder();
  });
}

function renderActiveOrder() {
  const order = state.activeOrder;
  if (!order) return;
  const steps = [
    { chip: "TO PICKUP", progress: "25%", type: "Pickup from", name: order.pickup, address: order.pickupAddress, button: "I have arrived" },
    { chip: "AT STORE", progress: "50%", type: "Collect order from", name: order.pickup, address: `Show order ID ${order.id} at the counter`, button: "Confirm pickup" },
    { chip: "TO CUSTOMER", progress: "75%", type: "Deliver to", name: order.drop, address: order.dropAddress, button: "Mark as delivered" }
  ];
  const step = steps[Math.min(state.step, 2)];
  $("#active-step-label").textContent = step.chip;
  $("#active-progress").style.width = step.progress;
  $("#active-order-id").textContent = `Order #${order.id}`;
  $("#active-destination-type").textContent = step.type;
  $("#active-destination-name").textContent = step.name;
  $("#active-destination-address").textContent = step.address;
  $("#advance-order-btn").textContent = step.button;
}

async function advanceActiveOrder() {
  if (!state.activeOrder) return;
  const statuses = ["arrived_pickup", "picked_up", "completed"];
  const nextStatus = statuses[Math.min(state.step, 2)];
  const update = {
    status: nextStatus,
    updatedAt: state.api.serverTimestamp()
  };
  if (nextStatus === "arrived_pickup") update.arrivedPickupAt = state.api.serverTimestamp();
  if (nextStatus === "picked_up") update.pickedUpAt = state.api.serverTimestamp();
  if (nextStatus === "completed") update.completedAt = state.api.serverTimestamp();

  try {
    await state.api.updateDoc(state.api.doc(state.db, "orders", state.activeOrder.firestoreId), update);
    if (nextStatus !== "completed") {
      state.step += 1;
      renderActiveOrder();
      toast(nextStatus === "picked_up" ? "Pickup confirmed. Deliver safely." : "Arrival confirmed.");
    }
  } catch (error) {
    console.error(error);
    toast("Order status update nahi hua.", true);
  }
}

function finishOrderLocally(status) {
  state.unsubscribeActive?.();
  state.unsubscribeActive = null;
  state.activeOrder = null;
  state.step = 0;
  $("#active-order-card").classList.add("hidden");
  toast(status === "completed" ? "Delivery completed." : "Order cancelled.");
  showNextPendingOrder();
}

function openNavigation() {
  const order = state.activeOrder;
  if (!order) return;
  const location = state.step < 2 ? order.pickupLocation : order.dropLocation;
  const address = state.step < 2 ? order.pickupAddress : order.dropAddress;
  const query = location
    ? `${location.latitude ?? location.lat},${location.longitude ?? location.lng}`
    : address;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, "_blank", "noopener");
}

async function loadRiderProfile() {
  if (!state.user) return;
  const snapshot = await state.api.getDoc(state.api.doc(state.db, "riders", state.user.uid));
  state.profile = snapshot.exists() ? snapshot.data() : null;
}

async function handleOnlineToggle(event) {
  event.stopImmediatePropagation();
  const online = event.target.checked;
  if (online && !state.profile?.location) {
    event.target.checked = false;
    toast("Pehle profile me live location allow karo.", true);
    return;
  }
  setOnlineUi(online);
  try {
    await saveRiderPresence(online);
    if (online) listenForPendingOrders();
    else state.unsubscribeOrders?.();
    toast(online ? "You are now online." : "You are now offline.");
  } catch (error) {
    console.error(error);
    setOnlineUi(!online);
    toast("Online status update nahi hua.", true);
  }
}

function captureClick(selector, handler) {
  $(selector)?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    handler(event);
  }, true);
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

    $("#online-toggle")?.addEventListener("change", handleOnlineToggle, true);
    captureClick("#accept-order-btn", acceptVisibleOrder);
    captureClick("#reject-order-btn", () => {
      state.visibleOrder = null;
      $("#order-request").classList.add("hidden");
      showNextPendingOrder();
      toast("Order skipped.");
    });
    captureClick("#advance-order-btn", advanceActiveOrder);
    captureClick("#open-navigation-btn", openNavigation);
    captureClick("#call-action-btn", () => {
      if (state.activeOrder?.customerPhone) window.location.href = state.activeOrder.customerPhone;
      else toast("Customer phone available nahi hai.", true);
    });

    authModule.onAuthStateChanged(state.auth, async (user) => {
      state.user = user;
      state.unsubscribeOrders?.();
      state.unsubscribeActive?.();
      if (!user) return;
      try {
        await loadRiderProfile();
        setOnlineUi(false);
      } catch (error) {
        console.error("Rider profile load failed", error);
      }
    });
  } catch (error) {
    console.error("Firestore order module failed", error);
    toast("Live order system initialize nahi hua.", true);
  }
}

initialize();
