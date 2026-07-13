// Secondary, defensive safeguard against dummy/test data reaching a production
// display. The backend already excludes records flagged `isDummy: true` from all
// production queries by default (see server/utils/dummyFilter.js); this filter is
// belt-and-suspenders for lists rendered in non-developer admin views, guarding
// against a future regression or an accidental `includeDummy=true` fetch.
//
// Developer Settings / Dummy Data views must NOT use this — they intentionally
// display dummy records.
export function excludeDummy(records) {
  if (!Array.isArray(records)) return records;
  return records.filter((record) => record?.isDummy !== true);
}

export default excludeDummy;
