import * as XLSX from "xlsx";

/**
 * Export an array of objects to an Excel file.
 * @param {Array<Object>} data - rows of data
 * @param {string} fileName - output file name (without extension)
 * @param {string} [sheetName="Sheet1"]
 */
export function exportToExcel(data, fileName, sheetName = "Sheet1") {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}
