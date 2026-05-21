export const normalizeFilterValue = (value) => {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().trim().toLowerCase();
  if (Array.isArray(value)) {
    return value.map(normalizeFilterValue).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value).map(normalizeFilterValue).filter(Boolean).join(" ");
  }
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
};

const getRecordValue = (record, keyOrGetter) => {
  if (typeof keyOrGetter === "function") return keyOrGetter(record);
  return record?.[keyOrGetter];
};

export const matchesFilter = (recordValue, filterValue) => {
  const expected = normalizeFilterValue(filterValue);
  if (!expected) return true;
  if (Array.isArray(recordValue)) {
    return recordValue.some((item) => normalizeFilterValue(item) === expected);
  }
  return normalizeFilterValue(recordValue) === expected;
};

export const buildFilters = (records = [], keyOrGetter) => {
  const options = new Map();

  records.forEach((record) => {
    const rawValue = getRecordValue(record, keyOrGetter);
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    values.forEach((value) => {
      const text = String(value ?? "").trim().replace(/\s+/g, " ");
      const normalized = normalizeFilterValue(text);
      if (!normalized || options.has(normalized)) return;
      options.set(normalized, text);
    });
  });

  return [...options.values()]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map((text) => ({ text, label: text, value: text }));
};

export const rowMatchesSearch = (record, query, fields) => {
  const needle = normalizeFilterValue(query);
  if (!needle) return true;

  const values = fields?.length
    ? fields.map((field) => getRecordValue(record, field))
    : Object.values(record || {});

  return values.some((value) => normalizeFilterValue(value).includes(needle));
};

export const searchableSelectProps = {
  showSearch: true,
  optionFilterProp: "label",
  filterOption: (input, option) =>
    normalizeFilterValue(option?.label ?? option?.children ?? option?.value).includes(
      normalizeFilterValue(input),
    ),
};
