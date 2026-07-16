const STEP_TITLES = ["Personal details", "Delivery setup", "Review & finish"];
const STEP_LABELS = ["Details", "Vehicle", "Review"];

function setupOnboardingSteps() {
  const screen = document.querySelector("#onboarding-screen");
  const content = screen?.querySelector(".onboarding-content");
  const form = document.querySelector("#partner-form");

  if (!screen || !content || !form || form.dataset.multiStepReady === "true") return;
  form.dataset.multiStepReady = "true";

  const profilePreview = content.querySelector(".profile-preview");
  const sections = [...form.querySelectorAll(":scope > .form-section")];
  const personalSection = sections[0];
  const vehicleSection = sections[1];
  const locationSection = sections[2];
  const termsRow = form.querySelector(".terms-row");
  const submitButton = document.querySelector("#complete-setup-btn");
  const headerEyebrow = screen.querySelector(".simple-topbar .eyebrow");
  const headerTitle = screen.querySelector(".simple-topbar h2");

  if (!profilePreview || !personalSection || !vehicleSection || !locationSection || !termsRow || !submitButton) return;

  const progress = document.createElement("div");
  progress.className = "onboarding-progress";
  progress.setAttribute("aria-label", "Partner setup progress");
  progress.innerHTML = STEP_LABELS.map((label, index) => `
    <div class="setup-progress-item" data-progress-step="${index + 1}">
      <span class="setup-progress-dot">${index + 1}</span>
      <small>${label}</small>
    </div>
  `).join("");

  const createPage = (step, title, description) => {
    const page = document.createElement("section");
    page.className = "onboarding-step-page";
    page.dataset.setupStep = String(step);
    page.setAttribute("aria-label", `Step ${step}: ${title}`);
    page.innerHTML = `
      <div class="setup-page-heading">
        <span>STEP ${step} OF 3</span>
        <h3>${title}</h3>
        <p>${description}</p>
      </div>
    `;
    return page;
  };

  const stepOne = createPage(1, "Tell us about yourself", "Add the basic details used for your rider account.");
  const stepTwo = createPage(2, "How will you deliver?", "Select your vehicle and enable live location for nearby orders.");
  const stepThree = createPage(3, "Review your details", "Check everything once before creating your delivery partner profile.");

  const reviewCard = document.createElement("div");
  reviewCard.className = "setup-review-card";
  reviewCard.innerHTML = `
    <div class="setup-review-row"><span>Full name</span><strong id="review-full-name">—</strong></div>
    <div class="setup-review-row"><span>Mobile</span><strong id="review-phone">—</strong></div>
    <div class="setup-review-row"><span>City</span><strong id="review-city">—</strong></div>
    <div class="setup-review-row"><span>Vehicle</span><strong id="review-vehicle">—</strong></div>
    <div class="setup-review-row"><span>Vehicle number</span><strong id="review-vehicle-number">—</strong></div>
    <div class="setup-review-row"><span>Live location</span><strong id="review-location" class="review-status">Not enabled</strong></div>
  `;

  const locationError = document.createElement("p");
  locationError.id = "location-step-error";
  locationError.className = "setup-inline-error hidden";
  locationError.textContent = "Enable live location before continuing.";

  const stepOneActions = document.createElement("div");
  stepOneActions.className = "setup-actions single-action";
  stepOneActions.innerHTML = '<button id="setup-next-1" class="setup-btn setup-primary" type="button">Continue</button>';

  const stepTwoActions = document.createElement("div");
  stepTwoActions.className = "setup-actions";
  stepTwoActions.innerHTML = `
    <button id="setup-back-2" class="setup-btn setup-secondary" type="button">Back</button>
    <button id="setup-next-2" class="setup-btn setup-primary" type="button">Continue</button>
  `;

  const stepThreeActions = document.createElement("div");
  stepThreeActions.className = "setup-actions";
  const backThree = document.createElement("button");
  backThree.id = "setup-back-3";
  backThree.className = "setup-btn setup-secondary";
  backThree.type = "button";
  backThree.textContent = "Back";
  submitButton.classList.add("setup-btn", "setup-primary");
  stepThreeActions.append(backThree, submitButton);

  stepOne.append(profilePreview, personalSection, stepOneActions);
  stepTwo.append(vehicleSection, locationSection, locationError, stepTwoActions);
  stepThree.append(reviewCard, termsRow, stepThreeActions);

  form.replaceChildren(stepOne, stepTwo, stepThree);
  content.insertBefore(progress, form);

  let currentStep = 1;

  function updateReview() {
    const vehicle = document.querySelector('input[name="vehicleType"]:checked')?.value || "—";
    const vehicleNumber = document.querySelector("#vehicle-number")?.value.trim() || "—";
    const locationEnabled = document.querySelector("#location-btn")?.classList.contains("granted");

    document.querySelector("#review-full-name").textContent = document.querySelector("#full-name")?.value.trim() || "—";
    document.querySelector("#review-phone").textContent = document.querySelector("#phone-number")?.value.trim() || "—";
    document.querySelector("#review-city").textContent = document.querySelector("#city")?.value.trim() || "—";
    document.querySelector("#review-vehicle").textContent = vehicle;
    document.querySelector("#review-vehicle-number").textContent = vehicle === "Cycle" ? "Not required" : vehicleNumber;

    const locationReview = document.querySelector("#review-location");
    locationReview.textContent = locationEnabled ? "Enabled" : "Not enabled";
    locationReview.classList.toggle("enabled", Boolean(locationEnabled));
  }

  function showStep(step) {
    currentStep = Math.max(1, Math.min(3, step));

    form.querySelectorAll(".onboarding-step-page").forEach((page) => {
      page.classList.toggle("active", Number(page.dataset.setupStep) === currentStep);
    });

    progress.querySelectorAll(".setup-progress-item").forEach((item) => {
      const itemStep = Number(item.dataset.progressStep);
      item.classList.toggle("active", itemStep === currentStep);
      item.classList.toggle("complete", itemStep < currentStep);
    });

    if (headerEyebrow) headerEyebrow.textContent = `Step ${currentStep} of 3`;
    if (headerTitle) headerTitle.textContent = STEP_TITLES[currentStep - 1];
    if (currentStep === 3) updateReview();

    content.scrollTo({ top: 0, behavior: "smooth" });
  }

  function validateStepOne() {
    const fullName = document.querySelector("#full-name");
    const phone = document.querySelector("#phone-number");
    const city = document.querySelector("#city");

    phone.setCustomValidity(/^\d{10}$/.test(phone.value.trim()) ? "" : "Enter a valid 10-digit mobile number.");

    for (const field of [fullName, phone, city]) {
      if (!field.checkValidity()) {
        field.reportValidity();
        field.focus();
        return false;
      }
    }
    return true;
  }

  function validateStepTwo() {
    const selectedVehicle = document.querySelector('input[name="vehicleType"]:checked')?.value;
    const vehicleNumber = document.querySelector("#vehicle-number");
    const locationCard = document.querySelector("#location-btn");

    if (selectedVehicle !== "Cycle" && !vehicleNumber.value.trim()) {
      vehicleNumber.setCustomValidity("Enter your vehicle number.");
      vehicleNumber.reportValidity();
      vehicleNumber.focus();
      return false;
    }
    vehicleNumber.setCustomValidity("");

    if (!locationCard.classList.contains("granted")) {
      locationError.classList.remove("hidden");
      locationCard.classList.add("needs-attention");
      locationCard.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }

    locationError.classList.add("hidden");
    locationCard.classList.remove("needs-attention");
    return true;
  }

  document.querySelector("#setup-next-1").addEventListener("click", () => {
    if (validateStepOne()) showStep(2);
  });

  document.querySelector("#setup-back-2").addEventListener("click", () => showStep(1));
  document.querySelector("#setup-next-2").addEventListener("click", () => {
    if (validateStepTwo()) showStep(3);
  });
  backThree.addEventListener("click", () => showStep(2));

  document.querySelector("#location-btn").addEventListener("click", () => {
    locationError.classList.add("hidden");
    document.querySelector("#location-btn").classList.remove("needs-attention");
  });

  form.addEventListener("submit", () => {
    if (currentStep !== 3) showStep(3);
  });

  const observer = new MutationObserver(() => {
    if (screen.classList.contains("active")) showStep(1);
  });
  observer.observe(screen, { attributes: true, attributeFilter: ["class"] });

  showStep(1);
}

setupOnboardingSteps();
