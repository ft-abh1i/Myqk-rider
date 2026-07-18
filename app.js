import "./onboarding-v2.js";
import { suppressDemoOrderHandlers } from "./firebase-order-handler-guard.js";

const restoreOrderHandlers = suppressDemoOrderHandlers();
await import("./app-core.js");
restoreOrderHandlers();

await import("./firestore-orders.js?v=20260718-location-radius-policy");
await import("./location-address.js");
await import("./rider-location-display.js?v=20260718-real-address");
await import("./rider-live-location.js?v=20260718-one-minute-policy");
await import("./launch-hardening.js");
