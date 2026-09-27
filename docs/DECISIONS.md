# Decisions — Interview Cheat Sheet

Short answers to "what did you do and why", in plain words.

**Quick index: which section answers which question**

| If the interviewer asks... | Read |
|---|---|
| Walk me through a request | Request flow walkthrough |
| Why is available quantity not stored? | Schema design; Available quantity: one function |
| Why CHECK and UNIQUE when the code validates? | Why CHECK + UNIQUE constraints |
| How does login and role checking work? | How JWT + RBAC works |
| Why does the backend recalculate totals? | How quotation totals are calculated |
| How do you stop duplicate sales orders? | How duplicate sales orders are prevented |
| **Two people reserve the last stock at once?** | How concurrent reservations are prevented; The status guard |
| Why transactions? | Why transactions in convert; Why transactions in confirm / dispatch / cancel |
| What did you leave out? | Simplifications and how to extend them |
| **Add DAMAGED stock (live change)** | Live change round: add DAMAGED stock |
| **Cancel a confirmed order and release stock (live change)** | Live change round: cancel a confirmed order |
| How did you test it? | How the tests work |

## Schema design and why available quantity is computed, not stored
- 11 tables in `snake_case`. Money is `Decimal(12,2)`, percentages `Decimal(5,2)` — never floats.
- `inventory` has one row per product (`product_id` UNIQUE) holding only `physical_qty` and `reserved_qty`.
- `available = physical_qty - reserved_qty` is calculated on read. If it were stored it could drift out of sync with the other two columns.
- Dispatch has no `dispatch_items` table: full dispatch only, so what was dispatched = the order's items. Extension: add `dispatch_items` for partial dispatch.

## Why CHECK + UNIQUE constraints in addition to code checks
- Application code enforces the business rules and gives friendly errors. The database guarantees them even if the code has a bug or two requests race.
- CHECK: stock never negative, `reserved_qty <= physical_qty`, quantities > 0, discount/GST between 0 and 100. Prisma cannot declare CHECKs, so they are appended by hand to the migration SQL.
- UNIQUE: `sales_orders.quotation_id` (one order per quotation) and `dispatches.sales_order_id` (one dispatch per order).

## Stack choices made in Phase 1
- CommonJS (`require`) everywhere — closest to plain "no magic" Node, and Jest works without config.
- Express 5, so async route errors reach the error handler without an `asyncHandler` wrapper.
- Prisma 6, not 7: 6 keeps the connection URL in `schema.prisma` and the classic `@prisma/client` import. 7 needs a config file and driver adapters — more to explain for no benefit here.
- Seed is run with `npm run seed` (plain `node prisma/seed.js`) and is safe to re-run (`upsert`, and existing stock is never overwritten).

## How JWT + RBAC works (Spring Security comparison)
- `POST /api/auth/login` checks the bcrypt hash and returns a JWT signed with `JWT_SECRET`, payload `{ id, role }`, expiry 8h. Users are seeded, so there is no register endpoint.
- Every protected route runs `auth` (verifies the token, sets `req.user`, else 401) and then `requireRole('ADMIN')` where needed (else 403). Spring: `auth` = the JWT filter in the filter chain, `requireRole` = `@PreAuthorize("hasRole('ADMIN')")`.
- The role lives in the token, so no DB call per request. Trade-off: a role change only takes effect when the token expires (8h). Hiding buttons in the React UI is just UX; the backend is the real guard.
- Wrong password and unknown email return the same 401 message, so nobody can find out which emails exist.

## One error handler for everything
- Services throw `new AppError(status, message)`; one `errorHandler` middleware (Spring: `@ControllerAdvice`) turns it into `{ "error": message }`.
- It also maps zod validation errors -> 400, Prisma `P2002` (UNIQUE violation) -> 409, `P2025` (row not found) -> 404, bad JSON -> 400, anything else -> 500 with a generic message (the real error is only logged).
- Express 5 forwards errors thrown in async handlers automatically, so route files have no try/catch.

