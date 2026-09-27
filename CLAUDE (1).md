# CLAUDE.md — Mini ERP (PERN Stack Case Study)

## 0. Read This First (Most Important Rules)

This is an interview case study. The developer (Rahul) must **explain and modify every line live** in front of interviewers. Rahul knows Spring Boot, Spring Security, JWT and MySQL well, but is **new to Node.js, Express and Prisma**.

Therefore:

1. **Simplicity over cleverness.** Always choose the simplest correct solution. No design patterns, no abstractions, no generic helpers unless they remove real duplication.
2. **Backend correctness over UI.** The grade depends on business logic, PostgreSQL design, transactions and RBAC. The UI must be plain and functional.
3. **Explain as you build.** After each phase, give the Phase Report (Section 10) explaining what was built and why, with a Spring Boot comparison where useful.
4. **Comment the "why", not the "what".** Every business rule in code gets a one-line comment naming the rule (e.g. `// Rule: only ACCEPTED quotations can be converted`).
5. **Work in phases, stop after each one.** Build one phase at a time (Section 10). At the end of every phase: write the Phase Report, update `docs/PROGRESS.md`, then **stop and ask** before starting the next phase. Never start the next phase without Rahul's explicit go-ahead.
6. **No magic.** Avoid decorators, metaprogramming, dependency injection libraries, class hierarchies, or TypeScript generics. Use plain JavaScript (CommonJS or ESM, pick one and stay consistent).
7. **Keep `docs/DECISIONS.md` updated** (see Section 11) — this is Rahul's interview cheat sheet.

---

## 1. Business Workflow

```
Customer → Enquiry → Quotation → Sales Order → Inventory Reservation → Dispatch
```

| Stage | Who | Statuses |
|---|---|---|
| Enquiry | SALES | NEW → QUOTED → WON / LOST |
| Quotation | SALES | DRAFT → SENT → ACCEPTED / REJECTED |
| Sales Order | SALES creates, ADMIN confirms | PENDING → CONFIRMED → DISPATCHED (or CANCELLED) |
| Dispatch | ADMIN | (record created once per order) |

Status side effects (keep these consistent):
- Creating a quotation for an enquiry → enquiry becomes `QUOTED`.
- Quotation `ACCEPTED` → enquiry becomes `WON`. Quotation `REJECTED` → enquiry becomes `LOST`.
- Converting a quotation → creates a Sales Order with status `PENDING`.
- Admin confirm → stock reserved, order becomes `CONFIRMED`.
- Admin dispatch → stock leaves warehouse, order becomes `DISPATCHED`.

---

## 2. Tech Stack (Do Not Change)

| Layer | Choice | Spring Boot equivalent |
|---|---|---|
| Runtime | Node.js 20+ | JVM |
| Web framework | Express | Spring MVC |
| Database | PostgreSQL | MySQL |
| ORM | Prisma | JPA / Hibernate |
| Auth | jsonwebtoken + bcrypt | Spring Security + JWT |
| Validation | zod | `@Valid` + Bean Validation |
| Tests | Jest + Supertest | JUnit + MockMvc |
| Frontend | React + Vite + react-router-dom + axios | — |
| Styling | One plain CSS file | — |
| Config | dotenv (`.env`) | application.properties |

Do NOT add: Redux, TypeScript, Tailwind, UI component libraries, Docker (optional only at the end), GraphQL, microservices, repository classes, DTO classes.

---

## 3. Folder Structure

