# MyQK Rider — Firebase setup

The customer, merchant, and rider apps share the Firebase project
`buyqk-rider`.

## Firebase configuration

1. Enable Google sign-in for merchant and rider, and Anonymous sign-in for the
   customer app.
2. Add every deployed domain under Authentication → Authorized domains.
3. Deploy the unified rules and composite indexes:

   ```bash
   firebase deploy --only firestore
   ```

The checked-in `firestore.rules` and `firestore.indexes.json` are the same in
all three repositories. Deploy them from one repository only.

## Order lifecycle

Customer orders begin at `pending_merchant`. The merchant moves a valid,
stock-reserved order through:

```text
pending_merchant → merchant_accepted → preparing → ready_for_pickup
```

An online rider within 20 km can then accept it and move through:

```text
ready_for_pickup → accepted → arrived_pickup → picked_up → completed
```

Rider acceptance updates both `orders/{orderId}` and
`riders/{riderUid}.activeOrderId` in one transaction. The rules reject a second
active order until the current delivery is completed.

## Test flow

1. Create and approve a merchant store, then add a product with stock.
2. Place an order from the customer app.
3. Accept it in the merchant app; the product stock is reserved atomically.
4. Mark it ready for pickup.
5. Complete rider onboarding, enable current location, and go online.
6. Accept and complete the delivery.
7. Confirm that the real order appears in Rider Orders and its payout appears
   in Rider Earnings.

## Production follow-ups

- Add Firebase App Check.
- Move dispatch notifications and payment reconciliation to a trusted backend.
- Add admin identity, licence, bank, and background verification for riders.
- Add audit logging and payout settlement records.
