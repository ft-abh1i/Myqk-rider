const $ = (selector) => document.querySelector(selector);

function showToast(message, error = false) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = 'toast'; }, 3200);
}

function updateNetworkState() {
  const onlineToggle = $('#online-toggle');
  const isOffline = !navigator.onLine;
  if (onlineToggle) onlineToggle.disabled = isOffline;
  if (isOffline) {
    showToast('Internet connection unavailable. Reconnect to receive orders.', true);
  }
}

function validateRuntime() {
  if (!window.isSecureContext) {
    showToast('Secure HTTPS connection is required for login and live location.', true);
  }
  if (!navigator.geolocation) {
    $('#location-btn')?.setAttribute('disabled', 'disabled');
    showToast('Live location is not supported on this device.', true);
  }
}

function addSearchTimeoutMessage() {
  const searching = $('#searching-state');
  const toggle = $('#online-toggle');
  if (!searching || !toggle) return;

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    if (!toggle.checked) return;
    timer = setTimeout(() => {
      if (toggle.checked && !searching.classList.contains('hidden')) {
        const copy = searching.querySelector('p');
        if (copy) copy.textContent = 'No nearby pending orders yet. Keep GPS and internet on.';
      }
    }, 15000);
  };
  toggle.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule();
  });
}

window.addEventListener('online', () => {
  updateNetworkState();
  showToast('Internet connection restored.');
});
window.addEventListener('offline', updateNetworkState);
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rider app error:', event.reason);
  showToast('Something went wrong. Please retry.', true);
});

document.addEventListener('DOMContentLoaded', () => {
  validateRuntime();
  updateNetworkState();
  addSearchTimeoutMessage();
});
