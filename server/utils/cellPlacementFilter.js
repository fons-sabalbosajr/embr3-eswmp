// Aggregation stages that split submissions into "assigned" (every placement of
// waste has a valid cell) and "unassigned" for the admin Cell Waste Placement
// tab — using EXACTLY the rule the SLF Portal uses to count unplaced waste
// (routes/portalAuth.js → summarizeCellAssignment / isValidCellRef):
//
//   • a placement is each VEHICLE that carries volume, or the truck itself when
//     none of its vehicles does;
//   • only waste that EXISTS needs a cell — a zero-volume placement is ignored;
//   • a placement is placed only with a valid cell IDENTIFIER: an integer index
//     within the facility's cells, not pointing at a deleted ("Not Existed") cell.
//     A name with no index is NOT placed.
//
// The tab used to call a truck placed when it had any cellName/cellIndex, on the
// truck or on ANY one of its vehicles, and counted zero-volume rows. So it showed
// as done what the operator's portal still listed as needing a cell (name-only
// placements, partly-placed trucks, deleted cells), and listed empty rows the
// portal never asks anyone to place.

const NOT_EXISTED = /not\s*exist/i;

/** Is `ciExpr` a valid cell reference for the facility loaded into $_cellCount / $_cellStatuses? */
function validCellRefExpr(ciExpr) {
  return {
    $let: {
      vars: { ci: { $convert: { input: ciExpr, to: "int", onError: null, onNull: null } } },
      in: {
        $and: [
          { $ne: ["$$ci", null] },
          { $gte: ["$$ci", 0] },
          { $or: [{ $eq: ["$_cellCount", 0] }, { $lt: ["$$ci", "$_cellCount"] }] },
          {
            $not: [
              {
                $regexMatch: {
                  input: {
                    $toString: {
                      $ifNull: [
                        { $cond: [{ $gte: ["$$ci", 0] }, { $arrayElemAt: ["$_cellStatuses", "$$ci"] }, null] },
                        "",
                      ],
                    },
                  },
                  regex: NOT_EXISTED,
                },
              },
            ],
          },
        ],
      },
    },
  };
}

const positive = (expr) => ({ $gt: [{ $convert: { input: expr, to: "double", onError: 0, onNull: 0 } }, 0] });

/**
 * Stages to run after the list's own $match/$sort. Leaves `_unplaced` (count of
 * placements still needing a cell) and `_tcount` on each document, then keeps
 * only the requested side.
 *
 * @param {"assigned"|"unassigned"} assignment
 * @param {string} facilityCollection  SlfFacility's collection name
 */
function cellAssignmentStages(assignment, facilityCollection = "slf_facilities") {
  return [
    {
      $lookup: {
        from: facilityCollection,
        localField: "slfGenerator",
        foreignField: "_id",
        as: "_fac",
        pipeline: [{ $project: { cellNames: 1, cellStatuses: 1 } }],
      },
    },
    {
      $project: {
        _tcount: { $size: { $ifNull: ["$trucks", []] } },
        _trucksArr: {
          $map: {
            input: { $ifNull: ["$trucks", []] },
            as: "t",
            in: {
              actualVolume: "$$t.actualVolume",
              cellIndex: "$$t.cellIndex",
              vehicles: {
                $map: {
                  input: { $ifNull: ["$$t.vehicles", []] },
                  as: "v",
                  in: { actualVolume: "$$v.actualVolume", cellIndex: "$$v.cellIndex" },
                },
              },
            },
          },
        },
        _cellStatuses: { $ifNull: [{ $arrayElemAt: ["$_fac.cellStatuses", 0] }, []] },
        _cellCount: {
          $max: [
            { $size: { $ifNull: [{ $arrayElemAt: ["$_fac.cellNames", 0] }, []] } },
            { $size: { $ifNull: [{ $arrayElemAt: ["$_fac.cellStatuses", 0] }, []] } },
          ],
        },
      },
    },
    {
      $addFields: {
        _unplaced: {
          $sum: {
            $map: {
              input: "$_trucksArr",
              as: "t",
              in: {
                $let: {
                  vars: {
                    loaded: { $filter: { input: "$$t.vehicles", as: "v", cond: positive("$$v.actualVolume") } },
                  },
                  in: {
                    $cond: [
                      { $gt: [{ $size: "$$loaded" }, 0] },
                      {
                        $size: {
                          $filter: {
                            input: "$$loaded",
                            as: "v",
                            cond: { $not: [validCellRefExpr("$$v.cellIndex")] },
                          },
                        },
                      },
                      {
                        $cond: [
                          { $and: [positive("$$t.actualVolume"), { $not: [validCellRefExpr("$$t.cellIndex")] }] },
                          1,
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      $match:
        assignment === "assigned"
          ? { _tcount: { $gt: 0 }, _unplaced: 0 }
          : { _unplaced: { $gt: 0 } },
    },
  ];
}

module.exports = { cellAssignmentStages, validCellRefExpr };
