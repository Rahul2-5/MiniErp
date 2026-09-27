# ER Diagram

Generated from `backend/prisma/schema.prisma`. Column names are exactly the same in PostgreSQL, Prisma, the JSON API and React.
`PK` primary key, `FK` foreign key, `UK` unique. Money is `Decimal(12,2)`, percentages `Decimal(5,2)`.

```mermaid
erDiagram
    USERS ||--o{ ENQUIRIES : "creates (created_by)"
    USERS ||--o{ QUOTATIONS : "creates (created_by)"
    CUSTOMERS ||--o{ ENQUIRIES : "raises"
    CUSTOMERS ||--o{ QUOTATIONS : "receives"
    CUSTOMERS ||--o{ SALES_ORDERS : "places"
    ENQUIRIES ||--|{ ENQUIRY_ITEMS : "has (cascade delete)"
    ENQUIRIES ||--o{ QUOTATIONS : "is quoted by"
    QUOTATIONS ||--|{ QUOTATION_ITEMS : "has"
    QUOTATIONS ||--o| SALES_ORDERS : "converts to (at most one)"
    SALES_ORDERS ||--|{ SALES_ORDER_ITEMS : "has"
    SALES_ORDERS ||--o| DISPATCHES : "is dispatched by (at most one)"
    PRODUCTS ||--o| INVENTORY : "has stock row"
    PRODUCTS ||--o{ ENQUIRY_ITEMS : "requested in"
    PRODUCTS ||--o{ QUOTATION_ITEMS : "quoted in"
    PRODUCTS ||--o{ SALES_ORDER_ITEMS : "ordered in"

    USERS {
        int id PK
        string name
        string email UK
        string password_hash "bcrypt"
        role role "ADMIN or SALES"
    }

    CUSTOMERS {
        int id PK
        string company_name
        string contact_person
        string mobile
        string email "optional"
        string city "optional"
    }

    PRODUCTS {
        int id PK
        string code UK
        string name
        string category
        string unit
        decimal base_price "Decimal(12,2)"
    }

    INVENTORY {
        int id PK
        int product_id FK, UK "1:1 with product"
        int physical_qty "CHECK >= 0"
        int reserved_qty "CHECK >= 0 and <= physical_qty"
    }

    ENQUIRIES {
        int id PK
        string enquiry_no UK "ENQ-0001"
        int customer_id FK
        date enquiry_date
        date required_date "optional"
        string notes "optional"
        enquiry_status status "NEW QUOTED WON LOST"
        int created_by FK
    }

    ENQUIRY_ITEMS {
        int id PK
        int enquiry_id FK "cascade delete"
        int product_id FK
        int quantity "CHECK > 0"
    }

    QUOTATIONS {
        int id PK
        string quotation_no UK "QT-0001"
        int enquiry_id FK
        int customer_id FK
        date valid_until
        quotation_status status "DRAFT SENT ACCEPTED REJECTED"
        decimal grand_total "calculated by backend"
        int created_by FK
    }

    QUOTATION_ITEMS {
        int id PK
        int quotation_id FK
        int product_id FK
        int quantity "CHECK > 0"
        decimal unit_price
        decimal discount_pct "CHECK 0 to 100"
        decimal gst_pct "CHECK 0 to 100"
        decimal line_amount "calculated by backend"
    }

    SALES_ORDERS {
        int id PK
        string order_no UK "SO-0001"
        int quotation_id FK, UK "one order per quotation"
        int customer_id FK
        date order_date
        sales_order_status status "PENDING CONFIRMED DISPATCHED CANCELLED"
        decimal total_amount
    }

    SALES_ORDER_ITEMS {
        int id PK
        int sales_order_id FK
        int product_id FK
        int quantity "CHECK > 0"
    }

    DISPATCHES {
        int id PK
        string dispatch_no UK "DSP-0001"
        int sales_order_id FK, UK "one dispatch per order"
        date dispatch_date
        string vehicle_no
        string driver_name
    }
```

## Rules the database enforces by itself

| Constraint | Table.column | What it guarantees |
|---|---|---|
| UNIQUE | `sales_orders.quotation_id` | One quotation can create at most one sales order, even if two requests race |
| UNIQUE | `dispatches.sales_order_id` | An order can only have one dispatch record |
| UNIQUE | `inventory.product_id` | Exactly one stock row per product |
| UNIQUE | `users.email`, `products.code`, `*_no` document numbers | No duplicates |
| CHECK | `inventory.physical_qty >= 0`, `reserved_qty >= 0` | Stock can never go negative |
| CHECK | `inventory.reserved_qty <= physical_qty` | Never reserve more than exists |
| CHECK | `quantity > 0` on enquiry, quotation and sales order items | No zero or negative lines |
| CHECK | `discount_pct` and `gst_pct` between 0 and 100 | Sensible percentages |
| FOREIGN KEY | every `*_id` column | No line without its parent record |

Available quantity is not a column. It is always computed as `physical_qty - reserved_qty` by `getAvailable` in `backend/src/services/product.service.js`.

## Status flows

```mermaid
stateDiagram-v2
    direction LR
    state "Enquiry" as E {
        [*] --> NEW
        NEW --> QUOTED: quotation created
        QUOTED --> WON: quotation ACCEPTED
        QUOTED --> LOST: quotation REJECTED or marked lost
        NEW --> LOST: marked lost
    }
```

```mermaid
stateDiagram-v2
    direction LR
    [*] --> DRAFT
    DRAFT --> SENT
    SENT --> ACCEPTED
    SENT --> REJECTED
    ACCEPTED --> [*]: convert to sales order
```

```mermaid
stateDiagram-v2
    direction LR
    [*] --> PENDING: converted from quotation
    PENDING --> CONFIRMED: confirm (reserve stock)
    PENDING --> CANCELLED: cancel
    CONFIRMED --> DISPATCHED: dispatch (stock leaves)
    CONFIRMED --> CANCELLED: cancel (release stock)
```
