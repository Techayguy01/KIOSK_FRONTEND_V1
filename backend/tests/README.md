# Backend Manual Test Scripts

These scripts are for ad-hoc / manual testing only. They do **not** run as part of CI.

> **Run all scripts from the `backend/` directory**, never from inside `tests/`.

---

## Scripts

### `test-booking.mjs`
Tests the booking chat endpoint end-to-end.

```bash
cd backend
node tests/test-booking.mjs
```

### `test-llm.mjs`
Fires a raw message at the LLM chat endpoint and prints the response.

```bash
cd backend
node tests/test-llm.mjs
```

### `check-db.ts`
Verifies the Prisma database connection and prints tenant/room counts.

```bash
cd backend
npx tsx tests/check-db.ts
```

---

## Output Files

`output/backend_log.txt` — Captured server logs from a test run.  
`output/bookings-output.json` — Sample booking API responses.
