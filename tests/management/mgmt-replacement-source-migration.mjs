/** Smoke test for the replacement-price source migration against a legacy SQLite schema. */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE "SaleInvoice" ("id" INTEGER PRIMARY KEY, "issuedAt" INTEGER, "issuedAtJalali" TEXT);
  CREATE TABLE "SaleItemCost" (
    "saleItemId" INTEGER PRIMARY KEY,
    "invoiceId" INTEGER,
    "variantId" INTEGER,
    "qty" INTEGER,
    "replacementCost" INTEGER,
    "costStatus" TEXT
  );
  CREATE TABLE "PurchaseInvoice" ("id" INTEGER PRIMARY KEY, "status" TEXT, "issuedAtJalali" TEXT);
  CREATE TABLE "PurchaseInvoiceItem" ("invoiceId" INTEGER, "variantId" INTEGER);
  CREATE TABLE "PurchaseLot" (
    "id" INTEGER PRIMARY KEY,
    "purchaseInvoiceId" INTEGER,
    "variantId" INTEGER,
    "source" TEXT,
    "lotDate" INTEGER
  );
  INSERT INTO "PurchaseInvoice" VALUES (101, 'CONFIRMED', '1405/01/09'), (102, 'CONFIRMED', '1405/01/11');
  INSERT INTO "PurchaseInvoiceItem" VALUES (101, 7), (102, 7);
  INSERT INTO "PurchaseLot" VALUES
    (1, 101, 7, 'PURCHASE', 1000),
    (2, 102, 7, 'PURCHASE', 2000),
    (3, NULL, 8, 'PURCHASE', 600);
  INSERT INTO "SaleInvoice" VALUES
    (201, 1500, '1405/01/10'),
    (202, 2500, '1405/01/12'),
    (203, 700, '1405/01/12'),
    (204, 700, '1405/01/12'),
    (205, 2500, '1405/01/12'),
    (206, 2050, '1405/01/11');
  INSERT INTO "SaleItemCost" VALUES
    (301, 201, 7, 1, 1000000, 'EXACT'),
    (302, 202, 7, 1, 1000000, 'EXACT'),
    (303, 203, 8, 1, 500000, 'EXACT'),
    (304, 204, 9, 1, 500000, 'EXACT'),
    (305, 205, 7, 0, 0, 'OUTSIDE'),
    (306, 206, 7, 1, 1000000, 'EXACT');
`)

db.exec(readFileSync('prisma/migrations/20271011100000_management_cost_replacement_source/migration.sql', 'utf8'))
const rows = db.prepare('SELECT saleItemId, replacementSource, replacementPurchaseInvoiceId FROM "SaleItemCost" ORDER BY saleItemId').all()
const actual = rows.map((r) => [Number(r.saleItemId), r.replacementSource, r.replacementPurchaseInvoiceId == null ? null : Number(r.replacementPurchaseInvoiceId)])
const expected = [
  [301, 'PURCHASE_INVOICE', 101],
  [302, 'PURCHASE_INVOICE', 102],
  [303, 'NO_INVOICE', null],
  [304, 'PRODUCT_CARD', null],
  [305, 'LEGACY', null],
  // دو فاکتور هم‌روز با فروش: نمی‌شود از روی تاریخ/فی هم‌قیمت فهمید فروش قبل یا بعد از P2 بوده.
  [306, 'LEGACY', null]
]
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error('✗ migration backfill mismatch', { expected, actual })
  process.exit(1)
}
console.log('✓ replacement source migration: 6 rows classified conservatively · 0 failures')
db.close()