```
mini-erp/
├── CLAUDE.md
├── README.md
├── docs/
│   ├── DECISIONS.md          # interview cheat sheet (why each choice)
│   ├── PROGRESS.md           # phase-by-phase log of what was built
│   ├── ER-diagram.md         # Mermaid ER diagram
│   └── postman_collection.json
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.js
│   ├── src/
│   │   ├── app.js            # express app (exported for tests)
│   │   ├── server.js         # app.listen only
│   │   ├── db.js             # single PrismaClient instance
│   │   ├── middleware/
│   │   │   ├── auth.js       # verifies JWT → req.user
│   │   │   ├── requireRole.js
│   │   │   └── errorHandler.js
│   │   ├── utils/
│   │   │   ├── AppError.js   # error with HTTP status
│   │   │   └── calculations.js  # pure quotation math (unit tested)
│   │   ├── routes/           # one file per module: URL + validation + call service
│   │   │   ├── auth.routes.js
│   │   │   ├── customer.routes.js
│   │   │   ├── product.routes.js
│   │   │   ├── enquiry.routes.js
│   │   │   ├── quotation.routes.js
│   │   │   └── salesOrder.routes.js
│   │   └── services/         # ALL business logic + DB access lives here
│   │       ├── auth.service.js
│   │       ├── customer.service.js
│   │       ├── product.service.js
│   │       ├── enquiry.service.js
│   │       ├── quotation.service.js
│   │       └── salesOrder.service.js   # convert, confirm (reserve), dispatch
│   └── tests/
│       ├── setup.js
│       ├── quotation.test.js
│       ├── salesOrder.test.js
│       ├── inventory.test.js
│       └── auth.test.js
└── frontend/
    ├── .env.example
    └── src/
        ├── api.js            # axios instance + token interceptor
        ├── AuthContext.jsx
        ├── App.jsx           # routes + protected route
        ├── styles.css
        └── pages/
            ├── Login.jsx
            ├── Enquiries.jsx
            ├── Quotations.jsx
            └── SalesOrders.jsx   # includes inventory table
```

**Layering rule (explainable in one sentence):**
Routes = "what URL, who is allowed, is the input valid". Services = "what the business does". Prisma = "how it's stored".
(Spring: Controller → Service → Repository.)

No separate controller layer — routes call services directly to keep it short.

---

## 4. Database Schema (Prisma)

Use `snake_case` table/column names via `@@map` / `@map` so raw SQL and the ER diagram are readable. Money columns use `Decimal @db.Decimal(12,2)`. Percentages use `Decimal @db.Decimal(5,2)`.

### Tables

| Table | Key columns | Constraints |
|---|---|---|
| `users` | id, name, email, password_hash, role (enum ADMIN/SALES) | email UNIQUE |
| `customers` | id, company_name, contact_person, mobile, email, city | — |
| `products` | id, code, name, category, unit, base_price | code UNIQUE |
| `inventory` | id, product_id, physical_qty, reserved_qty | product_id UNIQUE (1:1 with product) |
| `enquiries` | id, enquiry_no, customer_id, enquiry_date, required_date, notes, status, created_by | enquiry_no UNIQUE, FK customer, FK user |
| `enquiry_items` | id, enquiry_id, product_id, quantity | FK enquiry (cascade delete), FK product |
| `quotations` | id, quotation_no, enquiry_id, customer_id, valid_until, status, grand_total, created_by | quotation_no UNIQUE, FKs |
| `quotation_items` | id, quotation_id, product_id, quantity, unit_price, discount_pct, gst_pct, line_amount | FKs |
| `sales_orders` | id, order_no, quotation_id, customer_id, order_date, status, total_amount | order_no UNIQUE, **quotation_id UNIQUE** |
| `sales_order_items` | id, sales_order_id, product_id, quantity | FKs |
| `dispatches` | id, dispatch_no, sales_order_id, dispatch_date, vehicle_no, driver_name | dispatch_no UNIQUE, **sales_order_id UNIQUE** |

Dispatched products/quantities = the sales order items (full dispatch only, see Section 6.5). No separate dispatch_items table in the simplest version — document this as a deliberate simplification.

Status fields use Prisma enums: `Role`, `EnquiryStatus`, `QuotationStatus`, `SalesOrderStatus`.

### Database-level CHECK constraints (safety net)