## One naming convention: snake_case from database to JSON
- Prisma field names are snake_case (`physical_qty`, `unit_price`) — the same string in PostgreSQL, Prisma code, raw SQL, JSON request/response and React. There is no mapping layer, and raw `FOR UPDATE` query results have the same keys as Prisma results, so one `getAvailable` works for both.
- Only model names differ from table names (`model Customer` -> `customers` via `@@map`).
- Money comes back in JSON as strings (`"24500"`), because `Decimal` is exact and JSON numbers are floats. The frontend formats them for display.

## Available quantity: one function, one place
- `getAvailable(inventory)` in `product.service.js` returns `physical_qty - reserved_qty`. Listings and stock checks all call it; nothing else computes it.
- The "add DAMAGED stock" live change only has to touch this one function; the exact rehearsed steps are in "Live change round" at the end.

## Row locking helper
- `lockInventoryRows(tx, productIds)` runs `SELECT ... WHERE product_id = ANY(...) ORDER BY product_id FOR UPDATE` inside a transaction. The rows stay locked until the transaction commits or rolls back, so a second request touching the same rows waits instead of reading stale numbers.
- Rows are always locked in `product_id` order. If two transactions lock the same rows in different orders they can wait on each other forever (deadlock); one fixed order makes that impossible.
- Used by the stock update now, and reused by confirm / dispatch / cancel.

## How quotation totals are calculated and why the backend recalculates
- `utils/calculations.js` (pure functions, no DB): base = qty x price; discount = base x disc% / 100; taxable = base - discount; gst = taxable x gst% / 100; line = taxable + gst rounded to 2 places; grand total = sum of lines.
- Money maths uses `Decimal` (the same type Prisma uses for DECIMAL columns), not JS floats: a float gives 0.1 + 0.2 = 0.30000000000000004. Rounding is half-up, only at the end of each line.
- The client is never trusted for totals. `line_amount` and `grand_total` are not in the zod schema, so anything sent is dropped; the browser preview is UX only. `unit_price` defaults to the product's `base_price`.
- Money/percent inputs accept at most 2 decimals (`multipleOf(0.01)`), so the number we calculate with is exactly the number the DB column stores.

## How duplicate sales orders are prevented
- `sales_orders.quotation_id` is UNIQUE. The service also checks first, only to give a friendly 409 message; the constraint is the real guarantee.
- Two requests at the same instant both pass the check, both try to INSERT; PostgreSQL lets one in and fails the other with unique violation `P2002`, which the service turns into 409. Tested: 8 simultaneous converts -> exactly 1 order, every time.

