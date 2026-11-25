import { useState, useEffect } from "react";
import { EMPTY_TRUCK, ORGANIZE_CELLS_ENABLED, EMPTY_VEHICLE, withRetry, EMPTY_HAULER } from "../constants";
import { vehicleNeedsCell } from "../cellPlacement";
import { TRUCK_CAPACITY_ELEVATION_FACTOR } from "../wasteGenValidation";
import Swal from "sweetalert2";
import { formatOrganizeWarningHtml } from "../organizeCellsValidation";
import api from "../../../api";
import { normalizeHaulerRecord, mergeHaulersByName } from "../haulerNormalization";

export default function useFleetEditors({
  activeCellOptions, baselineUnit, capacityAllowancePct, evaluateCapacity, extraTransportFields,
  getDeclaredVehicleCapacity, hasHazardousWasteCode, haulerBarangayList, haulerCities, haulerDraft,
  haulerProvinces, isRequired, isTreatedHazardousWaste, openCellOrganizer, regions,
  setHaulerBarangayList, setHaulerCities, setHaulerDraft, setHaulerProvinces, setHaulers, setTrucks,
  showError, slfUnit, trucks, unplacedSubmissions, vehicleEffectiveCapacity, late,
}) {
  const [truckDraft, setTruckDraft] = useState({ ...EMPTY_TRUCK });
  const [editingTruckKey, setEditingTruckKey] = useState(null);
  const [truckErrors, setTruckErrors] = useState({});
  // Transport & Disposal list: pagination + multi-select cell assignment.
  const [truckPage, setTruckPage] = useState(1);
  const [truckPageSize, setTruckPageSize] = useState(10);
  const [selectedTruckKeys, setSelectedTruckKeys] = useState([]);
  const [truckBulkCell, setTruckBulkCell] = useState(undefined);
  const [truckModalOpen, setTruckModalOpen] = useState(false);
  const [editingHaulerKey, setEditingHaulerKey] = useState(null);
  const [haulerErrors, setHaulerErrors] = useState({});
  const [haulerModalOpen, setHaulerModalOpen] = useState(false);
  // Which Collapse section Edit Accredited Hauler opens on ("basic" | "clients").
  const [haulerModalFocus, setHaulerModalFocus] = useState("basic");

  // ── Truck helpers (no <Form>, just state) ──

  const updateTruckDraft = (field, value) => {
    setTruckDraft((prev) => ({ ...prev, [field]: value }));
    if (truckErrors[field]) {
      setTruckErrors((prev) => {
        const copy = { ...prev };
        delete copy[field];
        return copy;
      });
    }
  };

  const validateTruck = () => {
    const errs = {};
    if (!truckDraft.disposalTicketNo?.trim())
      errs.disposalTicketNo = "Required";
    if (isRequired("hauler", true) && !truckDraft.hauler?.trim())
      errs.hauler = "Required";
    const vehicles = (truckDraft.vehicles || []).filter(
      (v) => v.plateNumber?.trim() || v.actualVolume != null,
    );
    if (
      isRequired("plateNumber", true) &&
      !(truckDraft.vehicles || []).some((v) => v.plateNumber?.trim())
    )
      errs.plateNumber = "At least one vehicle plate number is required";
    // Per-vehicle waste placement validation.
    const vehicleErrors = [];
    (truckDraft.vehicles || []).forEach((v, idx) => {
      const hasPlate = v.plateNumber?.trim();
      // Only validate vehicles that the user actually started filling in.
      if (!hasPlate && v.actualVolume == null && !v.wasteType && !v.cellName)
        return;
      const vehErr = {};
      if (isRequired("wasteType", true) && !v.wasteType)
        vehErr.wasteType = "Select waste type";
      if (
        isRequired("actualVolume", true) &&
        !v.actualVolume &&
        v.actualVolume !== 0
      )
        vehErr.actualVolume = "Enter the waste volume";
      // A cell is required per vehicle only when neither the vehicle NOR the
      // entry already has one. When the entry has been placed — through Assign to
      // Cell, an upload, or its own cell field — that placement is inherited by
      // every vehicle on save (inheritEntryCell in handleSaveTruck), so demanding
      // it again asks the operator to re-choose a cell the waste is already in.
      if (vehicleNeedsCell(v, truckDraft, activeCellOptions.length))
        vehErr.cellName = "Assign a disposal cell";
      if (
        isTreatedHazardousWaste(v.wasteType) &&
        !hasHazardousWasteCode(v.hazWasteCode)
      )
        vehErr.hazWasteCode = "Hazardous code required";
      // Truck capacity exceedance (with configurable allowance).
      const { capacity, capacityUnit } = vehicleEffectiveCapacity(truckDraft, v);
      const cap = evaluateCapacity(
        v.actualVolume,
        v.actualVolumeUnit,
        capacity,
        capacityUnit,
      );
      if (cap.unconvertible) {
        vehErr.actualVolume = `Waste volume unit "${v.actualVolumeUnit}" cannot be compared with the truck capacity unit "${(capacityUnit || slfUnit).replace("m3", "m³")}". Set the volume unit to ${(baselineUnit || slfUnit).replace("m3", "m³")}.`;
      } else if (cap.exceeded) {
        vehErr.actualVolume = `Waste volume exceeds the allowed truck capacity (max ${Number(
          cap.maxAllowed.toFixed(2),
        )} ${(capacityUnit || slfUnit).replace("m3", "m³")} at ${capacityAllowancePct}% allowance).`;
      }
      // Strict +10% elevation cap: the ENTERED capacity may not exceed the
      // declared/registered capacity for this plate by more than 10%. No override.
      const declaredCap = getDeclaredVehicleCapacity(truckDraft.hauler, v.plateNumber);
      if (
        declaredCap != null &&
        v.capacity != null &&
        v.capacity !== "" &&
        Number(v.capacity) >
          declaredCap * TRUCK_CAPACITY_ELEVATION_FACTOR + 1e-9
      ) {
        vehErr.capacity = `Truck Capacity exceeds the allowed maximum ${Number(
          (declaredCap * TRUCK_CAPACITY_ELEVATION_FACTOR).toFixed(2),
        )} (declared ${declaredCap} + 10%).`;
      }
      if (Object.keys(vehErr).length) vehicleErrors[idx] = vehErr;
    });
    if (vehicleErrors.length) {
      errs.vehicles = vehicleErrors;
      errs.plateNumber =
        errs.plateNumber ||
        "Complete the waste volume, type and disposal cell for each vehicle.";
    }
    if (vehicles.length === 0 && isRequired("actualVolume", true)) {
      errs.plateNumber = "Add at least one vehicle with its waste volume.";
    }
    // Validate additional transport fields from Portal Field Settings
    extraTransportFields.forEach((f) => {
      if (f.required) {
        const val = truckDraft[f.fieldKey];
        if (val === undefined || val === null || val === "") {
          errs[f.fieldKey] = "Required";
        }
      }
    });
    setTruckErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Centralized block guard (organizeCellsValidation): when past submissions
  // still need organizing, surface the detailed warning and offer the organizer.
  // Returns true when the action must be blocked. Used by the Add Transport Entry
  // guard and the pre-submit gate so the rule and message live in one place.
  const blockedByUnorganized = (actionLabel = "submit new entries") => {
    if (!ORGANIZE_CELLS_ENABLED || unplacedSubmissions.length === 0) return false;
    Swal.fire({
      icon: "warning",
      title: "Organize Past Submissions First",
      html:
        `You must complete your past submissions in <b>Organize Cells</b> before you can ${actionLabel}:` +
        formatOrganizeWarningHtml(unplacedSubmissions, baselineUnit || slfUnit),
      width: 620,
      showCancelButton: true,
      confirmButtonText: "Organize Now",
      cancelButtonText: "Later",
      confirmButtonColor: "#722ed1",
    }).then((result) => {
      if (result.isConfirmed) openCellOrganizer();
    });
    return true;
  };

  const handleAddTruck = () => {
    // Block creating a NEW transport entry while past submissions remain
    // unorganized (editing an existing draft row is still allowed).
    if (!editingTruckKey && blockedByUnorganized("add new transport entries")) {
      return;
    }
    // Block creating a NEW entry when no cell can accept waste.
    if (!editingTruckKey && late.allCellsUnavailable) {
      showError({
        type: "error",
        title: "No Available SLF Cell",
        message: late.NO_AVAILABLE_CELL_MESSAGE,
      });
      return;
    }
    if (!validateTruck()) return;
    if (editingTruckKey) {
      setTrucks((prev) =>
        prev.map((t) =>
          t.key === editingTruckKey ? { ...t, ...truckDraft } : t,
        ),
      );
      setEditingTruckKey(null);
    } else {
      setTrucks((prev) => [...prev, { key: Date.now(), ...truckDraft }]);
    }
    setTruckDraft({ ...EMPTY_TRUCK });
    setTruckErrors({});
  };

  const removeTruck = (key) => {
    setTrucks((prev) => prev.filter((t) => t.key !== key));
    setSelectedTruckKeys((prev) => prev.filter((k) => k !== key));
  };

  // Assign every currently-selected truck entry to a chosen disposal cell.
  const assignSelectedTrucksToCell = (cellValue) => {
    if (!cellValue || selectedTruckKeys.length === 0) return;
    const opt = activeCellOptions.find((o) => o.value === cellValue);
    setTrucks((prev) =>
      prev.map((t) =>
        selectedTruckKeys.includes(t.key)
          ? {
              ...t,
              cellName: cellValue,
              cellType: opt?.cellType ?? t.cellType ?? "",
              cellIndex:
                opt && typeof opt.cellIndex === "number"
                  ? opt.cellIndex
                  : t.cellIndex ?? null,
              // Keep any per-vehicle placements consistent with the truck cell.
              vehicles: (t.vehicles || []).map((v) => ({
                ...v,
                cellName: cellValue,
                cellType: opt?.cellType ?? v.cellType ?? "",
                cellIndex:
                  opt && typeof opt.cellIndex === "number"
                    ? opt.cellIndex
                    : v.cellIndex ?? null,
              })),
            }
          : t,
      ),
    );
    setSelectedTruckKeys([]);
    setTruckBulkCell(undefined);
  };

  // Keep the Transport & Disposal pagination in range as entries are added/removed.
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(trucks.length / truckPageSize));
    if (truckPage > maxPage) setTruckPage(maxPage);
  }, [trucks.length, truckPageSize, truckPage]);

  // ── Hauler helpers ──

  const updateHaulerDraft = (field, value) => {
    setHaulerDraft((prev) => {
      const next = { ...prev, [field]: value };
      // When numberOfTrucks changes, resize vehicles array
      if (field === "numberOfTrucks") {
        const count = Math.max(0, Math.min(value || 0, 50));
        const current = prev.vehicles || [];
        const vehicles = [];
        for (let i = 0; i < count; i++) {
          vehicles.push(current[i] || { ...EMPTY_VEHICLE });
        }
        next.vehicles = vehicles;
      }
      return next;
    });
    if (haulerErrors[field]) {
      setHaulerErrors((prev) => {
        const c = { ...prev };
        delete c[field];
        return c;
      });
    }
  };

  const updateVehicle = (index, field, value) => {
    setHaulerDraft((prev) => {
      const vehicles = [...(prev.vehicles || [])];
      vehicles[index] = { ...vehicles[index], [field]: value };
      return { ...prev, vehicles };
    });
  };

  const validateHauler = () => {
    const errs = {};
    if (!haulerDraft.haulerName?.trim()) errs.haulerName = "Required";
    if (!haulerDraft.numberOfTrucks && haulerDraft.numberOfTrucks !== 0)
      errs.numberOfTrucks = "Required";
    setHaulerErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // `focus` decides which Collapse section the modal opens on, so the row's
  // client-list action lands the user on Clients instead of making them hunt
  // for it. Note the file picker itself is NOT auto-opened: browsers only allow
  // input.click() inside a user gesture, so a dialog fired on modal mount would
  // be suppressed — the user clicks Upload Client List there.
  const openHaulerModal = (record, focus = "basic") => {
    setHaulerModalFocus(focus);
    setHaulerProvinces([]);
    setHaulerCities([]);
    setHaulerBarangayList([]);
    if (record) {
      setEditingHaulerKey(record.key);
      // Migrate legacy single-vehicle data to vehicles array
      let vehicles = Array.isArray(record.vehicles) ? [...record.vehicles] : [];
      if (
        vehicles.length === 0 &&
        (record.plateNumber || record.vehicleType || record.capacity != null)
      ) {
        vehicles = [
          {
            plateNumber: record.plateNumber || "",
            vehicleType: record.vehicleType || "",
            capacity: record.capacity,
            capacityUnit: record.capacityUnit || slfUnit,
          },
        ];
      }
      const count = record.numberOfTrucks || vehicles.length || 0;
      // Ensure vehicles array matches numberOfTrucks
      while (vehicles.length < count) vehicles.push({ ...EMPTY_VEHICLE });
      if (vehicles.length > count && count > 0)
        vehicles = vehicles.slice(0, count);
      setHaulerDraft({
        haulerName: record.haulerName || "",
        numberOfTrucks: count || null,
        officeAddress: record.officeAddress || "",
        officeRegion: record.officeRegion || "",
        officeProvince: record.officeProvince || "",
        officeCity: record.officeCity || "",
        officeBarangay: record.officeBarangay || "",
        vehicles,
        privateSectorClients: Array.isArray(record.privateSectorClients)
          ? record.privateSectorClients
          : record.privateSectorClients
            ? [record.privateSectorClients]
            : [],
      });
      // Pre-load cascading address lists
      if (record.officeRegion) {
        withRetry(
          () => api.get(`/settings/address/provinces/${record.officeRegion}`),
          { retries: 2 },
        )
          .then(({ data }) => {
            setHaulerProvinces(data || []);
            if (record.officeProvince) {
              withRetry(
                () =>
                  api.get(
                    `/settings/address/municipalities/${record.officeProvince}`,
                  ),
                { retries: 2 },
              )
                .then(({ data: d2 }) => {
                  setHaulerCities(d2 || []);
                  if (record.officeCity) {
                    withRetry(
                      () =>
                        api.get(
                          `/settings/address/barangays/${record.officeCity}`,
                        ),
                      { retries: 2 },
                    )
                      .then(({ data: d3 }) => setHaulerBarangayList(d3 || []))
                      .catch(() => {});
                  }
                })
                .catch(() => {});
            }
          })
          .catch(() => {});
      }
    } else {
      setEditingHaulerKey(null);
      setHaulerDraft({ ...EMPTY_HAULER });
    }
    setHaulerErrors({});
    setHaulerModalOpen(true);
  };

  const handleSaveHauler = () => {
    if (!validateHauler()) return;
    // Build a human-readable officeAddress from selected codes
    const regionName =
      regions.find((r) => r.code === haulerDraft.officeRegion)?.name ||
      haulerDraft.officeRegion ||
      "";
    const provinceName =
      haulerProvinces.find((p) => p.code === haulerDraft.officeProvince)
        ?.name ||
      haulerDraft.officeProvince ||
      "";
    const cityName =
      haulerCities.find((c) => c.code === haulerDraft.officeCity)?.name ||
      haulerDraft.officeCity ||
      "";
    const barangayName =
      haulerBarangayList.find((b) => b.code === haulerDraft.officeBarangay)
        ?.name ||
      haulerDraft.officeBarangay ||
      "";
    const addressParts = [
      barangayName,
      cityName,
      provinceName,
      regionName,
    ].filter(Boolean);
    // Empty means "this edit did not supply an address", never "clear it" — the
    // same rule the company address already uses. Only `officeAddress` is stored
    // on a baseline hauler (the office* PSGC codes are not persisted), so on a
    // re-edit the cascading selects come back empty and the composed string
    // collapses to "" — which used to wipe the saved hauler address.
    const resolvedAddress = addressParts.join(", ") || haulerDraft.officeAddress || "";
    const finalDraft = normalizeHaulerRecord(
      { ...haulerDraft, officeAddress: resolvedAddress },
      0,
      baselineUnit || slfUnit,
    );
    // Drop the blank rows openHaulerModal pads out to `numberOfTrucks`. Persisting
    // them created phantom vehicles with no capacity, which then permanently
    // blocked submission via haulerVehiclesMissingCapacity. Same predicate
    // cleanHaulerForSubmit already uses.
    finalDraft.vehicles = (finalDraft.vehicles || []).filter(
      (v) =>
        v.plateNumber?.trim() ||
        v.vehicleType?.trim() ||
        v.capacity != null ||
        (v.selectedClients || []).length > 0,
    );
    if (editingHaulerKey) {
      setHaulers((prev) =>
        mergeHaulersByName(
          prev.map((h) =>
            h.key === editingHaulerKey ? { ...h, ...finalDraft } : h,
          ),
          baselineUnit || slfUnit,
        ),
      );
    } else {
      setHaulers((prev) =>
        mergeHaulersByName(
          [...prev, { key: Date.now(), ...finalDraft }],
          baselineUnit || slfUnit,
        ),
      );
    }
    setHaulerModalOpen(false);
    setEditingHaulerKey(null);
    setHaulerDraft({ ...EMPTY_HAULER });
    setHaulerErrors({});
  };

  const removeHauler = (key) => {
    setHaulers((prev) => prev.filter((h) => h.key !== key));
  };

  // ── Truck modal helpers ──

  const openTruckModal = (record) => {
    if (record) {
      setEditingTruckKey(record.key);
      // Migrate older entry-level waste fields into the first vehicle so the
      // per-vehicle editor shows existing data when editing legacy entries.
      const migrateVehicle = (v, i, isFirst) => ({
        ...EMPTY_VEHICLE,
        ...v,
        key: Date.now() + i,
        actualVolume:
          v.actualVolume != null
            ? v.actualVolume
            : isFirst
              ? record.actualVolume ?? null
              : null,
        actualVolumeUnit:
          v.actualVolumeUnit ||
          (isFirst ? record.actualVolumeUnit : null) ||
          baselineUnit ||
          "m³",
        wasteType: v.wasteType || (isFirst ? record.wasteType : undefined),
        hazWasteCode:
          (v.hazWasteCode && v.hazWasteCode.length
            ? v.hazWasteCode
            : isFirst
              ? record.hazWasteCode
              : []) || [],
        // The CELL is inherited by EVERY vehicle, not only the first — unlike the
        // volume and waste type above, which are genuinely per-vehicle and would
        // be double-counted if copied across. A cell is a placement of the whole
        // entry: all of its vehicles went to it. Restricting this to the first
        // vehicle is what left vehicles 2..n of an already-placed entry showing
        // no cell and demanding one.
        cellName: v.cellName || record.cellName || "",
        cellType: v.cellType || record.cellType || "",
        cellIndex:
          typeof v.cellIndex === "number"
            ? v.cellIndex
            : typeof record.cellIndex === "number"
              ? record.cellIndex
              : null,
      });
      const draft = {
        disposalTicketNo: record.disposalTicketNo || "",
        hauler: record.hauler || "",
        plateNumber: record.plateNumber || "",
        truckCapacity: record.truckCapacity,
        truckCapacityUnit: record.truckCapacityUnit || baselineUnit || slfUnit,
        vehicles:
          record.vehicles?.length > 0
            ? record.vehicles.map((v, i) => migrateVehicle(v, i, i === 0))
            : record.plateNumber
              ? [
                  migrateVehicle(
                    {
                      plateNumber: record.plateNumber,
                      capacity: record.truckCapacity,
                      capacityUnit:
                        record.truckCapacityUnit || baselineUnit || slfUnit,
                    },
                    0,
                    true,
                  ),
                ]
              : [
                  {
                    ...EMPTY_VEHICLE,
                    key: Date.now(),
                    capacityUnit: baselineUnit || slfUnit,
                  },
                ],
        actualVolume: record.actualVolume,
        actualVolumeUnit: record.actualVolumeUnit || baselineUnit || slfUnit,
        wasteType: record.wasteType,
        hazWasteCode: record.hazWasteCode,
        cellName: record.cellName || "",
        cellType: record.cellType || "",
        cellIndex:
          typeof record.cellIndex === "number" ? record.cellIndex : null,
      };
      // Populate additional transport fields from record
      extraTransportFields.forEach((f) => {
        draft[f.fieldKey] =
          record[f.fieldKey] ?? (f.fieldType === "number" ? null : "");
      });
      setTruckDraft(draft);
    } else {
      setEditingTruckKey(null);
      const draft = {
        ...EMPTY_TRUCK,
        truckCapacityUnit: baselineUnit || slfUnit,
        actualVolumeUnit: baselineUnit || slfUnit,
        vehicles: [
          {
            ...EMPTY_VEHICLE,
            key: Date.now(),
            capacityUnit: baselineUnit || slfUnit,
          },
        ],
      };
      // Initialize additional transport fields with defaults
      extraTransportFields.forEach((f) => {
        draft[f.fieldKey] = f.fieldType === "number" ? null : "";
      });
      setTruckDraft(draft);
    }
    setTruckErrors({});
    setTruckModalOpen(true);
  };

  return {
    assignSelectedTrucksToCell, editingHaulerKey, editingTruckKey, handleSaveHauler, haulerErrors,
    haulerModalFocus, haulerModalOpen, openHaulerModal, openTruckModal, removeHauler, removeTruck,
    selectedTruckKeys, setEditingHaulerKey, setEditingTruckKey, setHaulerErrors, setHaulerModalOpen,
    setSelectedTruckKeys, setTruckBulkCell, setTruckDraft, setTruckErrors, setTruckModalOpen,
    setTruckPage, setTruckPageSize, truckBulkCell, truckDraft, truckErrors, truckModalOpen,
    truckPage, truckPageSize, updateHaulerDraft, updateTruckDraft, updateVehicle, validateTruck,
  };
}
