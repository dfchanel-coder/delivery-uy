# DeliveryUY Business Rules

## Cart

Initial implementation:

One active cart can contain products from one merchant only.

---

# Order

Order totals are frozen when order is created.

Product price changes must not affect existing orders.

---

# Merchant

Only ACTIVE merchants can receive orders.

Merchant must not edit finalized historical order prices.

---

# Driver

Only APPROVED drivers may deliver.

Only ONLINE drivers may receive new offers.

A BUSY driver normally does not receive another offer unless multi-order
delivery is implemented.

---

# Delivery

A delivery cannot be completed without:

valid delivery code

or

authorized manual exception.

---

# Delivery Code

Customer knows the code.

Driver does not.

Driver enters customer-provided code.

Backend validates it.

---

# Cancellation

Cancellation behavior depends on order status.

A paid order cancellation may require refund workflow.

Do not implement one universal cancellation path.

---

# Commission

Commission is calculated at order time.

The resulting values are stored.

Changing commission later must not change historical orders.

---

# Address

Order contains address snapshot.

Editing customer's saved address does not update active/historical orders.

---

# Money

Financial calculations must use deterministic decimal arithmetic.