Prisma cannot declare CHECK constraints, so after the first migration is generated, **manually add them to the migration SQL** (or create a second migration with `--create-only` and edit it):

```sql
ALTER TABLE inventory ADD CONSTRAINT chk_physical_non_negative CHECK (physical_qty >= 0);
ALTER TABLE inventory ADD CONSTRAINT chk_reserved_non_negative CHECK (reserved_qty >= 0);
ALTER TABLE inventory ADD CONSTRAINT chk_reserved_le_physical CHECK (reserved_qty <= physical_qty);
ALTER TABLE enquiry_items     ADD CONSTRAINT chk_eq_qty_pos CHECK (quantity > 0);
ALTER TABLE quotation_items   ADD CONSTRAINT chk_qt_qty_pos CHECK (quantity > 0);
ALTER TABLE quotation_items   ADD CONSTRAINT chk_discount_range CHECK (discount_pct BETWEEN 0 AND 100);
ALTER TABLE quotation_items   ADD CONSTRAINT chk_gst_range CHECK (gst_pct BETWEEN 0 AND 100);
ALTER TABLE sales_order_items ADD CONSTRAINT chk_so_qty_pos CHECK (quantity > 0);
```

Explanation for interview: *application code enforces the rules; the database guarantees them even if code has a bug.*

**Available quantity is never stored.** It is always computed: `physical_qty - reserved_qty`. (Avoids data getting out of sync.)

### Document numbers

Format: `ENQ-0001`, `QT-0001`, `SO-0001`, `DSP-0001`. Simplest approach: inside the same transaction, create the row, then update it with the number built from its `id` (`'ENQ-' + String(id).padStart(4, '0')`). Put this in one tiny helper `formatNo(prefix, id)`.

### Seed data (`prisma/seed.js`)

- Users: `admin@erp.com / Admin@123` (ADMIN), `sales@erp.com / Sales@123` (SALES). Passwords hashed with bcrypt.
- 3 customers (e.g. ABC Engineering Pvt. Ltd., Mumbai).
- 6+ industrial products with inventory, e.g. Mild Steel Sheet 2mm (MS-SHT-02, Sheets), Hydraulic Pump HP-200 (Nos), Ball Bearing 6205 (Nos), Industrial Valve 2" (Nos), Copper Wire 4mm (Metres), Welding Rod E6013 (Kg). Give realistic prices and varied stock (include one with low stock to demo the "insufficient stock" error).

---

## 5. Authentication & RBAC

- `POST /api/auth/login` → verify bcrypt hash → return `{ token, user: { id, name, role } }`.
- JWT payload: `{ id, role }`, expiry `8h`, secret from `JWT_SECRET`.
- No register endpoint needed (users are seeded). Mention this in README.
- `auth` middleware: reads `Authorization: Bearer <token>`, verifies, sets `req.user`, else **401**.
- `requireRole(...roles)` middleware: if `req.user.role` not in roles → **403**.
- **Every** protected route must use both on the backend. Frontend hiding buttons is extra, not the security.

### Permission matrix

| Action | ADMIN | SALES |
|---|---|---|
| View all records | ✅ | ✅ |
| Create customer / enquiry | ✅ | ✅ |
| Create quotation, change status (SENT/ACCEPTED/REJECTED) | ✅ | ✅ |
| Convert accepted quotation → sales order | ✅ | ✅ |
| View inventory | ✅ | ✅ |
| Update inventory (stock in / adjust physical) | ✅ | ❌ |
| Confirm sales order (reserve stock) | ✅ | ❌ |
| Dispatch sales order | ✅ | ❌ |
| Cancel sales order | ✅ | ❌ |

---

## 6. Business Rules (Implement Exactly)

### 6.1 Quotation calculation — `utils/calculations.js` (pure functions, no DB)

