// Dependency-free request-body validation.
//
// The project has no schema-validation library and Mongoose already handles
// type coercion + unknown-field stripping (schemas are `strict` by default),
// so this fills the two remaining gaps: enforcing required fields and returning
// a clear, structured 400 (which field, why) instead of letting a bad payload
// fall through to a Mongoose cast error and a leaky 500.
//
// Usage:
//   const { validateBody } = require("../utils/validate");
//   router.post("/", validateBody({
//     lgu:       { type: "string", required: true, maxLength: 200 },
//     latitude:  { type: "number", min: -90, max: 90 },
//     longitude: { type: "number", min: -180, max: 180 },
//     volumeCapacity: { type: "number", min: 0 },
//   }), handler);
//
// Rules per field: { type, required, min, max, minLength, maxLength, enum }.
// `type` is one of "string" | "number" | "boolean" | "array". Only fields
// present in the body are checked against their rules; unlisted fields are left
// untouched (Mongoose still strips ones not in the model schema).

function checkField(name, value, rule) {
  const isMissing = value === undefined || value === null || value === "";
  if (isMissing) {
    if (rule.required) return `${name} is required`;
    return null; // optional + absent → nothing to validate
  }

  if (rule.type === "number") {
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(num)) return `${name} must be a number`;
    if (rule.min !== undefined && num < rule.min) return `${name} must be ≥ ${rule.min}`;
    if (rule.max !== undefined && num > rule.max) return `${name} must be ≤ ${rule.max}`;
  } else if (rule.type === "boolean") {
    if (typeof value !== "boolean") return `${name} must be true or false`;
  } else if (rule.type === "array") {
    if (!Array.isArray(value)) return `${name} must be a list`;
    if (rule.minLength !== undefined && value.length < rule.minLength) return `${name} must have at least ${rule.minLength} item(s)`;
    if (rule.maxLength !== undefined && value.length > rule.maxLength) return `${name} must have at most ${rule.maxLength} item(s)`;
  } else if (rule.type === "string") {
    if (typeof value !== "string") return `${name} must be text`;
    const len = value.trim().length;
    if (rule.minLength !== undefined && len < rule.minLength) return `${name} must be at least ${rule.minLength} character(s)`;
    if (rule.maxLength !== undefined && len > rule.maxLength) return `${name} must be at most ${rule.maxLength} character(s)`;
  }

  if (rule.enum && !rule.enum.includes(value)) {
    return `${name} must be one of: ${rule.enum.join(", ")}`;
  }
  return null;
}

// Returns an array of { field, message }; empty when the body satisfies `schema`.
function validate(body, schema) {
  const src = body && typeof body === "object" ? body : {};
  const errors = [];
  for (const [name, rule] of Object.entries(schema)) {
    const message = checkField(name, src[name], rule);
    if (message) errors.push({ field: name, message });
  }
  return errors;
}

// Express middleware factory. On failure responds 400 with a structured body:
//   { message: "Validation failed", errors: [{ field, message }] }
function validateBody(schema) {
  return (req, res, next) => {
    const errors = validate(req.body, schema);
    if (errors.length) {
      return res.status(400).json({ message: "Validation failed", errors });
    }
    next();
  };
}

module.exports = { validate, validateBody };
