# MyQK Rider — Firebase MVP setup

This MVP uses Firebase Authentication + Cloud Firestore only. Cloud Functions are not required.

## 1. Firebase console

Use the existing Firebase project `buyqk-rider`.

1. Authentication → Sign-in method → enable **Google**.
2. Authentication → Settings → Authorized domains → add the Vercel production domain.
3. Firestore Database → create database in production mode.
4. Firestore Database → Rules → paste the complete contents of `firestore.rules` and publish.

## 2. Required collections

### `riders/{firebaseAuthUid}`

Created automatically after rider onboarding.

Important fields:

```js
{
  uid: "firebase-auth-uid",
  fullName: "Rider name",
  onboardingComplete: true,
  status: "offline",
  isOnline: false,
  location: {
    latitude: 25.61,
    longitude: 85.14
  }
}
```

### `orders/{orderId}`

The customer app must create orders in this format:

```js
{
  orderNumber: "QK1001",
  customerId: "firebase-customer-auth-uid",
  customerName: "Customer name",
  customerPhone: "+919999999999",
  status: "pending",
  assignedRiderId: null,
  pickup: {
    name: "Fresh Basket",
    address: "Bailey Road, Patna",
    location: {
      latitude: 25.615,
      longitude: 85.11
    }
  },
  drop: {
    name: "Customer",
    address: "Boring Road, Patna",
    location: {
      latitude: 25.62,
      longitude: 85.12
    }
  },
  itemCount: 3,
  paymentMode: "Prepaid",
  riderPayout: 42,
  distanceKm: 4.8,
  durationText: "22 min",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
}
```

## 3. Customer-app order creation

Use the signed-in customer's UID. Do not create anonymous public orders.

```js
import {
  addDoc,
  collection,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

await addDoc(collection(db, "orders"), {
  orderNumber: `QK${Date.now().toString().slice(-6)}`,
  customerId: auth.currentUser.uid,
  customerName,
  customerPhone,
  status: "pending",
  assignedRiderId: null,
  pickup,
  drop,
  itemCount: cartItems.length,
  paymentMode: "Prepaid",
  riderPayout: 42,
  distanceKm: 4.8,
  durationText: "22 min",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});
```

## 4. Test flow

1. Sign in to the rider app and finish onboarding with location permission.
2. Publish the Firestore rules.
3. Create one `pending` order while signed in as a different customer account.
4. Set the rider online.
5. The nearest pending order within 8 km appears automatically.
6. Accept it from two rider devices at the same time; only the first transaction succeeds.
7. Move through arrived → picked up → completed.

## MVP limitations

- Rider app must remain open for realtime requests.
- No background push notification yet.
- No automatic server-side dispatch.
- Distance filtering is calculated in the rider browser.
- Before production, add admin verification, App Check, payment reconciliation, audit logs, and a trusted backend.
