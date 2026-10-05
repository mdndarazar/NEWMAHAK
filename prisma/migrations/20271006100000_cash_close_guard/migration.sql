-- نشست ۱۹۰ — قفل یکتای بستن صندوق (اولین بستن هر نشست/بازه).
-- بستن دوباره با تأیید (`allowRepeatClose`) این ردیف را دست نمی‌زند.
CREATE TABLE IF NOT EXISTS "CashCloseGuard" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
