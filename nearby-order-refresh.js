// Firestore's order listener in firestore-orders.js is already realtime.
//
// This module previously listened to rider location updates and dispatched a
// synthetic `change` event on #online-toggle. Every location write therefore
// re-ran the online handler, re-subscribed to orders, and repeatedly displayed
// the "You are now online" notification. In some sessions the continuous
// unsubscribe/re-subscribe cycle also prevented a pending order card from
// staying visible.
//
// Keep this file as a safe no-op because app.js may still be cached with the
// import. Nearby pending orders continue to update automatically through the
// Firestore onSnapshot listener in firestore-orders.js.
export {};
