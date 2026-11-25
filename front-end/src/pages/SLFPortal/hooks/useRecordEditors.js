import { useState } from "react";
import Swal from "sweetalert2";
import { UPLOAD_COLUMNS } from "../uploadHelpers";
import { buildHaulerExportRows } from "../haulerNormalization";
import * as XLSX from "xlsx";
import { inheritEntryCell } from "../cellPlacement";
import { EMPTY_TRUCK } from "../constants";

export default function useRecordEditors({
  baselineUnit, editingTruckKey, haulerDraft, haulers, portalUser, regions, saveCellEntryDraft,
  setActiveCellEntries, setClosedCellEntries, setEditingTruckKey, setTruckDraft, setTruckErrors,
  setTruckModalOpen, setTrucks, slfUnit, truckDraft, updateHaulerDraft, validateTruck, late,
}) {
  const [activeCellModalOpen, setActiveCellModalOpen] = useState(false);
  const [activeCellDraft, setActiveCellDraft] = useState({
    cellName: "",
    cellType: "",
    cellIndex: null,
    wasteType: "Residual",
    volume: null,
  });
  const [editingActiveCellKey, setEditingActiveCellKey] = useState(null);
  const [closedCellModalOpen, setClosedCellModalOpen] = useState(false);
  const [closedCellDraft, setClosedCellDraft] = useState({
    cellName: "",
    cellType: "",
    cellIndex: null,
    wasteType: "Residual",
    volume: null,
  });
  const [editingClosedCellKey, setEditingClosedCellKey] = useState(null);
  // Hauler client modal
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClientKey, setEditingClientKey] = useState(null);
  const [clientDraft, setClientDraft] = useState({
    clientName: "",
    // No default: the operator must choose LGU (municipal waste) or Private
    // (private sector waste). A pre-filled "Private" was saved unchosen.
    clientType: "",
    region: "",
    province: "",
    municipality: "",
  });
  const [clientProvinces, setClientProvinces] = useState([]);
  const [clientMunicipalities, setClientMunicipalities] = useState([]);

  // ── Active Cell Entry helpers ──
  const handleSaveActiveCellEntry = () =>
    saveCellEntryDraft(
      activeCellDraft,
      editingActiveCellKey,
      setActiveCellEntries,
      setActiveCellModalOpen,
    );

  // ── Closed Cell Entry helpers ──
  const handleSaveClosedCellEntry = () =>
    saveCellEntryDraft(
      closedCellDraft,
      editingClosedCellKey,
      setClosedCellEntries,
      setClosedCellModalOpen,
      { closed: true },
    );

  // ── Hauler Client helpers ──
  const handleSaveClient = () => {
    if (!String(clientDraft.clientName || "").trim()) {
      Swal.fire("Client name required", "Enter the name of the LGU or company.", "warning");
      return;
    }
    if (!["LGU", "Private"].includes(clientDraft.clientType)) {
      Swal.fire(
        "Client Type required",
        "Choose LGU if the client is a local government (its waste is municipal waste), or Private if it is a company (private sector waste).",
        "warning",
      );
      return;
    }
    // Province is required so the client can be classified within/outside Region 3.
    if (!clientDraft.province) {
      Swal.fire("Province required", "Select the client's province so it can be classified for Region 3.", "warning");
      return;
    }
    // Resolve PSGC codes to human-readable names for LGU type
    const regionName =
      (regions || []).find((r) => String(r.code) === clientDraft.region)
        ?.name || "";
    const provinceName =
      (clientProvinces || []).find(
        (p) => String(p.code) === clientDraft.province,
      )?.name || "";
    const municipalityName =
      (clientMunicipalities || []).find(
        (m) => String(m.code) === clientDraft.municipality,
      )?.name || "";
    const toSave = {
      ...clientDraft,
      clientName: String(clientDraft.clientName || "").trim(),
      clientAddress: String(clientDraft.clientAddress || "").trim(),
      regionName,
      provinceName,
      municipalityName,
    };
    const existing = haulerDraft.privateSectorClients || [];
    if (editingClientKey != null) {
      // Merge onto the stored record so fields the modal does not edit survive.
      // The legacy `address` alias is dropped: the modal now owns clientAddress,
      // and leaving the alias would resurrect an address the user just cleared.
      updateHaulerDraft(
        "privateSectorClients",
        existing.map((c) => {
          if (c.key !== editingClientKey) return c;
          // eslint-disable-next-line no-unused-vars
          const { address, ...stored } = c;
          return { ...stored, ...toSave, key: editingClientKey };
        }),
      );
    } else {
      updateHaulerDraft("privateSectorClients", [
        ...existing,
        { ...toSave, key: Date.now() },
      ]);
    }
    setClientModalOpen(false);
  };

  // ── Export Hauler Data (client-side, scoped to THIS portal user's loaded
  //    baseline). CSV with UTF-8 BOM (preserves PH characters) and
  //    formula-injection-safe cells. ──
  const csvCell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralize spreadsheet formulas
    if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const downloadCsv = (rows, name) => {
    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  // The export's headers and field order ARE UPLOAD_COLUMNS.hauler, and every
  // value is placed by buildHaulerExportRows under the field the parser reads it
  // from — so the file this button produces is by construction a file the
  // uploader accepts, i.e. a working bulk-EDIT sheet rather than a read-only
  // report.
  //
  // It used to emit a layout of its own (Hauler Office Address / Client Ref /
  // Region / Province / City/Municipality) with no Number of Trucks column at
  // all and no vehicle columns: the uploader rejected it outright for a missing
  // required column, and its leading address column was read as the hauler's
  // NAME — so nothing exported here could ever be edited and sent back.
  const exportHaulerData = () => {
    const rows = [UPLOAD_COLUMNS.hauler.map((column) => column.label)];
    (haulers || []).forEach((hauler) => {
      buildHaulerExportRows(hauler, baselineUnit || slfUnit).forEach((row) =>
        rows.push(UPLOAD_COLUMNS.hauler.map((column) => row[column.field] ?? "")),
      );
    });
    const who = String(portalUser?.companyName || portalUser?.email || "portal").replace(/[^a-z0-9]+/gi, "_");
    downloadCsv(rows, `hauler-data_${who}_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ONE hauler, same 13-column layout — offered inside Edit Accredited Hauler
  // so a single record can be pulled out and corrected without exporting, and
  // then having to find it in, the whole facility's file.
  const exportSingleHaulerData = (hauler) => {
    if (!hauler?.haulerName) return;
    const rows = [
      UPLOAD_COLUMNS.hauler.map((column) => column.label),
      ...buildHaulerExportRows(hauler, baselineUnit || slfUnit).map((row) =>
        UPLOAD_COLUMNS.hauler.map((column) => row[column.field] ?? ""),
      ),
    ];
    const who = String(hauler.haulerName).replace(/[^a-z0-9]+/gi, "_");
    downloadCsv(rows, `hauler-data_${who}_${new Date().toISOString().slice(0, 10)}.csv`);
  };
  // The Accredited Haulers sample template. Its headers, sample values and rules
  // are generated from UPLOAD_COLUMNS.hauler — the same definitions the uploader
  // parses and validates with, and the same ones Export Hauler Data writes — so
  // the template, the export and the uploader are ONE format by construction and
  // a file downloaded here always imports.
  //
  // It previously emitted HAULER_EXPORT_HEADERS (the hauler-DATA export layout),
  // which has no "Number of Trucks" column at all and leads with "Hauler Office
  // Address": the uploader rejected the file for a missing required column, and
  // the office address was read as the hauler's NAME.
  const downloadHaulerTemplate = () => {
    const sampleValue = (field) =>
      UPLOAD_COLUMNS.hauler.find((column) => column.field === field)?.sample || "";
    const haulerRow = (values) =>
      UPLOAD_COLUMNS.hauler.map((column) => {
        // Hauler Name and Number of Trucks identify the hauler and are validated
        // per row, so every row of the same hauler repeats them.
        if (column.field === "haulerName" || column.field === "numberOfTrucks") {
          return column.sample || "";
        }
        return values[column.field] ?? "";
      });
    // Row 1 — a full record: one vehicle plus its clients.
    const sampleRow = UPLOAD_COLUMNS.hauler.map((column) => column.sample || "");
    // Row 2 — the SAME hauler with a different plate, which teaches the
    // one-row-per-vehicle grouping rule instead of describing it.
    const secondVehicleRow = haulerRow({
      plateNumber: "DEF-5678",
      vehicleType: "Compactor",
      capacity: "12",
      capacityUnit: sampleValue("capacityUnit"),
    });
    // Row 3 — a clients-only continuation row: no plate at all, carrying a
    // second client group whose type and location differ from row 1's. This is
    // exactly the shape Export Hauler Data writes for a hauler with more client
    // groups than vehicles, so the template teaches the file the export produces
    // rather than only the file a hand-typed import would.
    const extraClientsRow = haulerRow({
      privateSectorClients: "GHI Municipality",
      clientType: "LGU",
      clientAddress: "Baliuag, Bulacan",
      clientRegion: sampleValue("clientRegion"),
      clientProvince: "Bulacan",
      clientMunicipality: "Baliuag",
    });
    const workbook = late.buildUploadTemplateWorkbook({
      type: "hauler",
      sheetName: "Accredited Haulers",
      sampleRows: [sampleRow, secondVehicleRow, extraClientsRow],
      listValidations: [
        { label: "Capacity Unit", values: "tons,m3,m³" },
        { label: "Client Type", values: "Private,LGU" },
      ],
      instructions: [
        ["Accredited Haulers Upload Instructions"],
        ["Matching key", "Hauler Name. A name that already exists on this baseline UPDATES that hauler; a new name ADDS one. Matching ignores letter case and extra spaces."],
        ["Nothing is deleted", "This upload only adds and updates. Haulers that are not in the file stay exactly as they are — remove a hauler from the Accredited Haulers table instead."],
        ["One row = one vehicle", "Repeat the Hauler Name on another row to register a second vehicle. The Plate Number identifies the vehicle being updated."],
        ["Blank cells keep stored values", "An empty optional cell means \"leave what is already saved\". It never clears a field."],
        ["Repeated rows", "Two rows with the same Hauler Name AND Plate Number are merged into one — the later non-blank value wins. The preview flags them as Duplicate so an unintended repeat is visible. Rows that carry no Plate Number at all are clients-only rows and are compared by their client list instead."],
        ["Clients", "Comma-separate several client names in one cell. Client Type, Client Address, Client Region, Client Province and Client City/Municipality apply to every client on that row. List clients with a different type or location on another row of the same hauler."],
        ["Client requirements", "A NEW client needs the same details the Add Client form asks for: Client Type (Private or LGU) and Client Province, which is what classifies it within or outside Region 3. On an update these may be left blank to keep what is stored."],
        ["Editing exported data", "\"Export Hauler Data\" writes these exact columns, so the export can be corrected in Excel and uploaded straight back. Row 3 of the sample sheet shows the clients-only row the export uses when a hauler serves more client groups than it has vehicles."],
        ["Saving", "The import updates the on-screen Accredited Haulers table only. Click \"Save Baseline Update\" to persist it."],
        [],
        ["Common upload errors"],
        ["Missing Hauler Name or Number of Trucks column"],
        ["Blank Hauler Name or Number of Trucks value"],
        ["Number of Trucks or Capacity that is zero, negative or not a number"],
        ["Capacity Unit that is not tons, m3 or m³"],
        ["Client Type that is not Private or LGU"],
      ],
    });
    XLSX.writeFile(workbook, "Accredited_Haulers_Template.xlsx");
  };

  const handleSaveTruck = () => {
    if (!validateTruck()) return;
    // Every transport-entry unit is forced to the SLF's declared baseline unit so
    // an entry can never carry a mismatched unit (see validateTransportUnits).
    const entryUnit = baselineUnit || slfUnit;
    // Flatten first vehicle into top-level fields for backward compat.
    //
    // A vehicle with NO cell of its own inherits the ENTRY's placement. The entry
    // is placed as a whole — that is what Assign to Cell does, and what a cell
    // chosen on the entry means — so every vehicle in it went to that cell.
    //
    // This is not cosmetic. The server reads placement from EACH VEHICLE and
    // ignores the truck-level cell when vehicles are present (see
    // portalAuth#summarizeCellAssignment), so a vehicle left without one is
    // counted as unplaced waste and lands the operator in the Organize Cells
    // backlog for an entry they had already placed.
    const vehicles = inheritEntryCell(
      (truckDraft.vehicles || []).map(({ key, ...rest }) => ({
        ...rest,
        capacityUnit: entryUnit,
        actualVolumeUnit: entryUnit,
      })),
      truckDraft,
    );
    const first = vehicles[0] || {};
    // Derive entry-level totals from the per-vehicle waste placements so that
    // downstream summaries (which read truck-level fields) stay correct.
    const filledVehicles = vehicles.filter(
      (v) => v.plateNumber || v.actualVolume != null,
    );
    const totalVolume = filledVehicles.reduce(
      (sum, v) => sum + Number(v.actualVolume || 0),
      0,
    );
    const anyHaz = filledVehicles.some((v) =>
      String(v.wasteType || "").toLowerCase().includes("hazard"),
    );
    const representativeWasteType =
      filledVehicles.find((v) => v.wasteType)?.wasteType ||
      truckDraft.wasteType ||
      undefined;
    const unionHazCodes = [
      ...new Set(filledVehicles.flatMap((v) => v.hazWasteCode || [])),
    ];
    const savedDraft = {
      ...truckDraft,
      plateNumber: first.plateNumber || truckDraft.plateNumber || "",
      truckCapacity: first.capacity ?? truckDraft.truckCapacity,
      truckCapacityUnit: entryUnit,
      // Entry-level rollups derived from vehicles
      actualVolume: filledVehicles.length ? totalVolume : truckDraft.actualVolume,
      actualVolumeUnit: entryUnit,
      wasteType: anyHaz ? "Treated Hazardous Waste" : representativeWasteType,
      hazWasteCode: unionHazCodes,
      cellName: first.cellName || "",
      cellType: first.cellType || "",
      cellIndex:
        typeof first.cellIndex === "number" ? first.cellIndex : null,
      vehicles,
    };
    if (editingTruckKey) {
      setTrucks((prev) =>
        prev.map((t) =>
          t.key === editingTruckKey ? { ...t, ...savedDraft } : t,
        ),
      );
    } else {
      setTrucks((prev) => [...prev, { key: Date.now(), ...savedDraft }]);
    }
    setTruckModalOpen(false);
    setEditingTruckKey(null);
    setTruckDraft({ ...EMPTY_TRUCK });
    setTruckErrors({});
  };

  return {
    activeCellDraft, activeCellModalOpen, clientDraft, clientModalOpen, clientMunicipalities,
    clientProvinces, closedCellDraft, closedCellModalOpen, downloadHaulerTemplate,
    editingActiveCellKey, editingClientKey, editingClosedCellKey, exportHaulerData,
    exportSingleHaulerData, handleSaveActiveCellEntry, handleSaveClient, handleSaveClosedCellEntry,
    handleSaveTruck, setActiveCellDraft, setActiveCellModalOpen, setClientDraft, setClientModalOpen,
    setClientMunicipalities, setClientProvinces, setClosedCellDraft, setClosedCellModalOpen,
    setEditingActiveCellKey, setEditingClientKey, setEditingClosedCellKey,
  };
}