For each line:
```
base      = quantity × unit_price
discount  = base × discount_pct / 100
taxable   = base − discount
gst       = taxable × gst_pct / 100
line_amount = taxable + gst          (round to 2 decimals)
grand_total = sum of line_amount     (round to 2 decimals)
```
- The backend **always recalculates** these. If the client sends `line_amount` or `grand_total`, ignore them.
- To avoid floating-point errors, use Prisma's `Decimal` (decimal.js) or calculate in paise (integers) and convert back. Pick one approach and explain it in DECISIONS.md.
- `unit_price` defaults to the product's `base_price` if not sent.

### 6.2 Quotation status transitions

Allowed only: `DRAFT → SENT`, `SENT → ACCEPTED`, `SENT → REJECTED`. Anything else → **400** with a clear message. Keep transitions in one small object:
```js
const ALLOWED = { DRAFT: ['SENT'], SENT: ['ACCEPTED', 'REJECTED'], ACCEPTED: [], REJECTED: [] };
```

### 6.3 Convert quotation → sales order (`POST /api/quotations/:id/convert`)

Inside one `prisma.$transaction`:
1. Load quotation with items. Not found → 404.
2. Status must be `ACCEPTED`, else **400** ("Only ACCEPTED quotations can be converted").
3. Create sales order (status `PENDING`, total = quotation grand_total) and copy items.
4. **Duplicate protection:** `sales_orders.quotation_id` is UNIQUE. If Prisma throws `P2002`, return **409** ("Sales order already exists for this quotation"). Also check for an existing order first for a friendlier message — but the UNIQUE constraint is the real guarantee (handles double-clicks/race conditions).

### 6.4 Confirm sales order = reserve stock (`POST /api/sales-orders/:id/confirm`) — ADMIN only

**This is the key concurrency challenge.** Inside one `prisma.$transaction`:
1. Load order with items. Status must be `PENDING`, else 400.
2. Lock the inventory rows of all products in the order, **sorted by product_id** (consistent lock order prevents deadlocks):
   ```sql
   SELECT * FROM inventory WHERE product_id = ANY($1) ORDER BY product_id FOR UPDATE
   ```
   (use `tx.$queryRaw`).
3. For each item: `available = physical_qty - reserved_qty`. If `quantity > available` → throw 400 with details (`"Insufficient stock for MS-SHT-02: required 80, available 70"`). Throwing rolls back everything.
4. Increment `reserved_qty` for each product. **Physical does not change.**
5. Set order status `CONFIRMED`.

Interview explanation: *`FOR UPDATE` locks the row until the transaction ends. If A (reserve 80) and B (reserve 50) arrive together with 100 available, B waits for A. After A commits, B reads available = 20 and fails. The CHECK constraint `reserved_qty <= physical_qty` is a second safety net.*
(Spring equivalent: `@Transactional` + `@Lock(LockModeType.PESSIMISTIC_WRITE)`.)

### 6.5 Dispatch (`POST /api/sales-orders/:id/dispatch`) — ADMIN only

Simplest version = **full dispatch only** (entire order in one dispatch). Body: `{ vehicle_no, driver_name, dispatch_date? }`.

Inside one transaction:
1. Load order. `CANCELLED` → 400. Not `CONFIRMED` → 400 ("Only CONFIRMED orders can be dispatched").
2. Lock inventory rows (same query as 6.4).
3. For each item: ensure `reserved_qty >= quantity` (dispatch never exceeds reserved), then decrement **both** `physical_qty` and `reserved_qty` by quantity.
4. Create dispatch record. `dispatches.sales_order_id` UNIQUE → a second dispatch is impossible (409).
5. Set order status `DISPATCHED`.

### 6.6 Cancel order (`POST /api/sales-orders/:id/cancel`) — ADMIN only

(Likely live-round change — implement it simply now.)
- `PENDING` → set `CANCELLED` (no stock change).
- `CONFIRMED` → in a transaction, lock rows, decrement `reserved_qty` by each item's quantity (release), set `CANCELLED`.
- `DISPATCHED` / `CANCELLED` → 400.

