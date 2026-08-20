// ── The Accredited Haulers upload — canonical worked example ────────────────
//
// The rows the format guide displays, keyed by HAULER_UPLOAD_COLUMNS field
// names. Kept as pure data in its own module, apart from the JSX that renders
// it, so the test suite can push it through the REAL parser and merge and prove
// the guide teaches a file the uploader actually accepts. A guide that
// demonstrates a layout the importer rejects is worse than no guide at all.
//
// ONE hauler with TWO vehicles and THREE client groups — deliberately lopsided,
// because that is the case the row rule exists for and the case a symmetrical
// example silently fails to teach:
//
//   · row 1 shows two clients sharing one cell (same type AND same location)
//   · row 3 carries no vehicle at all — a clients-only continuation row
//   · five clients are registered across three rows on a two-truck hauler
//
// `_sheetRow` is the row number as it appears in Excel (the header is row 1);
// `_clientsOnly` tints the continuation row. Both are display metadata and are
// stripped before the rows are treated as an upload.
export const HAULER_UPLOAD_EXAMPLE_ROWS = [
  {
    key: "r1",
    _sheetRow: 2,
    haulerName: "XYZ Hauling Services",
    numberOfTrucks: "2",
    officeAddress: "San Fernando, Pampanga",
    plateNumber: "ABC-1234",
    vehicleType: "Dump Truck",
    capacity: "15",
    capacityUnit: "m³",
    privateSectorClients: "ABC Manufacturing, DEF Foods",
    clientType: "Private",
    clientAddress: "San Fernando, Pampanga",
    clientRegion: "Region III (Central Luzon)",
    clientProvince: "Pampanga",
    clientMunicipality: "San Fernando",
  },
  {
    key: "r2",
    _sheetRow: 3,
    haulerName: "XYZ Hauling Services",
    numberOfTrucks: "2",
    plateNumber: "DEF-5678",
    vehicleType: "Compactor",
    capacity: "12",
    capacityUnit: "m³",
    privateSectorClients: "Baliuag LGU",
    clientType: "LGU",
    clientAddress: "Baliuag, Bulacan",
    clientRegion: "Region III (Central Luzon)",
    clientProvince: "Bulacan",
    clientMunicipality: "Baliuag",
  },
  {
    key: "r3",
    _sheetRow: 4,
    _clientsOnly: true,
    haulerName: "XYZ Hauling Services",
    numberOfTrucks: "2",
    privateSectorClients: "Plaridel LGU, Pulilan LGU",
    clientType: "LGU",
    clientRegion: "Region III (Central Luzon)",
    clientProvince: "Bulacan",
  },
];

// What the guide's caption claims the example produces. Asserted by the test
// suite against the real merge, so the caption cannot quietly become a lie.
export const HAULER_UPLOAD_EXAMPLE_RESULT = {
  haulers: 1,
  vehicles: 2,
  clients: 5,
};