## Why transactions in convert (and create)
- Creating an enquiry/quotation/order means several writes (row, items, document number, sometimes another table's status). One `prisma.$transaction` makes them all succeed or all roll back, so there is never a quotation without items or an order with a placeholder number.
- Document numbers (`ENQ-0001`): insert with a throwaway `TEMP-<uuid>` number, then update to `formatNo(prefix, id)` in the same transaction. Columns stay NOT NULL + UNIQUE, and no other request can ever see the TEMP value.

## Status rules and simplifications made in Phase 4
- Quotation: DRAFT -> SENT -> ACCEPTED/REJECTED only (one `ALLOWED_TRANSITIONS` object). ACCEPTED sets the enquiry WON, REJECTED sets it LOST, both in one transaction.
- A product may appear once per enquiry/quotation, so an order has one line per product and the stock check in Phase 5 can compare each line against available stock without summing duplicates.
- A WON or LOST enquiry cannot get a new quotation (otherwise creating one would silently set it back to QUOTED). Simplification: a REJECTED quotation makes the enquiry LOST for good, so there is no "revise after rejection". Extension: allow LOST -> QUOTED again.
- Not handled (deliberate): expired `valid_until`, and two SENT quotations on one enquiry both being accepted. Extension: reject accepting when the enquiry is already WON.

## How concurrent reservations are prevented (the key question)
- Confirm runs in one `prisma.$transaction`. First it locks the inventory rows of every product in the order with `SELECT ... FOR UPDATE ORDER BY product_id` (`lockInventoryRows`). Only then does it read available = physical - reserved, check every line, and increment `reserved_qty`.
- Example: 100 in stock, request A wants 80, request B wants 50, both arrive together. A gets the lock; B waits at the `SELECT ... FOR UPDATE`. A reserves 80 and commits. B's lock is released, it now reads available = 20, and fails with 400 "Insufficient stock". B's order stays PENDING. Reserved ends at 80, never 130.
- Without the lock, both would read 100 available, both pass the check, and 130 would be reserved. The CHECK `reserved_qty <= physical_qty` is a second safety net: PostgreSQL would reject the write, but the user would get an ugly 500 instead of a clear message.
- Rows are always locked in `product_id` order, so two orders that list the same products in opposite order can't deadlock. (Spring: `@Transactional` + `@Lock(PESSIMISTIC_WRITE)`.)
- Throwing inside the transaction rolls back everything, including the status change and any reservation made for earlier lines of the same order.

## The status guard: "double click" on confirm / dispatch / cancel
- Checking "is it PENDING?" and then reserving is not enough: two requests can both read PENDING before either takes the stock lock, and both would reserve. So the status change is a guarded UPDATE: `UPDATE ... SET status = new WHERE id = ? AND status = <what I read>` (`changeOrderStatus`).
- The UPDATE locks the order row. The second request waits, then matches 0 rows and fails with 409. Same idea as the UNIQUE guard on convert: friendly check first, database guarantee underneath.
- Lock order is always: order row first, then inventory rows sorted by product. Every action follows it, so actions cannot deadlock each other.

## Why transactions in confirm / dispatch / cancel
- Each action changes several rows that must stay consistent: the order status, one or more inventory rows and (dispatch) a new dispatch record. One transaction makes them all happen or none, so stock can never be reserved for an order that is still PENDING, or leave the warehouse without a dispatch record.

## Dispatch and cancel rules
- Dispatch is full dispatch only: physical AND reserved both go down by the order quantity, and dispatch never exceeds what is reserved. `dispatches.sales_order_id` is UNIQUE, so a second dispatch record is impossible even if the status check were bypassed. Normally a second dispatch is stopped earlier by the status check (400).
- Cancel: PENDING -> CANCELLED with no stock change; CONFIRMED -> CANCELLED releases exactly the order's reserved quantity (this is the "cancel confirmed order and release stock" live-change item, already done); DISPATCHED or CANCELLED -> 400.
- Simplification: `sales_order_items` and dispatch have no partial quantities. Extension: add a `dispatch_items` table and let dispatch take `[{ product_id, quantity }]` up to the remaining reserved amount.

## How the tests work and why they use a real database
- Tests call the real Express `app` through Supertest and a real PostgreSQL database (`mini_erp_test`, from `.env.test`). Nothing is mocked, so the tests prove the things the case study is graded on: real CHECK/UNIQUE constraints, real transactions and real `FOR UPDATE` locking. A mocked database can't show any of that. (Spring: `@SpringBootTest` + MockMvc + Testcontainers, instead of Mockito on the repository.)
- Before every test `resetDatabase()` runs `TRUNCATE ... RESTART IDENTITY CASCADE` and inserts a tiny known data set (2 users, 1 customer, WIDGET 100 in stock, GADGET 10). Each test starts from the same state, ids are always the same, and tests never depend on each other. TRUNCATE is used instead of `prisma migrate reset` because it is faster and keeps the schema.
- Safety: `setup.js` refuses to run unless the database name ends in `_test`, and `.env.test` overrides any `DATABASE_URL` set in the terminal, so the tests can never empty the real database.
- Tests run with `--runInBand` (one after another) because they share one database. Concurrency is created on purpose inside a test with `Promise.all`.
- The concurrency tests are repeated (5 rounds of the 80 vs 50 race) because a race can pass by luck once. With the `FOR UPDATE` line removed, round 1 passed by luck and rounds 2-5 failed, which is why one round would not be enough.
- I checked that the tests can fail: breaking the code on purpose in 7 places (lock, status guard, dispatch maths, GST maths, role check, stock check, convert rule) made tests fail every time.

## Frontend: plain React, no state library
- Each page keeps its own data in `useState` and loads it in `useEffect`. No Redux, no data-fetching library. After every action the page simply reloads its lists from the backend, so the screen always shows what is really in the database.
- One small `run(action)` function per page: it clears old messages, runs the action, and puts the backend's `{ "error": ... }` text into a red banner. That is how the business rules ("Insufficient stock for HP-200: required 10, available 8", "Only ACCEPTED quotations can be converted") become visible in the demo without any frontend rule code.
- One axios instance (`api.js`) with a request interceptor that adds `Authorization: Bearer <token>` and a response interceptor that logs out on 401 (except on the login form, where a 401 just means "wrong password"). Spring: a RestTemplate/WebClient interceptor.

## Frontend: auth, roles and their limits
- `AuthContext` holds the logged-in user, backed by `localStorage` so a refresh keeps you logged in. `ProtectedLayout` redirects to `/login` when nobody is logged in.
- Hiding admin buttons and pages is UX only. The real rules are in the backend: a SALES user who calls confirm/dispatch/cancel/inventory directly still gets 403 (covered by the Jest tests).
- Trade-off to mention: a JWT in `localStorage` can be read by injected JavaScript (XSS). An httpOnly cookie avoids that but needs CSRF protection and cookie/CORS setup; for this case study the simpler Bearer header was chosen. Extension: httpOnly cookie + CSRF token.

## Frontend: quotation preview vs backend total
- The screen calculates a live total with the same formula so the user sees a number while typing. It is a preview only: it uses ordinary JS numbers, and on save the backend recalculates with exact `Decimal` and returns the real total, which the banner shows. The client can send whatever it wants; the backend ignores any totals it sends.
- Money arrives as strings (`"485570"`) and is shown with `Number(value).toFixed(2)` in `format.js`.

## Request flow walkthrough
Example: ADMIN clicks **Confirm** on order 5.
1. **React** (`SalesOrders.jsx`) calls `api.post('/sales-orders/5/confirm')`. The axios interceptor adds `Authorization: Bearer <token>`.
2. **CORS + JSON parsing** in `app.js`: only the frontend origin is allowed.
3. **`auth` middleware** verifies the JWT signature and expiry and sets `req.user = { id, role }`. Missing or bad token: 401.
4. **`requireRole('ADMIN')`**: a SALES token is refused with 403 before anything else runs.
5. **zod** validates the input (`:id` is a positive integer). Bad input: 400 listing the fields.
6. **Route -> service**: `salesOrder.routes.js` only calls `confirmSalesOrder(id)`. All business rules live in the service.
7. **`prisma.$transaction`**: load the order, check it is PENDING, guarded status UPDATE, lock the stock rows with `FOR UPDATE`, check availability, increment `reserved_qty`.
8. **PostgreSQL** enforces UNIQUE / CHECK / FOREIGN KEY as the last line of defence.
9. **Response**: the service returns the updated order (or throws `AppError`); `errorHandler` turns any error into `{ "error": "..." }` with the right status.

Spring equivalent: filter chain (`auth`) -> `@PreAuthorize` (`requireRole`) -> `@Valid` (zod) -> `@RestController` (route) -> `@Service` + `@Transactional` (service) -> JPA (Prisma) -> `@ControllerAdvice` (`errorHandler`).

## Simplifications and how to extend them
| Simplification | Why | How to extend |
|---|---|---|
| Full dispatch only, no `dispatch_items` table | Keeps dispatch one transaction with one record | Add `dispatch_items(dispatch_id, product_id, quantity)`; dispatch takes lines up to the remaining reserved quantity; drop the UNIQUE on `sales_order_id`, add a "fully dispatched" status |
| Users seeded, no registration, one role per user | The case study is about the sales flow, not user management | Add `POST /users` (ADMIN); hash passwords with bcrypt as the seed does |
| REJECTED quotation makes the enquiry LOST for good | Keeps the status side effects one-directional | Allow LOST -> QUOTED when a new quotation is created |
| `valid_until` stored but not enforced | Not in the rules | Reject ACCEPTED when `valid_until` is in the past |
| Two SENT quotations on one enquiry could both be accepted | Not in the rules | When accepting, refuse if the enquiry is already WON |
| One product once per enquiry/quotation | Keeps the per-line stock check correct | Sum quantities per product in the stock check instead |
| JWT in `localStorage` | Simplest for a SPA | httpOnly cookie plus a CSRF token |
| Whole-number quantities | Matches the `Int` columns | Change to `Decimal` for Kg / Metres |
| Money accepted with at most 2 decimals | The DB column stores 2 | Widen the columns and the zod `multipleOf` |
| No frontend tests | Not required | Add Vitest + Testing Library or Playwright |

## Live change round: add DAMAGED stock
Rehearsed end to end on a copy of the project: **68/68 tests pass**, about 21 changed source lines (added + removed) in 4 files, plus one migration. Damaged stock is physically in the warehouse but not sellable: `available = physical - reserved - damaged`.

1. **`schema.prisma`**: in `model Inventory` add `damaged_qty Int @default(0)`.
2. **Migration**: `npx prisma migrate dev --name add_damaged_qty --create-only` (creates the SQL without applying it). Open the new `migration.sql` and append the CHECK changes (Prisma cannot declare them):
   ```sql
   ALTER TABLE inventory DROP CONSTRAINT chk_reserved_le_physical;
   ALTER TABLE inventory ADD CONSTRAINT chk_damaged_non_negative CHECK (damaged_qty >= 0);
   ALTER TABLE inventory ADD CONSTRAINT chk_reserved_damaged_le_physical CHECK (reserved_qty + damaged_qty <= physical_qty);
   ```
   Then `npx prisma migrate dev` to apply it and regenerate the client.
3. **The one formula** in `product.service.js`: `return inventory.physical_qty - inventory.reserved_qty - inventory.damaged_qty;`. Listing, order item availability, confirm and the error message all use it, so nothing else changes. This also works for the row locked with `FOR UPDATE`, because `lockInventoryRows` uses `SELECT *` (with an explicit column list, `damaged_qty` would be `undefined`, the stock check would compare against `NaN`, and stock would be over-reserved without any error).
4. **Let ADMIN set it**: in `product.routes.js` add `damaged_qty: z.number().int().min(0).optional()` to `updateStockSchema` and pass it on. In `updatePhysicalStock` use `const damagedQty = damagedInput ?? inventory.damaged_qty;` (if the client leaves it out, keep the stored value, otherwise a PATCH with only `physical_qty` would silently reset it to 0), check `physicalQty < inventory.reserved_qty + damagedQty`, and save `damaged_qty` together with `physical_qty`.
5. **Frontend**: in the inventory table of `SalesOrders.jsx` add `<th>Damaged</th>` and `<td>{product.inventory.damaged_qty}</td>`. The Available column already shows the backend's `available_qty`, so the formula is not repeated in React.
6. **Two existing tests will fail, on purpose**: the `getAvailable` unit test in `inventory.test.js` (its object has no `damaged_qty`, so the result is `NaN`; add `damaged_qty`) and the CHECK-constraint test (the constraint is now called `chk_reserved_damaged_le_physical`). Update both, then add a test that damaged stock cannot be reserved.

Explain it as: *the formula lives in one function, and the database CHECK is replaced so it still protects the same rule.*

## Live change round: cancel a confirmed order
Already implemented (`cancelSalesOrder` in `salesOrder.service.js`), tested, and available in the UI and the Postman collection. Be ready to explain it:
- PENDING -> CANCELLED with no stock change (nothing was reserved).
- CONFIRMED -> CANCELLED: one transaction guarded-updates the status, locks the order's inventory rows in `product_id` order, and lowers `reserved_qty` by each item's quantity. Physical stock is untouched (the goods never left).
- DISPATCHED and CANCELLED cannot be cancelled: goods that already left cannot be un-reserved, and a second cancel must never release stock twice (tested with 3 simultaneous cancels).
