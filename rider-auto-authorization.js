import { firebaseConfig } from './firebase-config.js';
import { getApps, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, getFirestore, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const configured = Boolean(
  firebaseConfig?.apiKey
  && firebaseConfig?.projectId
  && !String(firebaseConfig.apiKey).startsWith('YOUR_')
  && firebaseConfig.projectId !== 'YOUR_PROJECT_ID'
);

if (configured) {
  const app = getApps()[0] || initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let currentUser = null;

  const authorizeRider = async () => {
    if (!currentUser) return;
    try {
      await setDoc(doc(db, 'riders', currentUser.uid), {
        uid: currentUser.uid,
        isApproved: true,
        accountStatus: 'active',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.warn('Rider auto-authorization will retry after onboarding:', error);
    }
  };

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) authorizeRider();
  });

  const retryAfterOnboarding = () => {
    window.setTimeout(authorizeRider, 250);
    window.setTimeout(authorizeRider, 1200);
  };

  const partnerForm = document.getElementById('partner-form');
  partnerForm?.addEventListener('submit', retryAfterOnboarding);

  const mainScreen = document.getElementById('main-screen');
  if (mainScreen) {
    new MutationObserver(() => {
      if (mainScreen.classList.contains('active')) retryAfterOnboarding();
    }).observe(mainScreen, { attributes: true, attributeFilter: ['class'] });
  }
}
