# MyQK Rider

Mobile-first delivery partner web app for MyQK.

## Included flow

- Firebase Google authentication
- Partner onboarding form
- Terms acceptance
- Live location permission
- Online/offline availability toggle
- Simulated nearby delivery requests
- Pickup and delivery status flow
- Order history
- Earnings dashboard
- Partner profile
- Firestore profile storage with local fallback

## Firebase setup

1. Create or open a Firebase project.
2. Add a **Web App** in Firebase Project Settings.
3. Copy the Firebase config values into `firebase-config.js`.
4. In **Authentication → Sign-in method**, enable **Google**.
5. In **Authentication → Settings → Authorized domains**, add your deployed domain.
6. Create a Firestore database.

The rider profile is saved at:

```text
riders/{firebaseAuthUid}
```

Suggested development Firestore rules:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /riders/{riderId} {
      allow read, create, update: if request.auth != null
        && request.auth.uid == riderId;
    }
  }
}
```

Use stricter validation rules before production.

## Run locally

Because the app uses JavaScript modules, serve it through a local server rather than opening `index.html` directly.

```bash
python -m http.server 5500
```

Then visit `http://localhost:5500`.

## Production work still needed

- Real order backend and dispatch logic
- Continuous background location updates
- Identity, licence and bank verification
- OTP-based pickup/delivery proof
- Payment settlement integration
- Push notifications
- Secure server-side authorization
