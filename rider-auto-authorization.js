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

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'riders', user.uid), {
        uid: user.uid,
        isApproved: true,
        accountStatus: 'active',
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.warn('Rider auto-authorization will retry after rules deployment:', error);
    }
  });
}
