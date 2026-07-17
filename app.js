import "./onboarding-v2.js";
import { suppressDemoOrderHandlers } from "./firebase-order-handler-guard.js";

const restoreOrderHandlers = suppressDemoOrderHandlers();
await import("./app-core.js");
restoreOrderHandlers();

await import("./firestore-orders.js");
import "./location-address.js";
import "./rider-live-location.js";
import "./launch-hardening.js";