### 6.7 Inventory update (`PATCH /api/inventory/:productId`) — ADMIN only

Body: `{ physical_qty }` (absolute value). Reject if negative or if new physical < reserved_qty (400). Use a transaction with `FOR UPDATE` too.

---

## 7. API Endpoints

All under `/api`. All except login require `auth`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | /auth/login | public | Login |
| GET | /auth/me | any | Current user |
| GET / POST | /customers | any | List / create customer |
| GET | /products | any | Products with inventory + computed `available_qty` |
| PATCH | /inventory/:productId | ADMIN | Update physical stock |
| GET / POST | /enquiries | any | List / create (with items) |
| GET | /enquiries/:id | any | Enquiry detail |
| PATCH | /enquiries/:id/status | any | Manually mark LOST |
| GET / POST | /quotations | any | List / create (from enquiry) |
| GET | /quotations/:id | any | Detail with items |
| PATCH | /quotations/:id/status | any | SENT / ACCEPTED / REJECTED |
| POST | /quotations/:id/convert | any | Create sales order |
| GET | /sales-orders | any | List with items + current availability |
| GET | /sales-orders/:id | any | Detail incl. customer → enquiry → quotation trace |
| POST | /sales-orders/:id/confirm | ADMIN | Reserve stock |
| POST | /sales-orders/:id/dispatch | ADMIN | Dispatch |
| POST | /sales-orders/:id/cancel | ADMIN | Cancel + release |

### Response & error conventions

- Success: return the resource JSON directly (201 for create).
- Error: `{ "error": "message" }` with the right status: 400 validation/business rule, 401 no/invalid token, 403 wrong role, 404 not found, 409 conflict/duplicate, 500 unexpected.
- Services throw `new AppError(status, message)`. One `errorHandler` middleware converts errors to JSON (also maps Prisma `P2002` → 409, `P2025` → 404, zod errors → 400). (Spring: `@ControllerAdvice`.)
- Wrap async route handlers so thrown errors reach the error handler (Express 5 does this automatically — prefer Express 5; otherwise a tiny `asyncHandler`).
- Validate every request body with a zod schema defined at the top of the route file.

---

## 8. Frontend (Keep Minimal)

- Plain React with `useState` / `useEffect`. No state library.
- `api.js`: axios instance, baseURL from `VITE_API_URL`, interceptor adds token, on 401 → logout.
- `AuthContext`: stores token + user in `localStorage`.
- Show backend error messages directly in a simple alert/banner — this makes business rules visible in the demo.
- Hide ADMIN-only buttons for SALES users (UX only; backend is the real guard).

### Screens

1. **Login** — email, password, show error.
2. **Enquiries** — form (select/create customer, dates, notes, dynamic product rows with quantity) + table (number, customer, date, status, items count).
3. **Quotations** — select enquiry → prefill its items with base prices; editable unit price, discount %, GST %; **live preview total on client for UX only**; save shows backend-calculated totals. Table with buttons: Send, Accept, Reject, Convert to Order.
4. **Sales Orders** — orders table (number, customer, quotation ref, total, status) with Confirm / Dispatch (small form: vehicle no, driver) / Cancel buttons. Below it, an **Inventory table**: code, name, physical, reserved, available (ADMIN can edit physical).

Responsive with simple flex/grid CSS. No design work beyond clean spacing.

---

## 9. Tests (Jest + Supertest)

- Use a separate test database: `DATABASE_URL` from `.env.test`. Before tests: `prisma migrate reset --force` (or truncate tables) and seed minimal data in `tests/setup.js`.
- Run with `--runInBand` (tests share one DB).
- Test against the real `app` exported from `app.js` (no mocking the DB — tests prove real DB constraints and locking).

