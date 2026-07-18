import { firebaseConfig } from './firebase-config.js';
import { getApp, getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  user: null,
  lastCoordinates: null,
  lastAddress: '',
  lastReverseAt: 0,
  reverseRequestId: 0,
  pendingAddress: ''
};

function number(value, fallback = NaN) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coordinatesFrom(value) {
  if (!value || typeof value !== 'object') return null;
  const latitude = number(value.latitude ?? value.lat);
  const longitude = number(value.longitude ?? value.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    accuracy: Math.max(0, number(value.accuracy, 0)),
    heading: Number.isFinite(number(value.heading)) ? number(value.heading) : null,
    speed: Number.isFinite(number(value.speed)) ? number(value.speed) : null
  };
}

function radians(value) {
  return value * Math.PI / 180;
}

function distanceMeters(first, second) {
  if (!first || !second) return Infinity;
  const dLat = radians(second.latitude - first.latitude);
  const dLon = radians(second.longitude - first.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(first.latitude))
    * Math.cos(radians(second.latitude))
    * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compactAddress(data) {
  const address = data?.address || {};
  const street = [address.house_number, address.road || address.pedestrian].filter(Boolean).join(' ');
  const locality = address.neighbourhood
    || address.suburb
    || address.residential
    || address.quarter
    || address.city_district;
  const city = address.city || address.town || address.village || address.county;
  const parts = [street, locality, city, address.state, address.postcode].filter(Boolean);
  return [...new Set(parts)].join(', ') || data?.display_name || 'Current location detected';
}

function injectStyles() {
  if (document.querySelector('[data-rider-location-styles]')) return;
  const style = document.createElement('style');
  style.dataset.riderLocationStyles = 'true';
  style.textContent = `
    .rider-current-location-card {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
      padding: 14px;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      background: #ffffff;
    }
    .rider-current-location-icon {
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      display: grid;
      place-items: center;
      border-radius: 13px;
      background: #f8cb46;
      color: #111827;
    }
    .rider-current-location-icon svg {
      width: 22px;
      height: 22px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.9;
    }
    .rider-current-location-copy {
      min-width: 0;
      flex: 1;
    }
    .rider-current-location-copy small {
      display: block;
      margin-bottom: 3px;
      color: #6b7280;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .08em;
    }
    .rider-current-location-copy strong {
      display: -webkit-box;
      overflow: hidden;
      color: #111827;
      font-size: 13px;
      line-height: 1.35;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }
    .rider-current-location-copy span {
      display: block;
      margin-top: 4px;
      color: #6b7280;
      font-size: 11px;
    }
    .rider-location-refresh {
      width: 38px;
      height: 38px;
      flex: 0 0 38px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 12px;
      background: #f3f4f6;
      color: #111827;
    }
    .rider-location-refresh:disabled { opacity: .55; }
    .rider-location-refresh svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
    }
    #profile-live-location {
      max-width: 62%;
      text-align: right;
      line-height: 1.35;
    }
  `;
  document.head.appendChild(style);
}

function ensureLocationUi() {
  injectStyles();

  const homeView = document.querySelector('#home-view');
  const availabilityCard = homeView?.querySelector('.availability-card');
  if (homeView && availabilityCard && !document.querySelector('#rider-current-location-card')) {
    const card = document.createElement('section');
    card.id = 'rider-current-location-card';
    card.className = 'rider-current-location-card';
    card.setAttribute('aria-label', 'Your current live location');
    card.innerHTML = `
      <span class="rider-current-location-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 22s7-7.58 7-13A7 7 0 1 0 5 9c0 5.42 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/></svg>
      </span>
      <span class="rider-current-location-copy">
        <small>YOUR LIVE LOCATION</small>
        <strong id="rider-current-address">Location not available</strong>
        <span id="rider-current-location-meta">Go online or refresh location</span>
      </span>
      <button id="rider-location-refresh" class="rider-location-refresh" type="button" aria-label="Refresh current location">
        <svg viewBox="0 0 24 24"><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5"/></svg>
      </button>
    `;
    homeView.insertBefore(card, availabilityCard);
    card.querySelector('#rider-location-refresh')?.addEventListener('click', requestFreshLocation);
  }

  const infoCard = document.querySelector('#profile-view .info-card');
  if (infoCard && !document.querySelector('#profile-live-location')) {
    const row = document.createElement('div');
    row.className = 'info-row';
    row.innerHTML = '<span>Live location</span><strong id="profile-live-location">—</strong>';
    infoCard.appendChild(row);
  }
}

function showAddress(address, location = null, source = 'GPS location') {
  ensureLocationUi();
  const cleanAddress = String(address || '').trim() || 'Current location detected';
  state.lastAddress = cleanAddress;
  globalThis.myQkRiderLocationAddress = cleanAddress;

  const currentAddress = document.querySelector('#rider-current-address');
  const meta = document.querySelector('#rider-current-location-meta');
  const profileAddress = document.querySelector('#profile-live-location');
  if (currentAddress) currentAddress.textContent = cleanAddress;
  if (profileAddress) profileAddress.textContent = cleanAddress;

  if (meta) {
    const accuracy = Math.round(number(location?.accuracy, 0));
    meta.textContent = accuracy > 0 ? `${source} · accuracy ±${accuracy} m` : source;
  }

  const reviewLocation = document.querySelector('#review-location');
  if (reviewLocation) {
    reviewLocation.textContent = cleanAddress;
    reviewLocation.classList.add('enabled');
  }
}

async function reverseGeocode(location, { force = false } = {}) {
  const normalized = coordinatesFrom(location);
  if (!normalized) return '';

  const moved = distanceMeters(state.lastCoordinates, normalized);
  const recent = Date.now() - state.lastReverseAt < 90_000;
  if (!force && state.lastAddress && moved < 120 && recent) {
    showAddress(state.lastAddress, normalized, 'Live GPS');
    return state.lastAddress;
  }

  const requestId = ++state.reverseRequestId;
  state.lastCoordinates = normalized;
  state.lastReverseAt = Date.now();

  const currentAddress = document.querySelector('#rider-current-address');
  if (currentAddress && !state.lastAddress) currentAddress.textContent = 'Finding your address…';

  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(normalized.latitude));
    url.searchParams.set('lon', String(normalized.longitude));
    url.searchParams.set('zoom', '18');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'en');

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Reverse geocoding failed: ${response.status}`);
    const data = await response.json();
    if (requestId !== state.reverseRequestId) return '';

    const address = compactAddress(data);
    state.pendingAddress = address;
    showAddress(address, normalized, 'Live GPS');
    return address;
  } catch (error) {
    console.warn('Rider address lookup failed:', error);
    const fallback = state.lastAddress || `${normalized.latitude.toFixed(5)}, ${normalized.longitude.toFixed(5)}`;
    showAddress(fallback, normalized, state.lastAddress ? 'Last known address' : 'GPS coordinates');
    return fallback;
  }
}

async function persistAddress(location, address) {
  if (!state.user || !address) return;
  const normalized = coordinatesFrom(location);
  if (!normalized) return;

  try {
    const riderRef = doc(db, 'riders', state.user.uid);
    const snapshot = await getDoc(riderRef);
    if (!snapshot.exists() || snapshot.data()?.onboardingComplete !== true) return;

    await setDoc(riderRef, {
      location: {
        ...normalized,
        address,
        updatedAt: serverTimestamp()
      },
      lastLocationAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.warn('Rider address could not be saved:', error);
  }
}

async function resolveAndPersist(location, options = {}) {
  const normalized = coordinatesFrom(location);
  if (!normalized) return;
  const address = await reverseGeocode(normalized, options);
  if (address) await persistAddress(normalized, address);
}

function requestFreshLocation() {
  const button = document.querySelector('#rider-location-refresh');
  if (!navigator.geolocation) return;
  if (button) button.disabled = true;

  navigator.geolocation.getCurrentPosition(async (position) => {
    const location = {
      latitude: Number(position.coords.latitude.toFixed(6)),
      longitude: Number(position.coords.longitude.toFixed(6)),
      accuracy: Math.round(position.coords.accuracy || 0),
      heading: Number.isFinite(position.coords.heading) ? Math.round(position.coords.heading) : null,
      speed: Number.isFinite(position.coords.speed) ? Number(position.coords.speed.toFixed(2)) : null
    };
    await resolveAndPersist(location, { force: true });
    if (button) button.disabled = false;
  }, () => {
    if (button) button.disabled = false;
    const meta = document.querySelector('#rider-current-location-meta');
    if (meta) meta.textContent = 'Location permission is required';
  }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 });
}

function observeOnboardingLocation() {
  const status = document.querySelector('#location-status');
  const card = document.querySelector('#location-btn');
  if (!status || !card || status.dataset.realAddressObserver === 'true') return;
  status.dataset.realAddressObserver = 'true';

  const sync = () => {
    const address = card.dataset.address?.trim();
    const latitude = number(card.dataset.latitude);
    const longitude = number(card.dataset.longitude);
    if (!address || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const location = {
      latitude,
      longitude,
      accuracy: 0
    };
    state.pendingAddress = address;
    showAddress(address, location, 'Detected address');
  };

  new MutationObserver(sync).observe(status, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true
  });
  sync();

  document.querySelector('#partner-form')?.addEventListener('submit', () => {
    const address = card.dataset.address?.trim() || state.pendingAddress;
    const latitude = number(card.dataset.latitude);
    const longitude = number(card.dataset.longitude);
    if (!address || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    window.setTimeout(() => persistAddress({ latitude, longitude, accuracy: 0 }, address), 1200);
  }, true);
}

async function loadSavedLocation(user) {
  try {
    const snapshot = await getDoc(doc(db, 'riders', user.uid));
    if (!snapshot.exists()) return;
    const profile = snapshot.data();
    const location = coordinatesFrom(profile.location);
    if (!location) return;

    const savedAddress = profile.location?.address;
    if (savedAddress) {
      state.lastCoordinates = location;
      state.lastAddress = savedAddress;
      showAddress(savedAddress, location, 'Saved live location');
      return;
    }

    await resolveAndPersist(location, { force: true });
  } catch (error) {
    console.warn('Saved rider location could not be loaded:', error);
  }
}

window.addEventListener('myqk:rider-position', (event) => {
  const location = coordinatesFrom(event.detail);
  if (location) resolveAndPersist(location).catch(() => {});
});

document.addEventListener('DOMContentLoaded', () => {
  ensureLocationUi();
  observeOnboardingLocation();
});

onAuthStateChanged(auth, (user) => {
  state.user = user;
  ensureLocationUi();
  observeOnboardingLocation();
  if (user) loadSavedLocation(user);
});
