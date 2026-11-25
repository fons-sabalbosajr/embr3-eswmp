import { useCallback, useMemo } from "react";
import api from "../../../api";
import { summarizeBaselineCompleteness } from "../baselineCompleteness";
import { summarizeAlignment, alignDisposalRow } from "../systemGeneratedUpload";
import { DISPOSAL_VERA_ASSESSMENT_PROMPT, buildDisposalVeraContext } from "../disposalVeraContext";
import { HAULER_VERA_ASSESSMENT_PROMPT, buildHaulerVeraContext } from "../haulerVeraContext";
import Swal from "sweetalert2";
import { uploadRowToSlfUnit } from "../enteredVolume";
import {
  parseUploadNumber,
  cleanUploadText,
  isEmptyUploadValue,
  getUploadRowErrors,
  getUploadRelationshipErrors,
  findUploadHauler,
  findUploadClientsForHauler,
  UPLOAD_COLUMNS,
} from "../uploadHelpers";
import { distinctDays } from "../backlogUpload";
import dayjs from "dayjs";
import { mergeHaulersByName, cleanClientForSubmit } from "../haulerNormalization";
import * as XLSX from "xlsx";

export default function useUploadReview({
  activeCellOptions, baselineUnit, entryForm, haulers, haulerVeraCycleRef, resolveUploadCellValue,
  setHaulers, setHaulerVeraComment, setHaulerVeraError, setHaulerVeraSource, setHaulerVeraStage,
  setTrucks, setUploadDetection, setUploadMissingColumns, setUploadModalOpen, setUploadPreviewData,
  slfUnit, uploadDetection, uploadMissingColumns, uploadPreviewData, uploadPreviewRows,
  uploadPreviewSummary, uploadType,
}) {
  // ── VERA assessment of an upload preview ──────────────────────────────────
  //
  // Same discipline as Bulk Organize Cells: VERA is a SECOND OPINION, never a
  // gate. It is invoked deliberately (never from an effect, which would re-fire
  // on every re-render), and a failure to reach it leaves the import exactly as
  // available as it was.
  //
  // The stage is separate from the validation outcome for the same reason: "the
  // preview is valid but VERA could not answer" has to be a state the UI can say
  // out loud, rather than one that reads as a validation problem.
  //
  // WHEN IT RUNS differs by upload kind, and deliberately so:
  //   · hauler   — only on a CLEAN preview. There is nothing useful to say about
  //                rows that have not passed validation yet; VERA is pointed at
  //                what such an import gets wrong QUIETLY.
  //   · disposal — on a failing preview too. A machine-exported disposal file
  //                fails every row with the same unhelpful message, and the
  //                alignment pass already knows which baseline records are
  //                missing. Explaining that IS the help.
  const runUploadVeraAssessment = useCallback(
    async ({ message, pageContext }) => {
      const cycle = haulerVeraCycleRef.current;
      setHaulerVeraStage("assessing");
      setHaulerVeraComment("");
      setHaulerVeraError(null);
      try {
        const { data } = await api.post("/vera/chat", {
          message,
          history: [],
          page: "data-entry",
          pageContext,
        });
        // A newer file was uploaded (or the preview was closed) while this was in
        // flight — its answer describes rows that are no longer on screen.
        if (haulerVeraCycleRef.current !== cycle) return;
        if (data?.ok && data.answer) {
          setHaulerVeraComment(String(data.answer));
          setHaulerVeraSource(data.source || null);
          setHaulerVeraStage("done");
        } else {
          // The server explains WHY (disabled / rate limited / duplicate). Show
          // its reason rather than inventing one, and never a placeholder.
          setHaulerVeraError(
            data?.message || "VERA could not assess this upload right now.",
          );
          setHaulerVeraStage("failed");
        }
      } catch (err) {
        if (haulerVeraCycleRef.current !== cycle) return;
        setHaulerVeraError(
          err.response?.data?.message ||
            "VERA could not be reached. Your previewed data is unaffected.",
        );
        setHaulerVeraStage("failed");
      }
    },
    [],
  );

  // What the loaded baseline is missing — recomputed whenever the haulers change,
  // so completing a record in the Baseline tab clears it from the warning without
  // a reload. Feeds the incomplete-records panel and the hauler table's per-row
  // indicator, which is why it is derived once here rather than in either of them.
  const baselineGaps = useMemo(
    () => summarizeBaselineCompleteness(haulers),
    [haulers],
  );

  // What the previewed disposal rows resolved to, re-derived on every render from
  // the rows themselves — so it stays true after an inline edit or a deletion.
  const uploadAlignmentSummary = useMemo(
    () => (uploadType === "truck" ? summarizeAlignment(uploadPreviewRows) : null),
    [uploadPreviewRows, uploadType],
  );

  // Re-assess the rows as they stand NOW — after inline preview edits or a row
  // deletion — which is also what the Retry path uses.
  const reassessHaulerUpload = useCallback(() => {
    haulerVeraCycleRef.current += 1;
    runUploadVeraAssessment(
      uploadType === "truck"
        ? {
            message: DISPOSAL_VERA_ASSESSMENT_PROMPT,
            pageContext: buildDisposalVeraContext(
              uploadPreviewRows,
              uploadAlignmentSummary,
              uploadDetection,
            ),
          }
        : {
            message: HAULER_VERA_ASSESSMENT_PROMPT,
            pageContext: buildHaulerVeraContext(
              uploadPreviewRows,
              uploadPreviewSummary,
              haulers,
            ),
          },
    );
  }, [
    runUploadVeraAssessment,
    uploadType,
    uploadPreviewRows,
    uploadPreviewSummary,
    uploadAlignmentSummary,
    uploadDetection,
    haulers,
  ]);

  const handleConfirmUpload = () => {
    if (uploadPreviewRows.length === 0) return;
    const invalidRows = uploadPreviewRows.filter((row) => row._errors?.length);
    if (uploadMissingColumns.length > 0 || invalidRows.length > 0) {
      Swal.fire({
        icon: "warning",
        title: "Preview Has Missing Data",
        text: "Please fix the missing columns or row values shown in the preview before importing.",
        confirmButtonColor: "#1a3353",
      });
      return;
    }
    let backlogImportDays = 0;
    if (uploadType === "truck") {
      // Rows weighed in the other unit are converted into the SLF's unit here,
      // keeping the original (see enteredVolume.js and the "Saved as" column).
      const importUnit = baselineUnit || slfUnit;
      const newTrucks = uploadPreviewData.map((raw) => uploadRowToSlfUnit(raw, importUnit)).map((d) => ({
        key: d.key,
        // Marks the row as upload-sourced so validation REQUIRES a Truck Capacity
        // for it (manually-entered rows keep capacity optional). Transient — the
        // DataSLF schema has no such field, so it is dropped on save.
        entrySource: "upload",
        disposalDate: d.disposalDate || "",
        disposalTicketNo: d.disposalTicketNo || "",
        hauler: d.hauler || "",
        plateNumber: d.plateNumber || "",
        truckCapacity: parseUploadNumber(d.truckCapacity),
        truckCapacityUnit: d.actualVolumeUnit || baselineUnit || slfUnit,
        vehicles: d.plateNumber
          ? [
              {
                plateNumber: d.plateNumber,
                capacity: parseUploadNumber(d.truckCapacity),
                capacityUnit: d.actualVolumeUnit || baselineUnit || slfUnit,
                actualVolume: parseUploadNumber(d.actualVolume),
                actualVolumeUnit: d.actualVolumeUnit || baselineUnit || slfUnit,
                // Set only when the row was weighed in the other unit.
                ...(d.enteredVolumeUnit
                  ? { enteredVolume: d.enteredVolume, enteredVolumeUnit: d.enteredVolumeUnit }
                  : {}),
                wasteType: d.wasteType || "Residual",
                hazWasteCode: d.hazWasteCode || [],
                cellIndex: d.cellIndex,
                cellName: d.cellName || "",
                cellType: d.cellType || "",
                selectedClients: d._matchedClients || [],
              },
            ]
          : [],
        actualVolume: parseUploadNumber(d.actualVolume),
        actualVolumeUnit: d.actualVolumeUnit || baselineUnit || slfUnit,
        wasteType: d.wasteType || "Residual",
        cellIndex: d.cellIndex,
        cellName: d.cellName || "",
        cellType: d.cellType || "",
        hazWasteCode: d.hazWasteCode || [],
        selectedClients: d._matchedClients || [],
      }));
      const uploadDates = distinctDays(newTrucks);
      // One date → it is the entry's Date of Disposal. Several (a backlog) →
      // each truck keeps its own date and is submitted under it; the form date
      // only covers trucks added by hand, so it defaults to the latest day.
      if (uploadDates.length >= 1 && !entryForm.getFieldValue("dateOfDisposal")) {
        entryForm.setFieldsValue({ dateOfDisposal: dayjs(uploadDates[uploadDates.length - 1]) });
      }
      setTrucks((prev) => [...prev, ...newTrucks]);
      backlogImportDays = uploadDates.length;
    } else {
      // Client Type is required. A blank cell still means "keep what is stored"
      // for a client already on the hauler, but a NEW client must say LGU or
      // Private: there is nothing stored to keep.
      const storedClients = new Map(
        (haulers || []).map((h) => [
          cleanUploadText(h.haulerName).toLowerCase(),
          new Set((h.privateSectorClients || []).map((c) => cleanUploadText(typeof c === "string" ? c : c?.clientName).toLowerCase())),
        ]),
      );
      const typelessNew = [];
      uploadPreviewRows.forEach((d) => {
        const known = storedClients.get(cleanUploadText(d.haulerName).toLowerCase()) || new Set();
        (d.privateSectorClients || []).forEach((client) => {
          const name = cleanUploadText(typeof client === "string" ? client : client?.clientName);
          const type = typeof client === "string" ? d.clientType : client?.clientType || d.clientType;
          if (name && !cleanUploadText(type) && !known.has(name.toLowerCase())) {
            typelessNew.push(`${name} (${d.haulerName}, row ${d._rowNumber ?? "?"})`);
          }
        });
      });
      if (typelessNew.length) {
        Swal.fire({
          icon: "warning",
          title: "Client Type required",
          html: `Fill the <b>Client Type</b> column (LGU or Private) for these new client(s), then upload the file again:<br/><br/>${typelessNew.slice(0, 12).map((t) => `• ${t}`).join("<br/>")}${typelessNew.length > 12 ? `<br/>… and ${typelessNew.length - 12} more` : ""}`,
        });
        return;
      }
      const newHaulers = uploadPreviewRows.map((d) => ({
        key: d.key,
        haulerName: d.haulerName || "",
        numberOfTrucks: parseUploadNumber(d.numberOfTrucks),
        officeAddress: d.officeAddress || "",
        vehicles: d.plateNumber || d.vehicleType || !isEmptyUploadValue(d.capacity)
          ? [
              {
                plateNumber: d.plateNumber || "",
                vehicleType: d.vehicleType || "",
                capacity: parseUploadNumber(d.capacity),
                capacityUnit: d.capacityUnit || baselineUnit || slfUnit,
              },
            ]
          : [],
        // Location is stored as the *Name fields, never as PSGC codes: the
        // Region 3 classification and the server's "incomplete client" check
        // both read regionName / provinceName / municipalityName, so a province
        // spelled out in a spreadsheet ends up exactly as usable as one picked
        // in the Add Client form.
        privateSectorClients: (d.privateSectorClients || []).map((client, index) =>
          typeof client === "string"
            ? {
                key: `${d.key}-client-${index}`,
                clientName: client,
                // Blank stays blank: the merge then keeps the stored type of an
                // existing client instead of overwriting it with "Private".
                clientType: d.clientType || "",
                clientAddress: d.clientAddress || "",
                regionName: d.clientRegion || "",
                provinceName: d.clientProvince || "",
                municipalityName: d.clientMunicipality || "",
              }
            : {
                ...client,
                clientType: client.clientType || d.clientType || "",
                clientAddress: client.clientAddress || d.clientAddress || "",
                regionName: client.regionName || d.clientRegion || "",
                provinceName: client.provinceName || d.clientProvince || "",
                municipalityName: client.municipalityName || d.clientMunicipality || "",
              },
        ),
      }));
      setHaulers((prev) =>
        mergeHaulersByName([...prev, ...newHaulers], baselineUnit || slfUnit),
      );
    }
    const importedSummary = uploadPreviewSummary;
    setUploadModalOpen(false);
    setUploadPreviewData([]);
    setUploadMissingColumns([]);
    setUploadDetection(null);
    if (backlogImportDays > 1) {
      Swal.fire({
        icon: "success",
        title: "Backlog Imported",
        html:
          `${importedSummary.total} records across <b>${backlogImportDays} disposal dates</b> were imported.` +
          "<br/><br/>When you submit, <b>each date becomes its own submission</b> with its own ID No., " +
          "exactly as if it had been entered day by day.",
        confirmButtonColor: "#1a3353",
      });
      return;
    }
    Swal.fire({
      icon: "success",
      title: "Data Imported",
      text:
        uploadType === "hauler"
          ? `${importedSummary.newHaulers} hauler(s) added, ${importedSummary.updatedHaulers} updated. Click "Save Baseline Update" to persist the changes.`
          : `${importedSummary.total} records imported successfully.`,
      timer: uploadType === "hauler" ? 3200 : 1500,
      showConfirmButton: false,
    });
  };

  // Update preview data cell
  /**
   * Re-run alignment and validation over one previewed row.
   *
   * The SAME sequence the initial parse applies (align → validate), extracted so
   * an edited row is judged by exactly the rules the file was. Before this, an
   * inline edit re-ran the relationship check but not the alignment pass, so
   * correcting a client by hand left the row's `_alignment` describing the value
   * it no longer held — and a row fixed through a mismatch suggestion could never
   * clear, because nothing re-resolved it.
   *
   * `fleet` is passed in rather than read from state so a caller that is fixing
   * the baseline and the rows in one go can validate against the NEW fleet
   * instead of the one React has not re-rendered with yet.
   */
  const revalidateUploadRow = useCallback(
    (row, fleet = haulers) => {
      if (uploadType !== "truck") {
        return {
          ...row,
          _errors: [...getUploadRowErrors(row, uploadType || "truck")],
        };
      }
      const aligned = alignDisposalRow(row, fleet);
      const alignmentErrors = aligned._alignmentErrors || [];
      const relationshipErrors =
        alignmentErrors.length === 0 ? getUploadRelationshipErrors(aligned, fleet) : [];
      const matchedHauler =
        alignmentErrors.length === 0 && relationshipErrors.length === 0
          ? findUploadHauler(fleet, aligned.hauler)
          : null;
      // One trip can serve SEVERAL clients written into one cell
      // ("A, B, C"). findUploadClientsForHauler tries the cell whole first and
      // only then as a list, so a client name containing a comma still resolves.
      const matchedClients = matchedHauler
        ? findUploadClientsForHauler(matchedHauler, aligned.client).clients
        : [];
      const cellKnown =
        !aligned.cellName || aligned.cellIndex != null || activeCellOptions.length === 0;
      return {
        ...aligned,
        _matchedClients: matchedClients.length ? matchedClients : undefined,
        _relationshipErrors: relationshipErrors,
        _errors: [
          ...getUploadRowErrors(aligned, "truck"),
          ...alignmentErrors,
          ...relationshipErrors,
          ...(cellKnown
            ? []
            : [`Row ${aligned._rowNumber} — Cell or Disposal Area "${aligned.cellName}" is not an available cell under this SLF.`]),
        ],
      };
    },
    [uploadType, haulers, activeCellOptions],
  );

  const updateUploadCell = (key, field, value) => {
    setUploadPreviewData((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        // Re-split clients string back to array so downstream merge works correctly
        const coercedValue =
          field === "privateSectorClients" && typeof value === "string"
            ? value.split(",").map((s) => s.trim()).filter(Boolean)
            : value;
        // Editing the CELL must re-resolve its identifier, not just its label.
        // The import writes `cellIndex` (the canonical reference); leaving the
        // originally-parsed index in place meant an edited cell silently
        // imported the waste into the cell that came from the FILE, not the one
        // the user picked in the preview.
        const cellPatch =
          field === "cellName" ? resolveUploadCellValue(coercedValue) : null;
        return revalidateUploadRow({ ...row, [field]: coercedValue, ...(cellPatch || {}) });
      }),
    );
  };

  // ── Resolving a client MISMATCH from the upload preview ────────────────────
  //
  // A mismatch is the baseline and the file disagreeing about how to spell the
  // same client — not a client the baseline is missing. There are two honest ways
  // to settle that, and which one is right is the operator's call, not ours:
  //
  //   · the BASELINE is right → rewrite the file's rows to the stored name. The
  //     baseline is untouched; only this import changes.
  //   · the FILE is right → correct the client on the hauler. That is a baseline
  //     edit, so it lands in the draft and needs Save Baseline Update, exactly
  //     like Add Client and the per-hauler client upload.
  //
  // Both apply to EVERY row carrying that pair, because one decision about one
  // client should not have to be repeated forty times.

  /** The file is wrong: point its rows at the client the baseline already has. */
  const useStoredClientForRows = useCallback(
    (entry, storedName) => {
      const affected = new Set(entry?.rowKeys || []);
      if (!affected.size || !storedName) return;
      setUploadPreviewData((prev) =>
        prev.map((row) =>
          affected.has(row.key) ? revalidateUploadRow({ ...row, client: storedName }) : row,
        ),
      );
    },
    [revalidateUploadRow],
  );

  // "Did you mean <hauler>?" accepted: the file's rows take the accredited
  // hauler's name. Only those rows, only in this file — the baseline is untouched.
  const useStoredHaulerForRows = useCallback(
    (entry, haulerName) => {
      const affected = new Set(entry?.rowKeys || []);
      if (!affected.size || !haulerName) return;
      setUploadPreviewData((prev) =>
        prev.map((row) =>
          affected.has(row.key) ? revalidateUploadRow({ ...row, hauler: haulerName }) : row,
        ),
      );
    },
    [revalidateUploadRow],
  );

  /**
   * The file is right: change the client ON THE HAULER.
   *
   * `storedName` renames that client in place; omitting it adds the file's value
   * as a new client instead. The rows are revalidated against the NEW fleet in
   * the same tick — passing it explicitly rather than relying on `haulers`, which
   * this render still sees as the old list.
   */
  const applyClientFixToHauler = useCallback(
    (entry, storedName = "") => {
      const haulerKey = cleanUploadText(entry?.hauler).toLowerCase();
      const target = cleanUploadText(entry?.client);
      if (!haulerKey || !target) return;
      const nextFleet = haulers.map((hauler) => {
        if (cleanUploadText(hauler.haulerName || hauler.name).toLowerCase() !== haulerKey) {
          return hauler;
        }
        const clients = Array.isArray(hauler.privateSectorClients)
          ? hauler.privateSectorClients.map((client) =>
              typeof client === "string" ? { clientName: client } : { ...client },
            )
          : [];
        if (storedName) {
          const index = clients.findIndex(
            (client) =>
              cleanUploadText(client.clientName).toLowerCase() ===
              cleanUploadText(storedName).toLowerCase(),
          );
          if (index >= 0) {
            // A RENAME keeps the record — and with it the client's type, province
            // and municipality, which is the whole reason renaming beats adding.
            clients[index] = { ...clients[index], clientName: target };
            return { ...hauler, privateSectorClients: clients };
          }
        }
        // Added WITHOUT a type, province or municipality: none of them is
        // guessable (copying another client's type misfiled municipal waste as
        // private, or the reverse). The completeness panel asks for them, and the
        // baseline save refuses the client until its Client Type is chosen.
        clients.push({
          key: `client-fix-${Date.now()}`,
          clientName: target,
          clientType: "",
        });
        return { ...hauler, privateSectorClients: clients };
      });
      setHaulers(nextFleet);
      setUploadPreviewData((prev) => prev.map((row) => revalidateUploadRow(row, nextFleet)));
    },
    [haulers, revalidateUploadRow],
  );

  /**
   * Build a sample-template workbook FROM the upload schema.
   *
   * Both templates are generated here, from the same UPLOAD_COLUMNS the parser
   * and the row validators read, so a downloaded template always carries exactly
   * the headers the uploader accepts and the Instructions sheet always states the
   * rules that are actually enforced.
   */
  const buildUploadTemplateWorkbook = ({ type, sheetName, sampleRows, instructions, listValidations = [] }) => {
    const headers = UPLOAD_COLUMNS[type].map((column) => column.label);
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
    worksheet["!cols"] = headers.map((header) => ({ wch: Math.max(18, header.length + 2) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ...instructions,
        [],
        ["Column", "Required", "Accepted format", "Sample", "Validation rule"],
        ...UPLOAD_COLUMNS[type].map((column) => [
          column.label,
          column.required ? "Required" : "Optional",
          column.format || "Text",
          column.sample || "",
          column.description || "",
        ]),
      ]),
      "Instructions",
    );
    if (worksheet["!ref"]) {
      worksheet["!dataValidation"] = listValidations
        .map(({ label, values }) => {
          const index = headers.indexOf(label);
          if (index < 0) return null;
          const col = XLSX.utils.encode_col(index);
          return { sqref: `${col}2:${col}200`, type: "list", formula1: `"${values}"` };
        })
        .filter(Boolean);
    }
    return workbook;
  };

  const downloadDisposalTemplate = () => {
    const workbook = buildUploadTemplateWorkbook({
      type: "truck",
      sheetName: "Disposal Entries",
      sampleRows: [UPLOAD_COLUMNS.truck.map((column) => column.sample || "")],
      listValidations: [
        { label: "Waste Type", values: "Residual,Hazardous Waste,Treated Hazardous Waste" },
        { label: "Unit of Measurement", values: "tons,m3,m³" },
      ],
      instructions: [
      ["Waste Generator Disposal Entry Upload Instructions"],
      ["Relationship rule", "Selected SLF -> Hauler -> Client. The Client column is required and must identify a client assigned to the specified hauler under the selected SLF."],
      ["No auto-create", "The upload does not create new clients. Add or correct clients in Baseline / Accredited Haulers first."],
      ["Dates", "Use YYYY-MM-DD, MM/DD/YYYY, or a real Excel date value. One file may cover up to one month of missed days (no future dates); each disposal date is submitted as its own submission with its own ID No."],
      ["Numbers", "Waste Volume and Truck Capacity must be positive numbers. Commas are accepted."],
      ["Units", "Use tons, m3, or m³ — the unit the load was weighed or measured in. A value in the other unit than the SLF's declared unit is converted (1 m³ = 0.5 tons) and the original value is kept."],
      ["Cells", "Use an available Cell or Disposal Area from the selected SLF. Example: Cell 1."],
      [],
      ["Common upload errors"],
      ["Missing Client column"],
      ["Empty Client value"],
      ["Client exists but belongs to another hauler or SLF"],
      ["Duplicate or inactive client record"],
      ["Unknown cell/disposal area"],
      ],
    });
    XLSX.writeFile(workbook, "Waste_Generator_Disposal_Entry_Template.xlsx");
  };

  const cleanTruckForSubmit = ({ key, vehicles, selectedClients, ...rest }) => {
    const cleanedVehicles = (vehicles || []).map(
      ({ key: vehicleKey, selectedClients: vehicleClients, ...vehicle }) => ({
        ...vehicle,
        selectedClients: (vehicleClients || []).map(cleanClientForSubmit),
      }),
    );
    const flattenedClients = cleanedVehicles.flatMap(
      (vehicle) => vehicle.selectedClients || [],
    );
    return {
      ...rest,
      selectedClients: (selectedClients || []).length
        ? selectedClients.map(cleanClientForSubmit)
        : flattenedClients,
      vehicles: cleanedVehicles,
    };
  };

  return {
    applyClientFixToHauler, baselineGaps, buildUploadTemplateWorkbook, cleanTruckForSubmit,
    downloadDisposalTemplate, handleConfirmUpload, reassessHaulerUpload, runUploadVeraAssessment,
    updateUploadCell, uploadAlignmentSummary, useStoredClientForRows, useStoredHaulerForRows,
  };
}
