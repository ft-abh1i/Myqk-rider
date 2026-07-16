import { firebaseConfig } from "./firebase-config.js";

const FIREBASE_VERSION = "10.12.5";
const hasFirebaseConfig = Boolean(
  firebaseConfig?.apiKey &&
  !firebaseConfig.apiKey.startsWith("YOUR_") &&
  firebaseConfig?.projectId &&
  firebaseConfig.projectId !== "YOUR_PROJECT_ID"
);

let auth = null;
let db = null;
let firebaseApi = null;
let currentUser = null;
let locationData = null;
let activeOrder = null;
let activeOrderStep = 0;
let searchTimer = null;

const DEMO_USER = {
  uid: "demo-rider",
  displayName: "Demo Rider",
  email: "demo@myqk.app",
  photoURL: ""
};

const defaultStats = {
  todayEarnings: 0,
  weeklyEarnings: 0,
  totalEarnings: 0,
  availableBalance: 0,
  deliveriesToday: 0,
  totalDeliveries: 0,
  onlineMinutes: 0,
  rating: 4.9
};

const sampleOrders = [
  {
    id: "QK2048",
    pickup: "Fresh Basket",
    pickupAddress: "Bailey Road, Patna",
    pickupDistance: "1.2 km away",
    drop: "Boring Road",
    dropAddress: "Boring Road, Patna",
    distance: "4.8 km total",
    duration: "22 min",
    items: "5 items",
    payment: "Prepaid",
    payout: 42,
    customerPhone: "tel:+910000000000",
    mapQuery: "Bailey Road Patna"
  },
  {
    id: "QK2051",
    pickup: "Daily Needs Store",
    pickupAddress: "Raja Bazar, Patna",
    pickupDistance: "0.8 km away",
    drop: "Patliputra Colony",
    dropAddress: "Patliputra Colony, Patna",
    distance: "3.6 km total",
    duration: "18 min",
    items: "3 items",
    payment: "Cash ₹386",
    payout: 36,
    customerPhone: "tel:+910000000000",
    mapQuery: "Raja Bazar Patna"
  },
  {
    id: "QK2057",
    pickup: "Quick Medico",
    pickupAddress: "Kankarbagh, Patna",
    pickupDistance: "1.5 km away",
    drop: "Rajendra Nagar",
    dropAddress: "Rajendra Nagar, Patna",
    distance: "5.2 km total",
    duration: "26 min",
    items: "2 items",
    payment: "Prepaid",
    payout: 48,
    customerPhone: "tel:+910000000000",
    mapQuery: "Kankarbagh Patna"
  }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const screens = ["loading", "login", "onboarding", "main"];

function showScreen(name) {
  screens.forEach((screen) => {
    $(`#${screen}-screen`)?.classList.toggle("active", screen === name);
  });
}

function showToast(message, type = "default") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 2600);
}

function getStorageKey(key) {
  return `myqk_rider_${currentUser?.uid || "guest"}_${key}`;
}

