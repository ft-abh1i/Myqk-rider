const locationStatus = document.querySelector("#location-status");
const locationCard = document.querySelector("#location-btn");
const vehicleNumberInput = document.querySelector("#vehicle-number");

const STANDARD_VEHICLE_NUMBER = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$/;
const BH_VEHICLE_NUMBER = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;

function normalizeVehicleNumber(value = "") {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatVehicleNumber(value = "") {
  const normalized = normalizeVehicleNumber(value);

  if (/^[0-9]{2}BH/.test(normalized)) {
    const parts = [
      normalized.slice(0, 2),
      normalized.slice(2, 4),
      normalized.slice(4, 8),
      normalized.slice(8, 10)
    ].filter(Boolean);
    return parts.join(" ");
  }

  const match = normalized.match(/^([A-Z]{0,2})([0-9]{0,2})([A-Z]{0,3})([0-9]{0,4})/);
  return match ? match.slice(1).filter(Boolean).join(" ") : normalized;
}

function isValidIndianVehicleNumber(value = "") {
  const normalized = normalizeVehicleNumber(value);
  return STANDARD_VEHICLE_NUMBER.test(normalized) || BH_VEHICLE_NUMBER.test(normalized);
}

if (vehicleNumberInput) {
  vehicleNumberInput.maxLength = 15;
  vehicleNumberInput.autocomplete = "off";
  vehicleNumberInput.placeholder = "BR 01 AB 1234";
  vehicleNumberInput.setAttribute("aria-describedby", "vehicle-number-help");

  const help = document.createElement("small");
  help.id = "vehicle-number-help";
  help.className = "field-help";
  help.textContent = "Enter a valid Indian registration number, e.g. BR 01 AB 1234.";
  vehicleNumberInput.insertAdjacentElement("afterend", help);

  vehicleNumberInput.addEventListener("input", () => {
    vehicleNumberInput.value = formatVehicleNumber(vehicleNumberInput.value);
    vehicleNumberInput.setCustomValidity("");
  });

  vehicleNumberInput.addEventListener("blur", () => {
    const selectedVehicle = document.querySelector('input[name="vehicleType"]:checked')?.value;
    if (selectedVehicle !== "Cycle" && vehicleNumberInput.value.trim() && !isValidIndianVehicleNumber(vehicleNumberInput.value)) {
      vehicleNumberInput.setCustomValidity("Enter a valid Indian vehicle number, e.g. BR 01 AB 1234.");
      vehicleNumberInput.reportValidity();
    } else {
      vehicleNumberInput.setCustomValidity("");
    }
  });
}

let lastCoordinates = "";
let reverseRequestId = 0;

function compactAddress(data) {
  const address = data?.address || {};
  const parts = [
    address.road || address.pedestrian || address.neighbourhood || address.suburb,
    address.city || address.town || address.village || address.county,
    address.state,
    address.postcode
  ].filter(Boolean);

  return [...new Set(parts)].join(", ") || data?.display_name || "Current location detected";
}

async function reverseGeocode(latitude, longitude) {
  const requestId = ++reverseRequestId;
  locationStatus.textContent = "Finding your address…";

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", latitude);
    url.searchParams.set("lon", longitude);
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");

    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Reverse geocoding failed: ${response.status}`);

    const data = await response.json();
    if (requestId !== reverseRequestId) return;

    const address = compactAddress(data);
    locationStatus.textContent = address;
    locationCard.dataset.address = address;
    locationCard.dataset.latitude = latitude;
    locationCard.dataset.longitude = longitude;
  } catch (error) {
    console.error(error);
    if (requestId !== reverseRequestId) return;
    locationStatus.textContent = "Location enabled · address unavailable";
  }
}

function detectCoordinates() {
  if (!locationStatus || !locationCard?.classList.contains("granted")) return;

  const text = locationStatus.textContent.trim();
  const match = text.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return;

  const coordinates = `${match[1]},${match[2]}`;
  if (coordinates === lastCoordinates) return;
  lastCoordinates = coordinates;
  reverseGeocode(match[1], match[2]);
}

if (locationStatus) {
  new MutationObserver(detectCoordinates).observe(locationStatus, {
    childList: true,
    characterData: true,
    subtree: true
  });
  detectCoordinates();
}
