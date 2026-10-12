import * as XLSX from "xlsx";

/**
 * Export an array of objects to an Excel file.
 * @param {Array<Object>} data - rows of data
 * @param {string} fileName - output file name (without extension)
 * @param {string} [sheetName="Sheet1"]
 * @param {object} [options]
 * @param {boolean} [options.autoWidth=false] size each column to its longest value (capped)
 * @param {boolean} [options.freezeHeader=false] keep the header row visible while scrolling
 */
export function exportToExcel(data, fileName, sheetName = "Sheet1", options = {}) {
  const ws = XLSX.utils.json_to_sheet(data);
  if (options.autoWidth && data.length) {
    const headers = Object.keys(data[0]);
    ws["!cols"] = headers.map((header) => {
      const longest = data.reduce(
        (max, row) => Math.max(max, String(row[header] ?? "").length),
        header.length,
      );
      return { wch: Math.min(Math.max(longest + 2, 8), 60) };
    });
  }
  if (options.freezeHeader) {
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    ws["!views"] = [{ state: "frozen", ySplit: 1 }];
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}