Required tests:
1. **Quotation total calculated correctly** — unit test `calculations.js` with known values (e.g. 100 × 50, 10% disc, 18% GST → 5310.00) AND an API test showing a fake `grand_total` sent by the client is ignored.
2. **DRAFT and REJECTED quotations cannot be converted** → 400.
3. **Same quotation cannot create two orders** → second call 409; also fire two converts with `Promise.all` and assert exactly one succeeds.
4. **Cannot reserve more than available** → 400, and inventory unchanged.
5. **Unauthorized access** → no token = 401; SALES calling confirm/dispatch = 403.
6. **Bonus: concurrent reservation** — available 100; two PENDING orders for 80 and 50; confirm both with `Promise.all`; assert exactly one 200 and one 400, and final `reserved_qty` is 80 or 50 (never 130).

Extra if time: dispatch updates both physical and reserved; cancelled order cannot be dispatched.

---

## 10. Build Phases, Phase Reports & Stop Points

Build the project in the 8 phases below, in order. Each phase ends with a **Phase Report**, an update to `docs/PROGRESS.md`, and a **stop-and-ask**. Suggest commit messages; Rahul commits himself.

### Phases

| Phase | Name | Commits | Done when |
|---|---|---|---|
| 1 | Backend foundation & database | 1, 2, 3 | Server starts; `prisma migrate dev` and seed run clean; CHECK constraints exist in PostgreSQL |
| 2 | Authentication & RBAC | 4 | Login returns a JWT; no token → 401; wrong role → 403 |
| 3 | Customers, products & inventory APIs | 5 | CRUD works; available qty comes from the single `getAvailable` function |
| 4 | Sales flow: enquiry → quotation → sales order | 6, 7, 8 | Backend recalculates totals; enquiry status side effects work; one quotation → at most one order |
| 5 | Stock: reserve, dispatch, cancel | 9, 10 | Confirm locks rows with `FOR UPDATE`; dispatch and cancel update stock inside transactions |
| 6 | Tests | 11 | All required tests in Section 9 pass with `--runInBand` |
| 7 | Frontend | 12, 13, 14 | All screens in Section 8 work against the real backend |
| 8 | Documentation | 15 | README, ER diagram, Postman collection and DECISIONS.md complete |

Commit messages:

1. `chore: initialize backend with express, prisma and env config`
2. `feat: add prisma schema, migrations and check constraints`
3. `feat: add seed data for users, customers, products and inventory`
4. `feat: add jwt auth, role middleware and error handling`
5. `feat: add customers and products/inventory APIs`
6. `feat: add enquiry APIs`
7. `feat: add quotation APIs with backend calculation`
8. `feat: add quotation to sales order conversion`
9. `feat: add stock reservation with row locking on order confirm`
10. `feat: add dispatch and order cancellation`
11. `test: add required and concurrency tests`
12. `chore: initialize react frontend with auth and routing`
13. `feat: add enquiries and quotations screens`
14. `feat: add sales orders and inventory screen`
15. `docs: add README, ER diagram, API collection and decisions`

### Phase Report (write this at the end of EVERY phase)

Plain language, short. Use exactly these headings:

```
## Phase N — <name>: DONE

1. What I built      — 3–6 plain sentences: what exists now that didn't before.
2. Files             — every file created or changed, one line each on its purpose.
3. Business rules    — each rule implemented this phase and the file/function it lives in.
4. Spring Boot map   — how this phase maps to what Rahul already knows (e.g. middleware = filter chain).
5. Check it yourself — exact commands to run + the result Rahul should see.
6. What I ran        — the commands I actually ran and their real output (pass/fail). Never claim something works without running it.
7. Be ready to explain — 2–3 questions an interviewer is likely to ask about this phase, each with a one-line answer.
8. Commit            — the suggested commit message(s) for this phase.
9. Next phase        — name of the next phase and what it will add, in 1–2 lines.
```

### `docs/PROGRESS.md` (update at the end of every phase)

