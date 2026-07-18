import "./onboarding-v2.js";
import { suppressDemoOrderHandlers } from "./firebase-order-handler-guard.js";

const restoreOrderHandlers = suppressDemoOrderHandlers();
await import("./app-core.js");
restoreOrderHandlers();

await import("./firestore-orders.js?v=20260718-ready-orders-fix");
import "./location-address.js";
import "./rider-location-display.js?v=20260718-real-address";
import "./rider-live-location.js?v=20260718-real-address";
import "./launch-hardening.js";
