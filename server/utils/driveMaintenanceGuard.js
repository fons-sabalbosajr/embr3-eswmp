/**
 * Drive Maintenance Guard
 *
 * When driveMaintenanceMode is enabled in AppSettings, all Drive-based file
 * upload endpoints return 503 immediately. This prevents any attempt to write
 * files to Google Drive while the account/credentials are unavailable.
 *
 * The setting is cached for 30 seconds so every upload request does not hit
 * MongoDB.
 */

let _cache = { mode: false, message: "", ts: 0 };
const CACHE_TTL = 30 * 1000; // 30 seconds

/**
 * Invalidate the maintenance cache — call this after saving drive config.
 */
function invalidateDriveMaintenanceCache() {
  _cache = { mode: false, message: "", ts: 0 };
}

/**
 * Returns the current drive maintenance state (reads from DB with cache).
 * @returns {{ mode: boolean, message: string }}
 */
async function getDriveMaintenanceState() {
  const now = Date.now();
  if (now - _cache.ts < CACHE_TTL) {
    return { mode: _cache.mode, message: _cache.message };
  }
  try {
    const AppSettings = require("../models/AppSettings");
    const settings = await AppSettings.findOne()
      .select("driveMaintenanceMode driveMaintenanceMessage")
      .lean();
    _cache = {
      mode: !!settings?.driveMaintenanceMode,
      message:
        settings?.driveMaintenanceMessage ||
        "Google Drive is temporarily unavailable. File uploads are disabled.",
      ts: now,
    };
  } catch {
    // DB unavailable — don't block on error, leave cache as-is
    _cache.ts = now;
  }
  return { mode: _cache.mode, message: _cache.message };
}

/**
 * Express middleware — blocks the request with 503 when Drive maintenance is ON.
 * Attach to any upload route that writes to Google Drive.
 *
 * Usage:
 *   router.post("/", requireDriveActive, uploadSingle(...), async (req, res) => { ... });
 */
async function requireDriveActive(req, res, next) {
  try {
    const { mode, message } = await getDriveMaintenanceState();
    if (mode) {
      return res.status(503).json({
        message,
        driveMaintenanceMode: true,
      });
    }
    next();
  } catch {
    // Guard error should not block uploads — pass through
    next();
  }
}

module.exports = { requireDriveActive, getDriveMaintenanceState, invalidateDriveMaintenanceCache };