Append one entry per phase so Rahul can see the whole project history in one place:

```
## Phase N — <name> — DONE
- Built: <one line>
- Key files: <list>
- Tests/checks: <what passed>
- Commit: <message>
- Open issues: <none, or what is left>
```

Keep a status line at the top of the file: `Current phase: N of 8 — <name>`.

### Stop and ask (end of every phase)

After the Phase Report and the PROGRESS.md update, **stop** and end with exactly one question:

> Phase N (<name>) is done. Reply **"next"** to start Phase N+1 (<name>), or tell me what to change first.

Rules:
- Do not write any code for the next phase until Rahul replies.
- If Rahul asks for changes, make them, give a short "Changes" report (what changed, which files, re-run results), update PROGRESS.md, and ask again.
- If a check or test fails, do not mark the phase DONE. Report which piece failed and why, and ask how to proceed.

---

## 11. Documentation to Produce

### `README.md`
Tech stack, prerequisites, setup steps, database creation, `.env` variables (backend: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `CORS_ORIGIN`; frontend: `VITE_API_URL`), migrate + seed commands, run backend/frontend, run tests, test credentials, known simplifications (full dispatch only, no registration, seeded users).

### `docs/ER-diagram.md`
Mermaid `erDiagram` of all tables and relations.

### `docs/postman_collection.json`
All endpoints, with a `{{token}}` variable and a login request that sets it.

### `docs/PROGRESS.md`
Phase-by-phase log of what was built (format in Section 10). Created in Phase 1, updated at the end of every phase.

### `docs/DECISIONS.md` (interview cheat sheet — keep it short and plain)
For each topic, 3–5 lines answering "what did you do and why":
- Schema design and why available qty is computed, not stored
- Why CHECK + UNIQUE constraints in addition to code checks
- How JWT + RBAC works (with the Spring Security comparison)
- How quotation totals are calculated and why the backend recalculates
- How duplicate sales orders are prevented
- **How concurrent reservations are prevented** (FOR UPDATE, lock ordering, what happens to request B)
- Why transactions are used in convert/confirm/dispatch/cancel
- Simplifications made and how they'd be extended (partial dispatch → `dispatch_items` table)
- Request flow walkthrough: `request → auth → requireRole → zod → service → prisma transaction → response`

---

## 12. Prepare for the Live Change Round

Design so these take ≤ 20 minutes. Do NOT implement them now; just keep the code shaped so they're easy:

**A. Add DAMAGED stock** — steps Rahul should be able to do:
1. Add `damagedQty Int @default(0) @map("damaged_qty")` to `Inventory`; `npx prisma migrate dev --name add_damaged_qty`; update CHECK to `reserved_qty + damaged_qty <= physical_qty`.
2. Update the single `available` formula → `physical - reserved - damaged`.
3. Allow ADMIN to set `damaged_qty` in `PATCH /inventory/:productId`.
4. Add a "Damaged" column in the frontend inventory table.

➡ To make this trivial: **compute available in exactly ONE backend function** (`getAvailable(inv)` in `product.service.js` or `utils`) and use it everywhere (listing, confirm check). Also compute it in ONE frontend place.

**B. Cancel confirmed order & release stock** — already implemented in 6.6; make sure Rahul can explain it.

---

## 13. Coding Conventions

- `async/await` everywhere, no `.then()` chains.
- Descriptive names (`reserveStockForOrder`, not `process`).
- Functions short; one service function per business action.
- No unused code, no commented-out code, no console.log left behind (except server start).
- Never hard-code secrets; read from `process.env`. Provide `.env.example`; `.env` in `.gitignore`.
- Enable CORS only for `CORS_ORIGIN`.
- Before finishing any phase: run the server/tests and confirm they pass. Never claim something works without running it. Then write the Phase Report, update `docs/PROGRESS.md`, and stop and ask (Section 10).
