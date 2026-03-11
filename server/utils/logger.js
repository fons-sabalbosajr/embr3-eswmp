const AppLog = require("../models/AppLog");

/**
 * Write a log entry to the database.
 * @param {"info"|"warn"|"error"} level
 * @param {string} action  - e.g. "auth.login", "submission.create"
 * @param {object} opts    - { message, user, ip, meta }
 */
async function writeLog(level, action, opts = {}) {
  try {
    await AppLog.create({
      level,
      action,
      message: opts.message || "",
      user: opts.user || "",
      ip: opts.ip || "",
      meta: opts.meta,
    });
  } catch {
    // never let logging crash the app
  }
}

module.exports = { writeLog };
