const REAL_ORDER_CONTROLS = new Map([
  ['online-toggle', 'change'],
  ['accept-order-btn', 'click'],
  ['reject-order-btn', 'click'],
  ['advance-order-btn', 'click'],
  ['open-navigation-btn', 'click'],
  ['call-action-btn', 'click']
]);

/**
 * app-core.js still owns general UI/auth behavior, but it also contains the old
 * sample-order engine. In Firebase mode those sample handlers must not be
 * registered because firestore-orders.js is the single source of truth.
 */
export function suppressDemoOrderHandlers() {
  const original = EventTarget.prototype.addEventListener;

  EventTarget.prototype.addEventListener = function guardedAddEventListener(type, listener, options) {
    const expectedType = this instanceof Element ? REAL_ORDER_CONTROLS.get(this.id) : null;
    if (expectedType && expectedType === type) return;
    return original.call(this, type, listener, options);
  };

  return () => {
    EventTarget.prototype.addEventListener = original;
  };
}
