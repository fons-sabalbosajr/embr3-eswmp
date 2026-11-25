// The SLF Portal container's full source as one string, for the server tests
// that pin portal-side behaviour by reading the front-end code.
//
// SLFPortal/index.jsx is now a thin container over hooks/ and extracted
// components, so a rule these tests check may live in one of those files. This
// re-uses the front-end helper, which splices every extracted module back in at
// the line that uses it — the text keeps the order it had before the split.
const { portalSource } = require("../../../front-end/src/pages/SLFPortal/__tests__/portalSource.js");

module.exports = { portalJsxSource: portalSource };
