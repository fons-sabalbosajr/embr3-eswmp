# SLF Portal — Developer Bulk Update / Bulk Upload Test Data

Regenerate with: `cd server && node scripts/generateDevTestWorkbook.js`
(headers come from `front-end/src/pages/SLFPortal/uploadHelpers.js`, so regenerating
after an import-format change keeps this data valid).

## Test environment — reuse the existing sealed demo environment

| | |
|---|---|
| Portal account | `demo.portal@eswmp-demo.local` |
| Admin account | `demo.admin@eswmp-demo.local` |
| Passwords | `DEMO_PORTAL_PASSWORD` / `DEMO_ADMIN_PASSWORD` in `server/.env` — **set these before seeding**; otherwise the in-source defaults in `seeds/seedDemoAccounts.js` are used |
| Container | SLF facility **Demonstration Valley** (Bulacan), `isDummy: true`, 5 cells |
| Create / refresh | `cd server && npm run seed:demo` (idempotent) |
| Reset / cleanup | `cd server && npm run seed:demo:reset` |

Isolation is enforced by the app, not by convention: accounts carry `isDemo`, all
data carries `isDummy`, production queries apply `isDummy: { $ne: true }`
(`server/utils/dummyFilter.js`), and `submitEntries` rejects a dummy account
submitting against a real facility *and* a real account submitting against a
dummy facility.

Alternative: **Developer Settings → Dummy Data Configuration**
(`server/routes/dummyData.js`, developer-only) creates additional dummy portal
users / dummy SLF facilities and assigns them.

## Open cells on the demo facility

| Cell | Status | Type | Usable for upload |
|---|---|---|---|
| Cell 1 | Used/Completed | Residual | no |
| Cell 2 | Active | Residual | **yes** |
| Cell 3 | Active (~94% full) | Residual | **yes** — expect a near-full warning |
| Cell 4 | Active | Treated Haz Waste | **yes** (hazardous rows) |
| Cell 5 | Under Construction | Residual | no |

Declared unit: **m³**.

## Files — upload these one at a time

The portal's uploader reads **only the first sheet** of a file, so each scenario
is its own single-sheet workbook. `SLF_Developer_Test_Data.xlsx` collects all of
them for reading — do not upload it.

| # | File | Where | Expected |
|---|---|---|---|
| 1 | `01_Hauler_Bulk_Upload.xlsx` | Data Entry → Baseline → Accredited Haulers → Upload | 3 rows import → 2 haulers, 3 vehicles, 3 clients. Then **Save Baseline**. |
| 2 | `02_Hauler_Partial_Update.xlsx` | same | Capacity 15→18 and 20→22 only. Office Address, Vehicle Type, Clients and Client Address must be unchanged. |
| 3 | `03_Disposal_Bulk_Upload.xlsx` | Data Entry → Waste Generation Information → Upload | 4 rows import, each bound to Cell 2/3/4 and its client. |
| 4 | `04_Invalid_Data_Test.xlsx` | same as 3 | Every one of the 8 rows is flagged; import is blocked. |
| 5 | `05_Duplicate_Data_Test.xlsx` | same as 1 | 3 rows merge into 1 hauler / 1 client / 2 vehicles. No "duplicated or ambiguous" error. |

`04_Invalid_Data_Test.xlsx` seeds one defect per row: missing disposal date,
negative volume, zero truck capacity, non-numeric volume, unknown hauler,
unknown client, a non-operational cell (Cell 5), and a missing cell.

## Manual checks that still need a live database

The automated suite (`npm test` in `server/` and `front-end/`) covers parsing,
validation, relationship/duplicate detection and the merge that decides whether a
partial upload preserves untouched fields. These remain manual:

1. Log in as the demo portal account and confirm the assigned SLF is
   *Demonstration Valley*.
2. Run files 1–5 in order; after each, refresh the page and re-check the values.
3. Save Baseline, navigate away, return — Baseline, General Information address,
   Truck Capacity and Client Address must all still be there.
4. Review & Submit — the blockage list must reflect the latest saved data.
5. Admin (`demo.admin@…`) → SLF Data Table → confirm only the demo facility's
   records changed, and that dummy rows are excluded from production dashboards.

## Safety

Every value is synthetic (`TEST HAULER 001`, `TEST CLIENT 001`,
`TEST CLIENT ADDRESS 001`, tickets `TEST-DT-…`). Confirm the logged-in account is
the demo portal account **before** uploading — never run these against a real SLF.
