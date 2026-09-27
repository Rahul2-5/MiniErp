# Mini ERP

A small sales ERP: **Customer → Enquiry → Quotation → Sales Order → Inventory Reservation → Dispatch**.
Built as an interview case study, with the focus on business rules, PostgreSQL design, transactions, concurrency and role-based access. The UI is deliberately plain.

| Stage | Who | Statuses |
|---|---|---|
| Enquiry | SALES | NEW → QUOTED → WON / LOST |
| Quotation | SALES | DRAFT → SENT → ACCEPTED / REJECTED |
| Sales order | SALES creates, ADMIN confirms | PENDING → CONFIRMED → DISPATCHED (or CANCELLED) |
| Dispatch | ADMIN | one record per order |

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ |
| Web framework | Express 5 |
| Database | PostgreSQL |
| ORM | Prisma 6 |
| Auth | jsonwebtoken + bcrypt |
| Validation | zod |
| Tests | Jest + Supertest |
| Frontend | React + Vite + react-router-dom + axios, one plain CSS file |
| Config | dotenv (`.env`) |

## Prerequisites

- Node.js 20 or newer (developed on 22) and npm
- PostgreSQL 14 or newer, running locally (developed on 18), and a user that can create databases (the default `postgres` user works)

## Setup

### 1. Create the databases

```
psql -U postgres -c "CREATE DATABASE mini_erp;"
psql -U postgres -c "CREATE DATABASE mini_erp_test;"
```

`mini_erp_test` is only used by the automated tests. Its name **must** end in `_test`: the tests empty every table before each test and refuse to run against any other database.

### 2. Backend

```
cd backend
cp .env.example .env          # Windows: copy .env.example .env
```

Open `backend/.env` and set `DATABASE_URL` (your PostgreSQL password) and a long random `JWT_SECRET`. Then:

```
npm install
npx prisma migrate dev        # creates all tables and the CHECK constraints
npm run seed                  # 2 users, 3 customers, 6 products with stock
npm start                     # http://localhost:4000  (npm run dev restarts on file changes)
```

Check it: `curl http://localhost:4000/api/health` returns `{"status":"ok"}`.

### 3. Frontend

```
cd frontend
cp .env.example .env          # Windows: copy .env.example .env
npm install
npm run dev                   # http://localhost:5173
```

Open http://localhost:5173 and log in.

## Environment variables

**backend/.env**

| Variable | Meaning | Example |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:secret@localhost:5432/mini_erp` |
| `JWT_SECRET` | Secret used to sign login tokens. Never commit it | a long random string |
| `JWT_EXPIRES_IN` | Token lifetime | `8h` |
| `PORT` | Port of the API | `4000` |
| `CORS_ORIGIN` | The only browser origin allowed to call the API | `http://localhost:5173` |

**frontend/.env**

| Variable | Meaning | Example |
|---|---|---|
| `VITE_API_URL` | Base URL of the API | `http://localhost:4000/api` |

`.env` files are in `.gitignore`; only the `.env.example` files are committed.

## Test credentials

| Role | Email | Password | Can do |
|---|---|---|---|
| ADMIN | `admin@erp.com` | `Admin@123` | everything, including confirm / dispatch / cancel orders and edit stock |
| SALES | `sales@erp.com` | `Sales@123` | customers, enquiries, quotations, convert to order, view stock |

There is no registration: users are created by the seed script.

## Try the demo flow

1. Log in as **SALES**. Create an enquiry for `HP-200` × 10. Create a quotation from it, then **Send**, **Accept** and **Convert to order**.
2. Log in as **ADMIN**, open **Sales Orders**, click **Confirm**. It fails with `Insufficient stock for HP-200: required 10, available 8` (the seed leaves only 8 in stock).
3. In the Inventory table set HP-200 physical stock to 20 and **Save**, then **Confirm** again. Reserved goes up, physical stays the same.
4. **Dispatch** the order (vehicle and driver). Physical and reserved both go down.
5. Try **Cancel** on a confirmed order to see the reserved stock released.

## Run the tests

```
cd backend
cp .env.test.example .env.test     # Windows: copy .env.test.example .env.test  (then set your password)
npm test
```

`npm test` applies the migrations to `mini_erp_test` and runs 64 tests one after another (`--runInBand`, they share one database) against the real Express app and real PostgreSQL. They cover the quotation maths, status rules, duplicate-order protection, insufficient stock, role checks, and concurrent reservations (two orders racing for the same stock).


## API overview

All endpoints are under `/api`. Everything except login needs `Authorization: Bearer <token>`. Errors always look like `{ "error": "message" }` with 400 (validation or business rule), 401, 403, 404 or 409.

| Method | Path | Role |
|---|---|---|
| POST | `/auth/login` | public |
| GET | `/auth/me` | any |
| GET, POST | `/customers` | any |
| GET | `/products` (with inventory and `available_qty`) | any |
| PATCH | `/inventory/:productId` | ADMIN |
| GET, POST | `/enquiries` | any |
| GET | `/enquiries/:id` | any |
| PATCH | `/enquiries/:id/status` (only `LOST`) | any |
| GET, POST | `/quotations` | any |
| GET | `/quotations/:id` | any |
| PATCH | `/quotations/:id/status` (`SENT`, `ACCEPTED`, `REJECTED`) | any |
| POST | `/quotations/:id/convert` | any |
| GET | `/sales-orders`, `/sales-orders/:id` | any |
| POST | `/sales-orders/:id/confirm`, `/dispatch`, `/cancel` | ADMIN |

## Known simplifications

- **Full dispatch only.** An order is dispatched in one go; there is no `dispatch_items` table. Partial dispatch would add that table.
- **No registration.** Users come from the seed script; there is no password reset or user management.
- **Seeded users and one role each.** A user is either ADMIN or SALES.
- **Quantities are whole numbers**, and a product can appear only once per enquiry or quotation.
- **A REJECTED quotation makes its enquiry LOST for good**; there is no "revise after rejection".
- **Not handled:** expired quotations (`valid_until` is stored but not enforced) and accepting two quotations of the same enquiry.
- **JWT is kept in `localStorage`**, the simplest option; an httpOnly cookie with CSRF protection would be more secure.
- **The frontend has no automated tests**; the backend is covered by the Jest suite.

## Project structure

```
mini-erp/
├── CLAUDE.md, README.md
├── docs/               DECISIONS.md, PROGRESS.md, ER-diagram.md, postman_collection.json
├── backend/
│   ├── prisma/         schema.prisma, migrations/ (with CHECK constraints), seed.js
│   ├── src/
│   │   ├── app.js, server.js, db.js
│   │   ├── middleware/ auth.js, requireRole.js, errorHandler.js
│   │   ├── utils/      AppError.js, calculations.js, formatNo.js
│   │   ├── routes/     URL + who is allowed + is the input valid
│   │   └── services/   business rules and database access
│   └── tests/          setup.js, globalSetup.js, *.test.js
└── frontend/src/       api.js, AuthContext.jsx, App.jsx, styles.css, format.js, pages/
```

Layering in one sentence: routes decide *which URL, who may call it, is the input valid*; services decide *what the business does*; Prisma decides *how it is stored*.