function readLocal(key, fallback) {
  try {
    const value = localStorage.getItem(getStorageKey(key));
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  localStorage.setItem(getStorageKey(key), JSON.stringify(value));
}

function avatarFallback(name = "Rider") {
  const initials = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" rx="44" fill="#111827"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial" font-weight="700" font-size="52">${initials || "QK"}</text></svg>`)}`;
}

function setAvatar(img, user = currentUser, profile = null) {
  if (!img) return;
  img.src = user?.photoURL || avatarFallback(profile?.fullName || user?.displayName || "Rider");
  img.onerror = () => { img.src = avatarFallback(profile?.fullName || user?.displayName || "Rider"); };
}

async function initializeFirebase() {
  if (!hasFirebaseConfig) {
    $("#auth-mode-note").textContent = "Demo mode: add Firebase config for real Google login.";
    $("#google-login-btn").lastChild.textContent = " Continue in demo mode";
    showScreen("login");
    return;
  }

  try {
    const appModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
    const authModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
    const firestoreModule = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
    const app = appModule.initializeApp(firebaseConfig);

    auth = authModule.getAuth(app);
    db = firestoreModule.getFirestore(app);
    firebaseApi = { ...authModule, ...firestoreModule };

    authModule.onAuthStateChanged(auth, async (user) => {
      if (!user) {
        currentUser = null;
        showScreen("login");
        return;
      }
      currentUser = user;
      await routeAuthenticatedUser();
    });
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    $("#auth-mode-note").textContent = "Firebase could not load. Check your config and internet connection.";
    showScreen("login");
    showToast("Firebase setup needs attention.", "error");
  }
}

async function signIn() {
  if (!hasFirebaseConfig) {
    currentUser = DEMO_USER;
    await routeAuthenticatedUser();
    return;
  }

  try {
    const provider = new firebaseApi.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await firebaseApi.signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    const message = error?.code === "auth/popup-blocked"
      ? "Popup blocked. Allow popups and try again."
      : error?.code === "auth/unauthorized-domain"
        ? "Add this website domain to Firebase Authorized domains."
        : "Google sign-in failed. Please try again.";
    showToast(message, "error");
  }
}

async function signOutUser() {
  setOnline(false, false);
  if (auth && hasFirebaseConfig) await firebaseApi.signOut(auth);
  currentUser = null;
  locationData = null;
  activeOrder = null;
  showScreen("login");
}

async function routeAuthenticatedUser() {
  showScreen("loading");
  const profile = await loadProfile();
  if (profile?.onboardingComplete) {
    hydrateDashboard(profile);
    showScreen("main");
  } else {
    hydrateOnboarding(profile);
    showScreen("onboarding");
  }
}

async function loadProfile() {
  if (!currentUser) return null;
  if (db && hasFirebaseConfig) {
    try {
      const snapshot = await firebaseApi.getDoc(firebaseApi.doc(db, "riders", currentUser.uid));
      if (snapshot.exists()) {
        const profile = snapshot.data();
        writeLocal("profile", profile);
        return profile;
      }
    } catch (error) {
      console.error("Could not read rider profile:", error);
    }
  }
  return readLocal("profile", null);
}

async function saveProfile(profile) {
  writeLocal("profile", profile);
  if (db && hasFirebaseConfig) {
    await firebaseApi.setDoc(
      firebaseApi.doc(db, "riders", currentUser.uid),
      profile,
      { merge: true }
    );
  }
}

function hydrateOnboarding(profile = {}) {
  const displayName = profile?.fullName || currentUser?.displayName || "New partner";
  $("#onboarding-email-name").textContent = displayName;
  $("#onboarding-email").textContent = currentUser?.email || "Signed in with Google";
  setAvatar($("#onboarding-avatar"), currentUser, profile);
  $("#full-name").value = profile?.fullName || currentUser?.displayName || "";
  $("#phone-number").value = profile?.phone || "";
  $("#city").value = profile?.city || "";
  $("#vehicle-number").value = profile?.vehicleNumber || "";
  if (profile?.vehicleType) {
    const input = $(`input[name="vehicleType"][value="${profile.vehicleType}"]`);
    if (input) input.checked = true;
  }
  locationData = profile?.location || null;
  updateLocationCard();
  updateVehicleField();
}

function updateVehicleField() {
  const selected = $('input[name="vehicleType"]:checked')?.value;
  const field = $("#vehicle-number-field");
  const input = $("#vehicle-number");
  const cycle = selected === "Cycle";
  field.classList.toggle("hidden", cycle);
  input.required = !cycle;
  if (cycle) input.value = "Not applicable";
  else if (input.value === "Not applicable") input.value = "";
}

function requestLocation() {
  if (!navigator.geolocation) {
    showToast("Location is not supported on this device.", "error");
    return;
  }

  $("#location-title").textContent = "Getting your location…";
  $("#location-status").textContent = "Please allow location access";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      locationData = {
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
        accuracy: Math.round(position.coords.accuracy),
        updatedAt: new Date().toISOString()
      };
      updateLocationCard();
      showToast("Live location access granted.");
    },
    (error) => {
      console.error(error);
      locationData = null;
      updateLocationCard();
      showToast("Location permission is required to receive orders.", "error");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function updateLocationCard() {
  const card = $("#location-btn");
  if (locationData) {
    card.classList.add("granted");
    $("#location-title").textContent = "Live location enabled";
    $("#location-status").textContent = `${locationData.latitude}, ${locationData.longitude} · ±${locationData.accuracy}m`;
  } else {
    card.classList.remove("granted");
    $("#location-title").textContent = "Allow live location";
    $("#location-status").textContent = "Tap to share your current location";
  }
}

async function completeOnboarding(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const phone = $("#phone-number").value.trim();
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  if (!/^\d{10}$/.test(phone)) {
    showToast("Enter a valid 10-digit mobile number.", "error");
    $("#phone-number").focus();
    return;
  }
  if (!locationData) {
    showToast("Allow live location before continuing.", "error");
    return;
  }

  const button = $("#complete-setup-btn");
  button.disabled = true;
  button.textContent = "Saving profile…";
  const profile = {
    uid: currentUser.uid,
    fullName: $("#full-name").value.trim(),
    email: currentUser.email || "",
    photoURL: currentUser.photoURL || "",
    phone,
    city: $("#city").value.trim(),
    vehicleType: $('input[name="vehicleType"]:checked').value,
    vehicleNumber: $("#vehicle-number").value.trim(),
    location: locationData,
    termsAccepted: true,
    termsAcceptedAt: new Date().toISOString(),
    onboardingComplete: true,
    status: "offline",
    updatedAt: new Date().toISOString()
  };

  try {
    await saveProfile(profile);
    hydrateDashboard(profile);
    showScreen("main");
    showToast("Partner profile created successfully.");
  } catch (error) {
    console.error(error);
    showToast("Profile could not be saved. Try again.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Complete setup";
  }
}

function getStats() {
  return { ...defaultStats, ...readLocal("stats", {}) };
}

function saveStats(stats) {
  writeLocal("stats", stats);
  renderStats();
}

function getHistory() {
  return readLocal("orders", []);
}

function saveHistory(history) {
  writeLocal("orders", history);
  renderOrders();
  renderTransactions();
}

function hydrateDashboard(profile) {
  const name = profile?.fullName || currentUser?.displayName || "Partner";
  $("#header-name").textContent = name.split(" ")[0];
  $("#profile-name").textContent = name;
  $("#profile-email").textContent = profile?.email || currentUser?.email || "—";
  $("#profile-phone").textContent = profile?.phone || "—";
  $("#profile-city").textContent = profile?.city || "—";
  $("#profile-vehicle").textContent = profile?.vehicleType || "—";
  $("#profile-vehicle-number").textContent = profile?.vehicleNumber || "—";
  setAvatar($("#header-avatar"), currentUser, profile);
  setAvatar($("#profile-avatar"), currentUser, profile);
  renderStats();
  renderOrders();
  renderTransactions();
  setOnline(false, false);
  switchView("home");
}

function renderStats() {
  const stats = getStats();
  const rupees = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
  $("#today-earnings").textContent = rupees(stats.todayEarnings);
  $("#today-deliveries").textContent = stats.deliveriesToday;
  $("#available-balance").textContent = rupees(stats.availableBalance);
  $("#earnings-today").textContent = rupees(stats.todayEarnings);
  $("#earnings-week").textContent = rupees(stats.weeklyEarnings);
  $("#earnings-total").textContent = rupees(stats.totalEarnings);
  $("#profile-rating").textContent = Number(stats.rating).toFixed(1);
  $("#profile-deliveries").textContent = stats.totalDeliveries;
  $("#profile-online-hours").textContent = `${Math.floor(stats.onlineMinutes / 60)}h`;
}

function setOnline(isOnline, notify = true) {
  $("#online-toggle").checked = isOnline;
  $("#availability-badge").textContent = isOnline ? "Online" : "Offline";
  $("#availability-badge").className = `availability-badge ${isOnline ? "online" : "offline"}`;
  $("#availability-title").textContent = isOnline ? "You are online" : "You are offline";
  $("#availability-text").textContent = isOnline
    ? "Stay ready. New requests will appear automatically."
    : "Go online to receive nearby delivery requests.";
  $("#offline-state").classList.toggle("hidden", isOnline || Boolean(activeOrder));

  clearTimeout(searchTimer);
  if (!isOnline) {
    $("#searching-state").classList.add("hidden");
    $("#order-request").classList.add("hidden");
    $("#request-count").textContent = "0 available";
  } else if (!activeOrder) {
    beginOrderSearch();
  }

  if (notify) showToast(isOnline ? "You are now online." : "You are now offline.");
}

function beginOrderSearch() {
  $("#offline-state").classList.add("hidden");
  $("#order-request").classList.add("hidden");
  $("#searching-state").classList.remove("hidden");
  $("#request-count").textContent = "Searching";
  searchTimer = setTimeout(() => showNextOrder(), 1500);
}

function showNextOrder() {
  const index = Number(readLocal("sampleIndex", 0)) % sampleOrders.length;
  const order = sampleOrders[index];
  writeLocal("sampleIndex", index + 1);
  populateOrderRequest(order);
  $("#searching-state").classList.add("hidden");
  $("#order-request").classList.remove("hidden");
  $("#request-count").textContent = "1 available";
}

function populateOrderRequest(order) {
  $("#order-id").textContent = `#${order.id}`;
  $("#order-payout").textContent = `₹${order.payout}`;
  $("#pickup-store").textContent = `${order.pickup}, ${order.pickupAddress.split(",")[0]}`;
  $("#pickup-distance").textContent = order.pickupDistance;
  $("#drop-area").textContent = order.dropAddress;
  $("#order-distance").textContent = order.distance;
  $("#order-time").textContent = order.duration;
  $("#order-items").textContent = order.items;
  $("#payment-mode").textContent = order.payment;
  $("#order-request").dataset.orderId = order.id;
}

function acceptOrder() {
  const id = $("#order-request").dataset.orderId;
  activeOrder = sampleOrders.find((order) => order.id === id);
  if (!activeOrder) return;
  activeOrderStep = 0;
  $("#order-request").classList.add("hidden");
  $("#active-order-card").classList.remove("hidden");
  $("#request-count").textContent = "1 active";
  renderActiveOrder();
  showToast(`Order ${activeOrder.id} accepted.`);
}

function skipOrder() {
  $("#order-request").classList.add("hidden");
  $("#searching-state").classList.remove("hidden");
  $("#request-count").textContent = "Searching";
  searchTimer = setTimeout(() => showNextOrder(), 1100);
  showToast("Order skipped. Finding another request.");
}

function renderActiveOrder() {
  if (!activeOrder) return;
  const steps = [
    { chip: "TO PICKUP", progress: "25%", type: "Pickup from", name: activeOrder.pickup, address: activeOrder.pickupAddress, button: "I have arrived" },
    { chip: "AT STORE", progress: "50%", type: "Collect order from", name: activeOrder.pickup, address: `Show order ID ${activeOrder.id} at the counter`, button: "Confirm pickup" },
    { chip: "TO CUSTOMER", progress: "75%", type: "Deliver to", name: activeOrder.drop, address: activeOrder.dropAddress, button: "Mark as delivered" }
  ];
  const step = steps[Math.min(activeOrderStep, steps.length - 1)];
  $("#active-step-label").textContent = step.chip;
  $("#active-progress").style.width = step.progress;
  $("#active-order-id").textContent = `Order #${activeOrder.id}`;
  $("#active-destination-type").textContent = step.type;
  $("#active-destination-name").textContent = step.name;
  $("#active-destination-address").textContent = step.address;
  $("#advance-order-btn").textContent = step.button;
}

function advanceOrder() {
  if (!activeOrder) return;
  if (activeOrderStep < 2) {
    activeOrderStep += 1;
    renderActiveOrder();
    showToast(activeOrderStep === 1 ? "Arrival confirmed." : "Pickup confirmed. Deliver safely.");
    return;
  }
  completeActiveOrder();
}

function completeActiveOrder() {
  const finished = {
    ...activeOrder,
    status: "completed",
    completedAt: new Date().toISOString()
  };
  const history = [finished, ...getHistory()];
  saveHistory(history);
  const stats = getStats();
  stats.todayEarnings += activeOrder.payout;
  stats.weeklyEarnings += activeOrder.payout;
  stats.totalEarnings += activeOrder.payout;
  stats.availableBalance += activeOrder.payout;
  stats.deliveriesToday += 1;
  stats.totalDeliveries += 1;
  saveStats(stats);

  activeOrder = null;
  activeOrderStep = 0;
  $("#active-order-card").classList.add("hidden");
  $("#request-count").textContent = "Searching";
  showToast("Delivery completed. Earnings added.");
  if ($("#online-toggle").checked) beginOrderSearch();
}

function renderOrders(filter = document.querySelector(".order-tab.active")?.dataset.filter || "all") {
  const list = $("#orders-list");
  if (!list) return;
  const history = getHistory().filter((order) => filter === "all" || order.status === filter);
  if (!history.length) {
    list.innerHTML = '<div class="empty-list">No orders in this section yet.</div>';
    return;
  }
  list.innerHTML = history.map((order) => {
    const date = new Date(order.completedAt || order.cancelledAt || Date.now()).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    return `<article class="history-card">
      <div class="history-head"><div><h4>Order #${order.id}</h4><p>${date}</p></div><span class="history-status ${order.status}">${order.status}</span></div>
      <div class="history-route"><svg viewBox="0 0 24 24"><path d="M5 12h14M14 7l5 5-5 5"/></svg><span>${order.pickup} → ${order.drop}</span></div>
      <div class="history-foot"><span>${order.distance}</span><strong>${order.status === "completed" ? `+₹${order.payout}` : "₹0"}</strong></div>
    </article>`;
  }).join("");
}

function renderTransactions() {
  const list = $("#transactions-list");
  if (!list) return;
  const completed = getHistory().filter((order) => order.status === "completed");
  if (!completed.length) {
    list.innerHTML = '<div class="empty-list">Completed delivery earnings will appear here.</div>';
    return;
  }
  list.innerHTML = completed.map((order) => {
    const date = new Date(order.completedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    return `<article class="transaction-card">
      <span class="transaction-icon"><svg viewBox="0 0 24 24"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg></span>
      <div><h4>Delivery #${order.id}</h4><p>${date}</p></div><strong>+₹${order.payout}</strong>
    </article>`;
  }).join("");
}

function switchView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}-view`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  $("#main-content").scrollTop = 0;
}

function openModal(id) {
  const modal = $(`#${id}`);
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  const modal = $(`#${id}`);
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function openNavigation() {
  if (!activeOrder) return;
  const query = activeOrderStep < 2 ? activeOrder.pickupAddress : activeOrder.dropAddress;
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`, "_blank", "noopener");
}

async function editProfile() {
  const profile = await loadProfile();
  hydrateOnboarding(profile || {});
  showScreen("onboarding");
}

function bindEvents() {
  $("#google-login-btn").addEventListener("click", signIn);
  $("#onboarding-logout-btn").addEventListener("click", signOutUser);
  $("#logout-btn").addEventListener("click", signOutUser);
  $("#partner-form").addEventListener("submit", completeOnboarding);
  $("#location-btn").addEventListener("click", requestLocation);
  $("#terms-link").addEventListener("click", () => openModal("terms-modal"));
  $$('[data-close-modal]').forEach((element) => element.addEventListener("click", () => closeModal(element.dataset.closeModal)));
  $$('input[name="vehicleType"]').forEach((input) => input.addEventListener("change", updateVehicleField));
  $("#vehicle-number").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase(); });
  $("#phone-number").addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 10); });
  $("#online-toggle").addEventListener("change", (event) => setOnline(event.target.checked));
  $("#accept-order-btn").addEventListener("click", acceptOrder);
  $("#reject-order-btn").addEventListener("click", skipOrder);
  $("#advance-order-btn").addEventListener("click", advanceOrder);
  $("#open-navigation-btn").addEventListener("click", openNavigation);
  $("#call-action-btn").addEventListener("click", () => { if (activeOrder) window.location.href = activeOrder.customerPhone; });
  $("#header-profile-btn").addEventListener("click", () => switchView("profile"));
  $$(".nav-item").forEach((item) => item.addEventListener("click", () => switchView(item.dataset.view)));
  $$('[data-nav]').forEach((item) => item.addEventListener("click", () => switchView(item.dataset.nav)));
  $$(".order-tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".order-tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    renderOrders(tab.dataset.filter);
  }));
  $("#withdraw-btn").addEventListener("click", () => showToast("Payout request flow will be connected with your payment backend."));
  $("#notification-btn").addEventListener("click", () => showToast("No new notifications."));
  $("#support-btn").addEventListener("click", () => showToast("Support contact will be added before launch."));
  $("#edit-profile-btn").addEventListener("click", editProfile);
}

bindEvents();
initializeFirebase();
