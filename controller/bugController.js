import { logActivity } from "../helpers/activityHelper.js";
import { getDB } from "../config/db.js";
import {
  getUsersWithTeamsBulk,
  getUserWithTeam,
} from "../services/keycloack.service.js";
import {
  getCurrentISTForMySQL,
  getProfileColorForUser,
  getShortName,
  getStatusNameById,
  getTextColorForUser,
  getUserNameById,
  getEmailByUserId,
} from "../helpers/commonHelper.js";

import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getS3Config } from "../config/config.js";

export const createTicket = async ({ name, game_id, status = 1, userId }) => {
  const db = getDB();

  // 1. Get game name
  const [gameRows] = await db.execute(
    `SELECT name FROM gameinfodetails  WHERE id = ? AND isgameactive = 1`,
    [game_id],
  );

  if (!gameRows.length) {
    throw new Error("Invalid game_id");
  }

  const game_name = gameRows[0].name;

  // 🔹 Get next iteration_id
  const sql = `
  SELECT MAX(CAST(iteration AS SIGNED)) as lastIteration
  FROM revert
  WHERE game_name = ?
`;

  const [rows] = await db.execute(sql, [game_name]);

  let nextIteration = 1;

  if (rows.length > 0 && rows[0].lastIteration !== null) {
    const lastIteration = parseInt(rows[0].lastIteration) || 0;
    nextIteration = lastIteration + 1;
  }
  // 2. Base prefix
  const basePrefix = game_name
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 3)
    .toUpperCase(); // TEE

  // 3. Check if this game already has a prefix
  const [existingGamePrefix] = await db.execute(
    `SELECT bug_id
     FROM bug_details
     WHERE game_id = ?
     LIMIT 1`,
    [game_id],
  );

  let finalPrefix;

  if (existingGamePrefix.length) {
    // Reuse same prefix for this game
    finalPrefix = existingGamePrefix[0].bug_id.split("-")[0];
  } else {
    // 4. New game → find how many games already used this base prefix
    const [usedPrefixes] = await db.execute(
      `SELECT DISTINCT SUBSTRING_INDEX(bug_id, '-', 1) AS prefix
       FROM bug_details
       WHERE bug_id LIKE ?`,
      [`${basePrefix}%`],
    );

    const nextIndex = usedPrefixes.length === 0 ? "" : usedPrefixes.length + 1;

    finalPrefix = `${basePrefix}${nextIndex}`;
  }

  // 5. Increment ticket number for this prefix
  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS count
     FROM bug_details
     WHERE bug_id LIKE ?`,
    [`${finalPrefix}-%`],
  );

  const runningNumber = String(countRows[0].count + 1).padStart(3, "0");

  const bugId = `${finalPrefix}-${runningNumber}`;
  const currentTime = getCurrentISTForMySQL();
  // 6. Insert ticket
  const [result] = await db.execute(
    `INSERT INTO bug_details
      (name, game_id, iteration_id, bug_id, status, created_by,created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, game_id, nextIteration, bugId, status, userId, currentTime],
  );
  // 7. Log activity
  await logActivity({
    bug_id: result.insertId,
    activity_type: "bug_created",
    activity_content: `created a task`,
    performed_by: userId,
    new_value: name,
  });
  const [existingRows] = await db.execute(
    `SELECT * FROM bug_details WHERE id = ? AND deleted_at IS NULL`,
    [result.insertId],
  );

  if (!existingRows.length) throw new Error("Ticket not found");

  const existing = existingRows[0];
  const existingReportedBy = existing.created_by
    ? await getUserNameById(existing.created_by)
    : null;
  return {
    id: result.insertId,
    bug_id: bugId,
    name,
    game_id,
    status,
    created_by: userId,
    iteration_id: existing.iteration_id,
    reported_by_dropdown: {
      id: existing.created_by,
      name: existingReportedBy,
      short_name: getShortName(existingReportedBy),
      color: getTextColorForUser(existingReportedBy),
      profile_color: getProfileColorForUser(existingReportedBy),
    },
  };
};

export const createBulkTickets = async ({ tickets, userId }) => {
  const db = getDB();

  if (!tickets.length) return [];
  
  const game_id = tickets[0].game_id;

  // Get game name
  const [gameRows] = await db.execute(
    `SELECT name
     FROM gameinfodetails
     WHERE id = ? AND isgameactive = 1`,
    [game_id]
  );

  if (!gameRows.length) {
    throw new Error("Invalid game_id");
  }

  const game_name = gameRows[0].name;

  // Next iteration
  const [[iterationRow]] = await db.execute(
    `
    SELECT MAX(CAST(iteration AS SIGNED)) AS lastIteration
    FROM revert
    WHERE game_name = ?
    `,
    [game_name]
  );

  let nextIteration = (iterationRow?.lastIteration || 0) + 1;

  // Base prefix
  const basePrefix = game_name
    .replace(/[^a-zA-Z]/g, "")
    .substring(0, 3)
    .toUpperCase();

  // Existing prefix
  const [existingPrefixRows] = await db.execute(
    `
    SELECT bug_id
    FROM bug_details
    WHERE game_id = ?
    LIMIT 1
    `,
    [game_id]
  );

  let finalPrefix;

  if (existingPrefixRows.length) {
    finalPrefix = existingPrefixRows[0].bug_id.split("-")[0];
  } else {
    const [usedPrefixes] = await db.execute(
      `
      SELECT DISTINCT SUBSTRING_INDEX(bug_id,'-',1) prefix
      FROM bug_details
      WHERE bug_id LIKE ?
      `,
      [`${basePrefix}%`]
    );

    const nextIndex =
      usedPrefixes.length === 0 ? "" : usedPrefixes.length + 1;

    finalPrefix = `${basePrefix}${nextIndex}`;
  }

  // Current running number
  const [[countRow]] = await db.execute(
    `
    SELECT COUNT(*) count
    FROM bug_details
    WHERE bug_id LIKE ?
    `,
    [`${finalPrefix}-%`]
  );

  let runningNumber = countRow.count + 1;

  const currentTime = getCurrentISTForMySQL();

  const createdTickets = [];

  for (const ticket of tickets) {
    const bugId = `${finalPrefix}-${String(runningNumber).padStart(3, "0")}`;

    const [result] = await db.execute(
      `
      INSERT INTO bug_details
      (
        name,
        game_id,
        iteration_id,
        bug_id,
        status,
        created_by,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ticket.name,
        game_id,
        nextIteration,
        bugId,
        ticket.status || 1,
        userId,
        currentTime,
      ]
    );

    await logActivity({
      bug_id: result.insertId,
      activity_type: "bug_created",
      activity_content: "created a task",
      performed_by: userId,
      new_value: ticket.name,
    });

    const reportedBy = await getUserNameById(userId);

    createdTickets.push({
      id: result.insertId,
      bug_id: bugId,
      name: ticket.name,
      game_id,
      iteration_id: nextIteration,
      status: ticket.status || 1,
      created_by: userId,
      reported_by_dropdown: {
        id: userId,
        name: reportedBy,
        short_name: getShortName(reportedBy),
        color: getTextColorForUser(reportedBy),
        profile_color: getProfileColorForUser(reportedBy),
      },
    });

    runningNumber++;
  }

  return createdTickets;
};

export const getAllTickets = async ({
  game_id,
  search = "",
  severity = [],
  assignee_ids = [],
  reported_by_ids = [],
  iteration_ids = [],
  platforms = [],
  environments = [],
} = {}) => {
  const db = getDB();

  severity = Array.isArray(severity) ? severity : [];
  assignee_ids = Array.isArray(assignee_ids) ? assignee_ids : [];
  reported_by_ids = Array.isArray(reported_by_ids) ? reported_by_ids : [];
  iteration_ids = Array.isArray(iteration_ids) ? iteration_ids : [];
  platforms = Array.isArray(platforms) ? platforms : [];
  environments = Array.isArray(environments) ? environments : [];
  environments = Array.isArray(environments) ? environments : [];

  let whereClauses = [`deleted_at IS NULL`];
  let params = [];

  if (game_id) {
    whereClauses.push(`game_id = ?`);
    params.push(game_id);
  }

  if (severity.length) {
    whereClauses.push(`severity IN (${severity.map(() => "?").join(",")})`);
    params.push(...severity);
  }

  if (assignee_ids.length) {
    const hasNone = assignee_ids.includes("none");

    // Remove 'none' from actual IDs
    const filteredIds = assignee_ids.filter((id) => id !== "none");

    let condition = [];

    if (filteredIds.length) {
      condition.push(
        `assignee_id IN (${filteredIds.map(() => "?").join(",")})`,
      );
      params.push(...filteredIds);
    }

    if (hasNone) {
      condition.push(`assignee_id IS NULL`);
    }

    // Combine both conditions
    whereClauses.push(`(${condition.join(" OR ")})`);
  }

  if (reported_by_ids.length) {
    whereClauses.push(
      `created_by IN (${reported_by_ids.map(() => "?").join(",")})`,
    );
    params.push(...reported_by_ids);
  }

  if (iteration_ids.length) {
    whereClauses.push(
      `iteration_id IN (${iteration_ids.map(() => "?").join(",")})`,
    );
    params.push(...iteration_ids);
  }

  if (platforms.length) {
    whereClauses.push(`platform IN (${platforms.map(() => "?").join(",")})`);
    params.push(...platforms);
  }

  if (environments.length) {
    whereClauses.push(
      `environment IN (${environments.map(() => "?").join(",")})`,
    );
    params.push(...environments);
  }

  const whereSQL = `WHERE ${whereClauses.join(" AND ")}`;

  const [tickets] = await db.execute(
    `SELECT 
      id,
      bug_id,
      name,
      game_id,
      iteration_id,
      status,
      severity,
      assignee_id,
      platform,
      environment,
      created_by,
      created_at,
      updated_at
     FROM bug_details
     ${whereSQL}
     ORDER BY updated_at DESC`,
    params,
  );

  /* ✅ STEP 1: Collect all user IDs */
  const userIds = new Set();
  tickets.forEach((t) => {
    if (t.assignee_id) userIds.add(t.assignee_id);
    if (t.created_by) userIds.add(t.created_by);
  });

  /* ✅ STEP 2: Fetch users in bulk */
  const usersMap = await getUsersWithTeamsBulk([...userIds]);

  /* ✅ STEP 3: Map data (NO extra DB calls) */
  const enrichedTickets = tickets.map((ticket) => {
    const assignee = usersMap[ticket.assignee_id] || null;
    const createdBy = usersMap[ticket.created_by] || null;

    return {
      ...ticket,
      severity_label: severityMap[ticket.severity] || "Unknown",

      assignee: assignee
        ? {
            id: assignee.id,
            name: assignee.name,
            short_name: getShortName(assignee.name),
            teams: assignee.teams.map((t) => t.name),
            color: getTextColorForUser(assignee.name),
            profile_color: getProfileColorForUser(assignee.name),
          }
        : null,

      reported_by: createdBy
        ? {
            id: createdBy.id,
            name: createdBy.name,
            short_name: getShortName(createdBy.name),
            teams: createdBy.teams.map((t) => t.name),
            color: getTextColorForUser(createdBy.name),
            profile_color: getProfileColorForUser(createdBy.name),
          }
        : null,
    };
  });

  /* 🔍 Search */
  if (search) {
    const s = search.toLowerCase();
    return enrichedTickets.filter(
      (t) =>
        t.bug_id?.toLowerCase().includes(s) ||
        t.name?.toLowerCase().includes(s) ||
        t.severity_label?.toLowerCase().includes(s) ||
        t.assignee?.name?.toLowerCase().includes(s) ||
        t.reported_by?.name?.toLowerCase().includes(s),
    );
  }

  return enrichedTickets;
};
// controllers/bug.controller.js

export const getBugListApi = async (req, res) => {
  try {
    const {
      game_id,
      search = "",
      severity,
      assignee_ids,
      reported_by_ids,
      iteration_ids,
      platforms,
      environments,
    } = req.query;

    if (!game_id) {
      return res.status(400).json({
        success: false,
        message: "game_id is required",
      });
    }

    // Convert query params to arrays
    const payload = {
      game_id,
      search,
      severity: severity ? severity.split(",") : [],
      assignee_ids: assignee_ids ? assignee_ids.split(",") : [],
      reported_by_ids: reported_by_ids ? reported_by_ids.split(",") : [],
      iteration_ids: iteration_ids ? iteration_ids.split(",") : [],
      platforms: platforms ? platforms.split(",") : [],
      environments: environments ? environments.split(",") : [],
    };

    const tickets = await getAllTickets(payload);

    return res.status(200).json({
      success: true,
      message: "Tickets fetched successfully",
      data: tickets,
    });
  } catch (error) {
    console.error("Get bug list error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch tickets",
    });
  }
};

export const updateTicket = async ({
  id,
  name,
  status,
  assignee,
  reported_by,
  severity,
  userId,
  platform,
  environment,
}) => {
  const db = getDB();
  let insertedActivities = [];

  let assigneeChanged = false;
  let statusChanged = false;
  /* 1️⃣ Get existing ticket */
  const [existingRows] = await db.execute(
    `SELECT * FROM bug_details WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );

  if (!existingRows.length) throw new Error("Ticket not found");

  const existing = existingRows[0];
  const [[gameRow]] = await db.execute(
    `SELECT name FROM gameinfodetails WHERE id = ?`,
    [existing.game_id],
  );

  const gameName = gameRow?.name ?? null;

  /* 2️⃣ Build dynamic update */
  const updates = [];
  const params = [];

  if (name && name !== existing.name) {
    updates.push("name = ?");
    params.push(name);
  }

  if (status !== undefined && status !== existing.status) {
    statusChanged = true;
    updates.push("status = ?");
    params.push(status);
  }

  if (assignee !== undefined && assignee !== existing.assignee_id) {
    updates.push("assignee_id = ?");
    params.push(assignee);
  }

  if (reported_by !== undefined && reported_by !== existing.created_by) {
    updates.push("created_by = ?");
    params.push(reported_by);
  }
  if (severity !== undefined && severity !== existing.severity) {
    updates.push("severity = ?");
    params.push(severity);
  }
  if (platform !== undefined && platform !== existing.platform) {
    updates.push("platform = ?");
    params.push(platform);
  }
  if (environment !== undefined && environment !== existing.environment) {
    updates.push("environment = ?");
    params.push(environment);
  }
  if (!updates.length) return { message: "No changes detected" };

  updates.push("updated_at = NOW()");
  params.push(id);

  /* 3️⃣ Update DB */
  await db.execute(
    `UPDATE bug_details SET ${updates.join(", ")} WHERE id = ?`,
    params,
  );

  /* 4️⃣ Resolve names BEFORE logging */
  const [
    oldAssigneeName,
    newAssigneeName,
    oldReporterName,
    newReporterName,
    oldStatusName,
    newStatusName,
  ] = await Promise.all([
    getUserNameById(existing.assignee_id),
    getUserNameById(assignee),
    getUserNameById(existing.created_by),
    getUserNameById(reported_by),
    getStatusNameById(db, existing.status),
    getStatusNameById(db, status),
  ]);

  /* 5️⃣ Activity logs */
  if (name && name !== existing.name) {
    const activity = await logActivity({
      bug_id: id,
      activity_type: "title_change",
      activity_content: `changed the title to "${name}"`,
      performed_by: userId,
      old_value: existing.name,
      new_value: name,
    });
    insertedActivities.push(activity);
  }

  if (status !== undefined && status !== existing.status) {
    const activity = await logActivity({
      bug_id: id,
      activity_type: "status_change",
      activity_content: `updated the bug status from "${oldStatusName}" to "${newStatusName}"`,
      performed_by: userId,
      old_value: oldStatusName,
      new_value: newStatusName,
    });
    insertedActivities.push(activity);
  }

  if (assignee !== undefined && assignee !== existing.assignee_id) {
    assigneeChanged = true;

    const activity = await logActivity({
      bug_id: id,
      activity_type: "assignee_change",
      activity_content: `updated the assignee to "${newAssigneeName ?? "Unassigned"}"`,
      performed_by: userId,
      old_value: oldAssigneeName,
      new_value: newAssigneeName,
    });
    insertedActivities.push(activity);
  }

  if (reported_by !== undefined && reported_by !== existing.created_by) {
    const activity = await logActivity({
      bug_id: id,
      activity_type: "reported_by_change",
      activity_content: `Reported by changed from "${oldReporterName}" to "${newReporterName}"`,
      performed_by: userId,
      old_value: oldReporterName,
      new_value: newReporterName,
    });
    insertedActivities.push(activity);
  }
  if (severity !== undefined && severity !== existing.severity) {
    const oldSeverityName = severityMap[existing.severity] || "None";
    const newSeverityName = severityMap[severity] || "None";

    const activity = await logActivity({
      bug_id: id,
      activity_type: "severity_changed",
      activity_content: `assigned the severity "${newSeverityName ?? "Not assigned"}"`,
      performed_by: userId,
      old_value: oldSeverityName,
      new_value: newSeverityName,
    });
    insertedActivities.push(activity);
  }

  if (platform !== undefined && platform !== existing.platform) {
    const oldPlatformName = existing.platform;
    const newPlatformName = platform;

    const activity = await logActivity({
      bug_id: id,
      activity_type: "platform_changed",
      activity_content: `assigned the platform "${newPlatformName ?? "Not assigned"}"`,
      performed_by: userId,
      old_value: oldPlatformName,
      new_value: newPlatformName,
    });
    insertedActivities.push(activity);
  }
  if (environment !== undefined && environment !== existing.environment) {
    const oldEnvironmentName = existing.environment;
    const newEnvironmentName = environment;

    const activity = await logActivity({
      bug_id: id,
      activity_type: "environment_changed",
      activity_content: `assigned the environment "${newEnvironmentName ?? "Not assigned"}"`,
      performed_by: userId,
      old_value: oldEnvironmentName,
      new_value: newEnvironmentName,
    });
    insertedActivities.push(activity);
  }
  console.log("Inserted activities:", insertedActivities);
  // check existing.assignee_id is already present expect this bug id in table
  const [existingAssigneeRows] = await db.execute(
    `SELECT id FROM bug_details WHERE assignee_id = ? AND id != ? AND game_id = ? AND deleted_at IS NULL`,
    [existing.assignee_id, id, existing.game_id],
  );
  const [existingIterationRows] = await db.execute(
    `SELECT id FROM bug_details WHERE iteration_id = ? AND id != ? AND game_id = ? AND deleted_at IS NULL`,
    [existing.iteration_id, id, existing.game_id],
  );
  const [existingPlatformRows] = await db.execute(
    `SELECT id FROM bug_details WHERE platform = ? AND id != ? AND game_id = ? AND deleted_at IS NULL`,
    [existing.platform, id, existing.game_id],
  );
  const [existingEnvironmentRows] = await db.execute(
    `SELECT id FROM bug_details WHERE environment = ? AND id != ? AND game_id = ? AND deleted_at IS NULL`,
    [existing.environment, id, existing.game_id],
  );

  return {
    message: "Ticket updated successfully",
    data: {
      id,
      bug_id: existing.bug_id,
      name: name || existing.name,
      assigneeChanged,
      statusChanged,
      game_id: existing.game_id,
      gameName,
      status: status !== undefined ? status : existing.status,
      assignee_id: assignee !== undefined ? assignee : existing.assignee_id,
      userEmail: assignee ? await getEmailByUserId(assignee) : null,
      assignee_short_name: assignee
        ? getShortName(newAssigneeName)
        : getShortName(oldAssigneeName),
      assignee_color: assignee
        ? getTextColorForUser(newAssigneeName)
        : getTextColorForUser(oldAssigneeName),
      assignee_profile_color: assignee
        ? getProfileColorForUser(newAssigneeName)
        : getProfileColorForUser(oldAssigneeName),
      severity: severity !== undefined ? severity : existing.severity,
      platform: platform !== undefined ? platform : existing.platform,
      environment:
        environment !== undefined ? environment : existing.environment,
      created_by: reported_by !== undefined ? reported_by : existing.created_by,
      activities: insertedActivities,
      updated_dropdown: {
        id: assignee !== undefined ? assignee : existing.assignee_id,
        name: assignee ? newAssigneeName : oldAssigneeName,
        short_name: assignee
          ? getShortName(newAssigneeName)
          : getShortName(oldAssigneeName),
        color: assignee
          ? getTextColorForUser(assignee)
          : getTextColorForUser(existing.assignee),
        profile_color: assignee
          ? getProfileColorForUser(assignee)
          : getProfileColorForUser(existing.assignee),
        removed_assignee_id: existing.assignee_id,
        removed_dropdown_id:
          existingAssigneeRows.length > 0 ? null : existing.assignee_id,
        removed_iteration_id:
          existingIterationRows.length > 0 ? null : existing.iteration_id,
        removed_platform:
          existingPlatformRows.length > 0 ? null : existing.platform,
        removed_environment:
          existingEnvironmentRows.length > 0 ? null : existing.environment,
      },
    },
  };
};

export async function saveBugAttachments(
  bug_id,
  attachments,
  created_by,
  new_files = [],
) {
  const db = getDB();
  let activities = [];

  try {
    if (!bug_id) {
      throw new Error("bug_id required");
    }

    if (!attachments || attachments.length === 0) {
      return {
        bug_id,
        attachments: [],
        activities: [],
      };
    }

    const attachmentsJson = JSON.stringify(attachments);

    /* =========================
       GET EXISTING ROW
    ========================== */

    const [rows] = await db.query(
      `
      SELECT id, attachments
      FROM bug_comments
      WHERE bug_id = ?
        AND comment IS NULL
        AND attachments IS NOT NULL
      LIMIT 1
      `,
      [bug_id],
    );

    let oldAttachments = [];
    let commentId = null;

    if (rows.length > 0) {
      commentId = rows[0].id;

      try {
        oldAttachments = rows[0].attachments
          ? JSON.parse(rows[0].attachments)
          : [];
      } catch {
        oldAttachments = [];
      }
    }

    /* =========================
       UPDATE DB WITH FULL LIST
    ========================== */

    if (commentId) {
      await db.query(
        `UPDATE bug_comments
         SET attachments = ?, updated_at = NOW()
         WHERE id = ?`,
        [attachmentsJson, commentId],
      );
    } else {
      const [result] = await db.execute(
        `INSERT INTO bug_comments (bug_id, attachments, created_by)
         VALUES (?, ?, ?)`,
        [bug_id, attachmentsJson, created_by],
      );

      commentId = result.insertId;
    }

    /* =========================
       ACTIVITY ONLY NEW FILES
    ========================== */

    const newFiles = new_files && new_files.length ? new_files : [];

    if (newFiles.length > 0) {
      const activity = await logActivity({
        bug_id,
        activity_type: "attachment_added",
        activity_content: `attached a file`,
        performed_by: created_by,
        old_value: JSON.stringify([]),
        new_value: JSON.stringify(newFiles), // ✅ ONLY NEW
        related_comment_id: commentId,
        related_file: newFiles,
      });

      activities.push(activity);
    }

    return {
      bug_id,
      attachments,
      activities,
    };
  } catch (error) {
    console.error("❌ saveBugAttachments ERROR:", error);
    throw error;
  }
}

export async function removeBugAttachments(
  bug_id,
  attachments,
  created_by,
  removed_files = [],
) {
  const db = getDB();
  let activities = [];

  try {
    if (!bug_id) throw new Error("bug_id required");
    if (!attachments) throw new Error("attachments required");

    const attachmentsJson = JSON.stringify(attachments);

    /* =========================
       1️⃣ DELETE FROM S3
    ========================== */
    if (removed_files.length > 0) {
      const config = getS3Config();

      const s3 = new S3Client({
        region: config.AWS_REGION,
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      });

      const objectsToDelete = removed_files.map((file) => {
        const key = decodeURIComponent(new URL(file.url).pathname.substring(1));

        return { Key: key };
      });

      await s3.send(
        new DeleteObjectsCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Delete: {
            Objects: objectsToDelete,
          },
        }),
      );

      console.log("🗑 Files deleted from S3:", objectsToDelete);
    }

    if (removed_files && removed_files.length > 0) {
      const normalize = (url) => decodeURIComponent(url);

      const removedUrls = new Set(removed_files.map((f) => normalize(f.url)));

      const fileUrl = removed_files[0]?.url; // example (loop if multiple)

      const [activityRows] = await db.query(
        `SELECT id, related_file
   FROM bug_activities
   WHERE bug_id = ?
     AND JSON_SEARCH(related_file, 'one', ?) IS NOT NULL`,
        [bug_id, fileUrl],
      );

      for (const row of activityRows) {
        if (!row.related_file) continue;

        let existingFiles = [];

        try {
          existingFiles = JSON.parse(row.related_file);
        } catch (err) {
          console.error("❌ Invalid JSON:", row.id);
          continue;
        }

        // ✅ Remove only matching files
        const updatedFiles = existingFiles.filter(
          (file) => !removedUrls.has(normalize(file.url)),
        );

        // ✅ ONLY UPDATE (never delete row)
        if (updatedFiles.length !== existingFiles.length) {
          await db.query(
            `UPDATE bug_activities
         SET related_file = ?
         WHERE id = ?`,
            [JSON.stringify(updatedFiles), row.id],
          );
        }
      }
    }
    /* =========================
       2️⃣ GET OR CREATE COMMENT
    ========================== */
    const [rows] = await db.query(
      `SELECT id
       FROM bug_comments
       WHERE bug_id = ?
         AND comment IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [bug_id],
    );

    let commentId = null;

    if (rows.length > 0) {
      commentId = rows[0].id;

      await db.query(
        `UPDATE bug_comments
         SET attachments = ?, updated_at = NOW()
         WHERE id = ?`,
        [attachmentsJson, commentId],
      );
    } else {
      const [result] = await db.execute(
        `INSERT INTO bug_comments (bug_id, attachments, created_by)
         VALUES (?, ?, ?)`,
        [bug_id, attachmentsJson, created_by],
      );

      commentId = result.insertId;
    }

    console.log("📌 commentId:", commentId);

    /* =========================
       3️⃣ UPDATE ACTIVITIES (REMOVE FILES)
    ========================== */
    if (removed_files.length > 0) {
      // ✅ Normalize URLs (important)
      const normalize = (url) => decodeURIComponent(url);

      const removedUrls = new Set(removed_files.map((f) => normalize(f.url)));

      const [activityRows] = await db.query(
        `SELECT id, related_file
         FROM bug_activities
         WHERE related_comment_id = ?`,
        [commentId],
      );

      for (const row of activityRows) {
        if (!row.related_file) continue;

        let existingFiles = [];

        try {
          existingFiles = JSON.parse(row.related_file);
        } catch (err) {
          console.error("❌ Invalid JSON in activity:", row.id);
          continue;
        }

        const updatedFiles = existingFiles.filter(
          (file) => !removedUrls.has(normalize(file.url)),
        );

        // 🔥 CASE 1: ALL FILES REMOVED → DELETE ACTIVITY
        if (updatedFiles.length === 0 && existingFiles.length > 0) {
          console.log("🗑 Deleting activity:", row.id);

          await db.query(`DELETE FROM bug_activities WHERE id = ?`, [row.id]);
          continue;
        }

        // 🔥 CASE 2: PARTIAL REMOVE → UPDATE
        if (updatedFiles.length !== existingFiles.length) {
          await db.query(
            `UPDATE bug_activities
             SET related_file = ?
             WHERE id = ?`,
            [JSON.stringify(updatedFiles), row.id],
          );
        }
      }

      /* =========================
         4️⃣ LOG ACTIVITY
      ========================== */
      const activity = await logActivity({
        bug_id,
        activity_type: "attachment_removed",
        activity_content: `Removed ${removed_files.length} file(s)`,
        performed_by: created_by,
        old_value: JSON.stringify(removed_files),
        new_value: JSON.stringify([]),
        related_comment_id: commentId,
        related_file: removed_files,
      });

      activities.push(activity);
    }

    /* =========================
       FINAL RESPONSE
    ========================== */
    return {
      bug_id,
      attachments,
      activities,
    };
  } catch (error) {
    console.error("❌ removeBugAttachments ERROR:", error);
    throw error;
  }
}

export async function updateBugDescription(bug_id, description, updated_by) {
  const db = getDB();

  try {
    // 1️⃣ Get old description
    const [rows] = await db.query(
      "SELECT description FROM bug_details WHERE id = ?",
      [bug_id],
    );

    const oldDescription = rows?.[0]?.description || null;
    const newDescription = description || null;

    // 2️⃣ If no change → skip
    if (oldDescription === newDescription) {
      return {
        bug_id,
        description: newDescription,
        activities: [],
      };
    }

    // 3️⃣ Update DB
    await db.query(
      "UPDATE bug_details SET description = ?, updated_at = NOW() WHERE id = ?",
      [newDescription, bug_id],
    );

    // 4️⃣ Activity Type Logic
    let activityType = "description_edited";
    let activityContent = "edited the description";

    if (!oldDescription && newDescription) {
      activityType = "description_added";
      activityContent = "added a description";
    }

    if (oldDescription && !newDescription) {
      activityType = "description_removed";
      activityContent = "removed the description";
    }

    // 5️⃣ Log Activity
    const activity = await logActivity({
      bug_id,
      activity_type: activityType,
      activity_content: activityContent,
      performed_by: updated_by,
      old_value: oldDescription,
      new_value: newDescription,
    });

    return {
      bug_id,
      description: newDescription,
      activities: [activity],
    };
  } catch (error) {
    console.error("❌ updateBugDescription ERROR:", error);
    throw error;
  }
}

export const deleteTicket = async ({ id, userId, deleted_comments }) => {
  const db = getDB();

  console.log("Deleting ticket with ID:", id);

  const [existingRows] = await db.execute(
    `SELECT * FROM bug_details WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );

  if (!existingRows.length) throw new Error("Ticket not found");

  const [attachmentRows] = await db.execute(
    `SELECT attachments FROM bug_comments WHERE bug_id = ? AND attachments IS NOT NULL`,
    [id],
  );

  let objectsToDelete = [];

  for (const row of attachmentRows) {
    try {
      const attachments = JSON.parse(row.attachments);

      attachments.forEach((file) => {
        if (file.url) {
          const key = decodeURIComponent(
            new URL(file.url).pathname.substring(1),
          );

          objectsToDelete.push({ Key: key });
        }
      });
    } catch (err) {
      console.log("Attachment parse error:", err);
    }
  }
  console.log("Objects to delete from S3:", objectsToDelete);
  /**
   * STEP 2: Delete files from S3
   */
  if (objectsToDelete.length > 0) {
    await s3
      .deleteObjects({
        Bucket: process.env.S3_BUCKET_NAME,
        Delete: {
          Objects: objectsToDelete,
        },
      })
      .promise();

    console.log("Deleted files from S3:", objectsToDelete.length);
  }

  await db.execute(
    `
    UPDATE bug_details
    SET 
      deleted_at = NOW(),
      deleted_by = ?,
      deleted_comments = ?
    WHERE id = ?
    `,
    [userId, deleted_comments, id],
  );
  const [existingAssigneeRows] = await db.execute(
    `SELECT id FROM bug_details WHERE assignee_id = ? AND id != ? AND game_id = ? AND deleted_at IS NULL AND assignee_id IS NOT NULL`,
    [existingRows[0].assignee_id, id, existingRows[0].game_id],
  );
  const [existingReporterRows] = await db.execute(
    `SELECT id FROM bug_details WHERE created_by = ? AND id != ? AND game_id = ? AND deleted_at IS NULL`,
    [existingRows[0].created_by, id, existingRows[0].game_id],
  );
  const [existingiteration] = await db.execute(
    `SELECT 1 from bug_details where iteration_id = ? AND deleted_at IS NULL`,
    [existingRows[0].created_by],
  );

  const [existingPlatformRows] = await db.execute(
    `SELECT id FROM bug_details WHERE platform = ? AND id != ? AND game_id = ? AND deleted_at IS NULL`,
    [existingRows[0].platform, id, existingRows[0].game_id],
  );
  const [existingEnvironmentRows] = await db.execute(
    `SELECT id FROM bug_details WHERE environment = ? AND id != ? AND game_id = ? AND deleted_at IS NULL`,
    [existingRows[0].environment, id, existingRows[0].game_id],
  );

  const AssigneeName = existingRows[0].assignee_id
    ? await getUserNameById(existingRows[0].assignee_id)
    : null;
  const ReporterName = existingRows[0].created_by
    ? await getUserNameById(existingRows[0].created_by)
    : null;
  const iterationId =
    existingiteration.length > 0 ? null : existingRows[0].iteration_id;
  const platform =
    existingPlatformRows.length > 0 ? null : existingRows[0].platform;
  const environment =
    existingEnvironmentRows.length > 0 ? null : existingRows[0].environment;

  await logActivity({
    bug_id: id,
    activity_type: "deletion",
    activity_content: deleted_comments,
    performed_by: userId,
  });
  console.log("Existing assignee rows:", existingAssigneeRows.length);

  return {
    message: "Ticket deleted successfully",
    assignee_dropdown:
      existingAssigneeRows.length > 0 || !existingRows[0].assignee_id
        ? null
        : {
            id: existingRows[0].assignee_id,
            name: AssigneeName,
            short_name: getShortName(AssigneeName),
            color: getTextColorForUser(AssigneeName),
            profile_color: getProfileColorForUser(AssigneeName),
          },
    reported_by_dropdown:
      existingReporterRows.length > 0
        ? null
        : {
            id: existingRows[0].created_by,
            name: ReporterName,
            short_name: getShortName(ReporterName),
            color: getTextColorForUser(ReporterName),
            profile_color: getProfileColorForUser(ReporterName),
          },
    iteration_dropdown: iterationId,
    platform_dropdown: platform,
    environment_dropdown: environment,
  };
};
const userCache = new Map();
const getUserWithTeamCached = async (id) => {
  if (userCache.has(id)) return userCache.get(id);

  const user = await getUserWithTeam(id);

  console.log(user,"main user");
  
  userCache.set(id, user);

  return user;
};
export const isBugApi = async (req, res) => {
  try {
    const { id, game_id } = req.query;
    if (!id || !game_id) {
      return res.status(400).json({
        success: false,
        message: "Bug id and game id are required",
      });
    }
    const db = getDB();

    const [rows] = await db.execute(
      `SELECT 1 FROM bug_details WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    const [gameRows] = await db.query(
      `SELECT * FROM gameinfodetails where isgameactive = 1 AND id=?`,
      [game_id],
    );

    return res.status(200).json({
      success: true,
      message: "Bug exists",
      data: {
        status: rows.length > 0 && gameRows.length > 0,
      },
    });
  } catch (error) {
    console.error("Error occurred while checking bug existence:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
export const getSingleBugApi = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Bug id is required",
      });
    }

    const db = getDB();

    const [rows] = await db.execute(
      `
      SELECT 
        b.id,
        b.bug_id,
        b.name,
        b.game_id,
        b.iteration_id,
        b.status,
        b.description,
        b.severity,
        b.platform,
        b.environment,
        b.assignee_id,
        b.created_by,
        b.created_at,
        b.updated_at,

        c.id            AS comment_id,
        c.comment       AS comment,
        c.attachments   AS attachments,
        c.created_by    AS comment_created_by,
        c.created_at    AS comment_created_at,
        c.updated_at    AS comment_updated_at

      FROM bug_details b
      LEFT JOIN bug_comments c
        ON c.bug_id = b.id
        AND c.deleted_at IS NULL
      WHERE b.id = ?
        AND b.deleted_at IS NULL
      ORDER BY c.created_at ASC
      `,
      [id],
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Bug not found",
      });
    }

    const ticket = rows[0];

    /* ✅ Fetch users */
    const [assignee, createdBy] = await Promise.all([
      ticket.assignee_id ? getUserWithTeamCached(ticket.assignee_id) : null,
      ticket.created_by ? getUserWithTeamCached(ticket.created_by) : null,
    ]);

    /* =========================
       🗨️ COMMENTS
    ========================== */
    const commentsMap = new Map();

    for (const r of rows) {
      if (!r.comment_id) continue;

      let parsedAttachments = [];

      if (r.attachments) {
        try {
          parsedAttachments =
            typeof r.attachments === "string"
              ? JSON.parse(r.attachments)
              : r.attachments;
        } catch {
          parsedAttachments = [];
        }
      }

      // ✅ If comment not exists → create
      if (!commentsMap.has(r.comment_id)) {
        commentsMap.set(r.comment_id, {
          id: r.comment_id,
          comment: r.comment,
          attachments: [],
          created_by: r.comment_created_by,
          created_at: r.comment_created_at,
          updated_at: r.comment_updated_at,
        });
      }

      const commentObj = commentsMap.get(r.comment_id);

      // ✅ Add attachments WITHOUT duplicates
      parsedAttachments.forEach((file) => {
        const alreadyExists = commentObj.attachments.some(
          (f) => f.url === file.url,
        );

        if (!alreadyExists) {
          commentObj.attachments.push({
            name: file.name,
            url: file.url,
            type: file.type,
          });
        }
      });
    }

    const comments = Array.from(commentsMap.values());

    // ✅ Flatten attachments with correct mapping
    const attachmentsFlat = [];

    comments.forEach((c) => {
      c.attachments.forEach((file) => {
        attachmentsFlat.push({
          name: file.name,
          url: file.url,
          type: file.type,
          comment: c.comment,
          comment_id: c.id,
        });
      });
    });
    return res.status(200).json({
      success: true,
      message: "Bug fetched successfully",
      data: {
        id: ticket.id,
        bug_id: ticket.bug_id,
        name: ticket.name,
        iteration_id: ticket.iteration_id,
        game_id: ticket.game_id,
        status: ticket.status,
        description: ticket.description,
        assignee_id: ticket.assignee_id,
        created_by: ticket.created_by,
        severity: ticket.severity,
        severity_label: severityMap[ticket.severity] || "Unknown",
        environment: ticket.environment,
        platform: ticket.platform,
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,

        assignee: assignee
          ? {
              id: assignee.id,
              name: assignee.name,
              short_name: getShortName(assignee.name),
              teams: assignee.teams.map((t) => t.name),
              color: getTextColorForUser(assignee.name),
              profile_color: getProfileColorForUser(assignee.name),
            }
          : null,

        reported_by: createdBy
          ? {
              id: createdBy.id,
              name: createdBy.name,
              short_name: getShortName(createdBy.name),
              teams: createdBy.teams.map((t) => t.name),
              color: getTextColorForUser(createdBy.name),
              profile_color: getProfileColorForUser(createdBy.name),
            }
          : null,

        comments,
        attachments: attachmentsFlat, // 🔥 IMPORTANT CHANGE
      },
    });
  } catch (error) {
    console.error("Get single bug error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bug",
    });
  }
};

export async function getActivityLogs(bug_id) {
  const db = getDB();

  const [rows] = await db.execute(
    `
    SELECT 
      id,
      bug_id,
      activity_type,
      activity_content,
      old_value,
      new_value,
      related_comment_id,
      related_file,
      performed_by,
      created_at
    FROM bug_activities
    WHERE bug_id = ?
    ORDER BY created_at DESC
    `,
    [bug_id],
  );

  // ✅ SAFE JSON PARSER
  const safeParse = (value) => {
    if (!value) return null;

    if (typeof value === "object") return value;

    try {
      return JSON.parse(value);
    } catch (err) {
      console.warn("Invalid JSON skipped:", value);
      return null;
    }
  };

  const formattedRows = await Promise.all(
    rows.map(async (row) => {
      let userDetails = null;

      if (row.performed_by) {
        const user = await getUserWithTeam(row.performed_by);

        if (user) {
          userDetails = {
            ...user,
            short_name: getShortName(user.name),
            color: getTextColorForUser(user.name),
            profile_color: getProfileColorForUser(user.name),
          };
        }
      }

      return {
        ...row,
        related_file: safeParse(row.related_file),
        old_value: safeParse(row.old_value),
        new_value: safeParse(row.new_value),
        performed_by: userDetails,
      };
    }),
  );

  return formattedRows;
}

export async function AddComments(
  bug_id,
  attachments = null,
  comment,
  created_by,
) {
  const db = getDB();

  const attachmentsJson =
    attachments && Object.keys(attachments).length > 0
      ? JSON.stringify(attachments)
      : null;
  const currentTime = getCurrentISTForMySQL();
  if (attachmentsJson) {
    console.log("✅ attachmentsJson received:", attachmentsJson);
    // 1️⃣ Check existing attachments row
    const [rows] = await db.query(
      `
    SELECT id, attachments
    FROM bug_comments
    WHERE bug_id = ?
      AND comment IS NULL
      AND attachments IS NOT NULL
    LIMIT 1
    `,
      [bug_id],
    );
    console.log("✅ Existing rows found:", rows.length);
    if (rows.length > 0) {
      // 2️⃣ Row exists → merge arrays
      console.log("🔄 Updating existing attachments row");
      const existingRow = rows[0];

      let existingAttachments = [];

      try {
        existingAttachments = JSON.parse(existingRow.attachments) || [];
      } catch (e) {
        existingAttachments = [];
      }

      const newAttachments = JSON.parse(attachmentsJson);

      const mergedAttachments = [...existingAttachments, ...newAttachments];

      await db.execute(
        `
      UPDATE bug_comments
      SET attachments = ?,updated_at = ?
      WHERE id = ?
      `,
        [JSON.stringify(mergedAttachments), currentTime, existingRow.id],
      );
    } else {
      // 3️⃣ No row → insert new row
      console.log("➕ Inserting new attachments row");
      await db.execute(
        `
      INSERT INTO bug_comments (bug_id, comment, attachments, created_by, created_at)
      VALUES (?, NULL, ?, ?, ?)
      `,
        [bug_id, attachmentsJson, created_by, currentTime],
      );
    }
  }

  const sql = `
    INSERT INTO bug_comments
    (bug_id, comment, attachments, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `;

  const [result] = await db.execute(sql, [
    bug_id,
    comment,
    attachmentsJson,
    created_by,
    currentTime,
  ]);
  let activities = [];
  const activity = await logActivity({
    bug_id,
    activity_type: "comment_added",
    activity_content: comment,
    performed_by: created_by,
    related_comment_id: result.insertId,
    related_file: attachmentsJson,
  });
  activities.push(activity);
  const [bugRows] = await db.execute(
    `
  SELECT bug_id, game_id
  FROM bug_details
  WHERE id = ?
  LIMIT 1
  `,
    [bug_id],
  );
  return {
    id: result.insertId,
    bug_details_id: bugRows[0].bug_id,
    game_id: bugRows[0].game_id,
    bug_id,
    comment,
    attachments: attachments ?? null,
    created_by,
    created_at: new Date(),
    activities: activities,
  };
}

export async function updateComment(comment_id, comment, userId) {
  const db = getDB();
  let activities = [];
  const [existingRows] = await db.execute(
    `SELECT * FROM bug_comments WHERE id = ? AND deleted_at IS NULL`,
    [comment_id],
  );
  const currentTime = getCurrentISTForMySQL();
  if (!existingRows.length) throw new Error("Comment not found");

  const sql = `
    UPDATE bug_comments
    SET comment = ?, updated_at =?, updated_by = ?
    WHERE id = ? AND deleted_at IS NULL
  `;
  await db.execute(sql, [comment, currentTime, userId, comment_id]);
  await db.execute(
    `UPDATE bug_activities SET activity_content = ?, old_value = ?, new_value = ?,  activity_type = 'comment_edited', created_at = ? WHERE related_comment_id = ?`,
    [comment, existingRows[0].comment, comment, currentTime, comment_id],
  );
  const [updatedActivityRows] = await db.execute(
    `SELECT * FROM bug_activities WHERE related_comment_id = ?`,
    [comment_id],
  );
  const formattedRows = await Promise.all(
    updatedActivityRows.map(async (row) => {
      let userDetails = null;

      if (row.performed_by) {
        const user = await getUserWithTeam(row.performed_by);

        if (user) {
          userDetails = {
            ...user,
            short_name: getShortName(user.name),
            color: getTextColorForUser(user.name),
            profile_color: getProfileColorForUser(user.name),
          };
        }
      }

      return {
        ...row,
        related_file: row.related_file ? JSON.parse(row.related_file) : null,
        performed_by: userDetails,
      };
    }),
  );
  activities.push(formattedRows[0]);
  return {
    id: comment_id,
    comment: comment,
    updated_at: new Date(),
    activities: activities,
  };
}

export async function deleteComment(comment_id, userId) {
  const db = getDB();
  const [existingRows] = await db.execute(
    `SELECT * FROM bug_comments WHERE id = ? AND deleted_at IS NULL`,
    [comment_id],
  );
  const currentTime = getCurrentISTForMySQL();
  let activity = [];
  let removedFileUrls = [];
  if (!existingRows.length) throw new Error("Comment not found");
  const comment = existingRows[0];
  if (comment.attachments) {
    try {
      const attachments = JSON.parse(comment.attachments);
      removedFileUrls = attachments.map((file) => file.url);

      const objectsToDelete = attachments.map((file) => {
        const key = decodeURIComponent(new URL(file.url).pathname.substring(1));

        return { Key: key };
      });

      if (objectsToDelete.length > 0) {
        await s3
          .deleteObjects({
            Bucket: process.env.S3_BUCKET_NAME,
            Delete: {
              Objects: objectsToDelete,
            },
          })
          .promise();

        console.log("Deleted files from S3:", objectsToDelete);
      }

      /* =========================
     🔥 REMOVE FILES FROM ALL COMMENTS
  ========================== */
      if (attachments.length > 0) {
        const normalize = (url) => decodeURIComponent(url);

        const removedUrls = new Set(attachments.map((f) => normalize(f.url)));

        // Get all comments with attachments
        const [rows] = await db.query(
          `SELECT id, attachments 
       FROM bug_comments 
       WHERE bug_id = ? 
         AND attachments IS NOT NULL 
         AND deleted_at IS NULL`,
          [comment.bug_id],
        );

        for (const row of rows) {
          let existingFiles = [];

          try {
            existingFiles =
              typeof row.attachments === "string"
                ? JSON.parse(row.attachments)
                : row.attachments;
          } catch {
            existingFiles = [];
          }

          const updatedFiles = existingFiles.filter(
            (file) => !removedUrls.has(normalize(file.url)),
          );

          if (updatedFiles.length !== existingFiles.length) {
            await db.execute(
              `UPDATE bug_comments
           SET attachments = ?, updated_at = ?
           WHERE id = ?`,
              [JSON.stringify(updatedFiles), currentTime, row.id],
            );
          }
        }
      }
      const sql = `DELETE FROM bug_comments WHERE bug_id = ? AND deleted_at IS NULL AND attachments = ? AND comment IS NULL`;
      await db.execute(sql, [comment.bug_id, comment.attachments]);
    } catch (err) {
      console.log("Attachment parse error:", err);
    }
  }
  const sql = `DELETE FROM bug_comments WHERE id = ? AND deleted_at IS NULL`;

  // delete related activities in activity log
  await db.execute(
    `UPDATE bug_activities SET activity_content = 'Deleted the comment', old_value = NULL, new_value = NULL, activity_type = 'comment_deleted', created_at = ?,related_file = NULL WHERE related_comment_id = ?`,
    [currentTime, comment_id],
  );
  // get the delete comment activity log
  const [deletedActivityRows] = await db.execute(
    `SELECT * FROM bug_activities WHERE related_comment_id = ?`,
    [comment_id],
  );
  const formattedRows = await Promise.all(
    deletedActivityRows.map(async (row) => {
      let userDetails = null;

      if (row.performed_by) {
        const user = await getUserWithTeam(row.performed_by);

        if (user) {
          userDetails = {
            ...user,
            short_name: getShortName(user.name),
            color: getTextColorForUser(user.name),
            profile_color: getProfileColorForUser(user.name),
          };
        }
      }

      return {
        ...row,
        related_file: row.related_file ? JSON.parse(row.related_file) : null,
        performed_by: userDetails,
      };
    }),
  );
  console.log("Deleted comment activities:", formattedRows);
  await db.execute(sql, [currentTime, userId, comment_id]);
  activity.push(formattedRows[0]);
  return {
    id: comment_id,
    message: "Comment deleted successfully",
    removed_files: removedFileUrls,
    activities: activity,
  };
}

const statusMap = {
  1: "Bug Found",
  2: "In Progress",
  3: "In Review",
  4: "On Hold",
  5: "Reopened",
  6: "Closed",
};

const severityMap = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Critical",
};

export const getBugTrackingListApi = async (req, res) => {
  try {
    const {
      game_id,
      search = "",
      severity,
      status,
      assignee_ids,
      reported_by_ids,
      fromdate,
      todate,
      page = 1,
      limit = 10,
    } = req.query;

    const payload = {
      game_id,
      search,
      severity: severity ? severity.split(",") : [],
      status: status ? status.split(",").map(Number) : [],
      assignee_ids: assignee_ids ? assignee_ids.split(",") : [],
      reported_by_ids: reported_by_ids ? reported_by_ids.split(",") : [],
      fromdate,
      todate,
      page: Number(page),
      limit: Number(limit),
    };

    const result = await getAllBugList(payload);

    return res.status(200).json({
      success: true,
      message: "Tickets fetched successfully",
      data: result.tickets,
      counts: result.counts,
      pagination: {
        total_records: result.total_records,
        total_pages: result.total_pages,
        current_page: result.current_page,
        per_page: result.per_page,
        range_from: result.range_from,
        next_page: result.next_page,
        prev_page: result.prev_page,
      },
    });
  } catch (error) {
    console.error("Get bug list error:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
      stack: error.stack,
    });
  }
};

export const getAllBugList = async ({
  game_id,
  search = "",
  severity = [],
  assignee_ids = [],
  reported_by_ids = [],
  status = [],
  fromdate,
  todate,
  page = 1,
  limit = 10,
} = {}) => {
  const db = getDB();

  // ✅ SAFE PAGINATION
  const safeLimit = Number(limit) > 0 ? Number(limit) : 10;
  const safePage = Number(page) > 0 ? Number(page) : 1;
  const offset = (safePage - 1) * safeLimit;

  let whereClauses = [`b.deleted_at IS NULL`];
  let params = [];

  if (game_id) {
    whereClauses.push(`b.game_id = ?`);
    params.push(game_id);
  }

  if (search) {
    whereClauses.push(`(
      LOWER(b.bug_id) LIKE ?
      OR LOWER(b.name) LIKE ?
      OR LOWER(g.name) LIKE ?
    )`);
    const searchValue = `%${search.toLowerCase()}%`;
    params.push(searchValue, searchValue, searchValue);
  }

  if (severity.length > 0) {
    whereClauses.push(`b.severity IN (${severity.map(() => "?").join(",")})`);
    params.push(...severity);
  }

  if (status.length > 0) {
    whereClauses.push(`b.status IN (${status.map(() => "?").join(",")})`);
    params.push(...status);
  }

  if (assignee_ids.length > 0) {
    const hasNone = assignee_ids.includes("none");
    const filteredIds = assignee_ids.filter((id) => id !== "none");

    let condition = [];
    if (filteredIds.length > 0) {
      condition.push(
        `b.assignee_id IN (${filteredIds.map(() => "?").join(",")})`,
      );
      params.push(...filteredIds);
    }
    if (hasNone) {
      condition.push(`b.assignee_id IS NULL`);
    }
    if (condition.length > 0) {
      whereClauses.push(`(${condition.join(" OR ")})`);
    }
  }

  if (reported_by_ids.length > 0) {
    whereClauses.push(
      `b.created_by IN (${reported_by_ids.map(() => "?").join(",")})`,
    );
    params.push(...reported_by_ids);
  }

  if (fromdate && todate) {
    whereClauses.push(`DATE(b.created_at) BETWEEN ? AND ?`);
    params.push(fromdate, todate);
  }

  whereClauses.push("g.isgameactive = 1");

  const whereSQL = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : "";

  /* ================= TOTAL COUNT ================= */
  const [[{ totalRecords }]] = await db.execute(
    `SELECT COUNT(*) as totalRecords
     FROM bug_details b
     LEFT JOIN gameinfodetails g ON g.id = b.game_id
     ${whereSQL}`,
    params,
  );

  /* ================= MAIN QUERY ================= */
  const [tickets] = await db.execute(
    `SELECT 
      b.id,
      b.bug_id,
      b.name,
      b.status,
      b.severity,
      b.assignee_id,
      b.created_by,
      b.iteration_id,
      b.created_at,
      b.updated_at,
      b.game_id,
      g.name AS game_name
    FROM bug_details b
    LEFT JOIN gameinfodetails g 
      ON g.id = b.game_id
    ${whereSQL}
    ORDER BY b.updated_at DESC
    LIMIT ${safeLimit} OFFSET ${offset}`,
    params,
  );

  /* ================= USERS ================= */
  const userIds = new Set();
  tickets.forEach((t) => {
    if (t.assignee_id) userIds.add(t.assignee_id);
    if (t.created_by) userIds.add(t.created_by);
  });

  const usersMap = await getUsersWithTeamsBulk([...userIds]);

  const formatIST = (date) => {
    if (!date) return null;
    return new Date(date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  };

  const enrichedTickets = tickets.map((ticket) => {
    const assignee = usersMap[ticket.assignee_id] || null;
    const createdBy = usersMap[ticket.created_by] || null;

    return {
      id: ticket.id,
      bug_id: ticket.bug_id,
      title: ticket.name,
      game_name: ticket.game_name,
      game_id: ticket.game_id,
      status: ticket.status,
      status_label: statusMap[ticket.status] || "Unassigned",
      severity: ticket.severity,
      severity_label: severityMap[ticket.severity] || "Unassigned",
      iteration_id: ticket.iteration_id,
      created_on: formatIST(ticket.created_at),
      assignee: assignee
        ? {
            id: assignee.id,
            name: assignee.name,
            short_name: getShortName(assignee.name),
            profile_color: getProfileColorForUser(assignee.name),
            color: getTextColorForUser(assignee.name),
          }
        : null,
      reported_by: createdBy
        ? {
            id: createdBy.id,
            name: createdBy.name,
            short_name: getShortName(createdBy.name),
            profile_color: getProfileColorForUser(createdBy.name),
            color: getTextColorForUser(createdBy.name),
          }
        : null,
    };
  });

  /* ================= STATUS COUNTS ================= */

  const whereClausesForCounts = whereClauses.filter(
    (c) => !c.includes("b.status"),
  );

  whereClausesForCounts.push("g.isgameactive = 1");

  const whereSQLForCounts = whereClausesForCounts.length
    ? `WHERE ${whereClausesForCounts.join(" AND ")}`
    : "";

  let paramsForCounts = [...params];
  if (status.length > 0) {
    paramsForCounts = paramsForCounts.slice(
      0,
      paramsForCounts.length - status.length,
    );
  }

  const [countRows] = await db.execute(
    `SELECT status, COUNT(*) as count
   FROM bug_details b
   LEFT JOIN gameinfodetails g ON g.id = b.game_id
   ${whereSQLForCounts}
   GROUP BY status`,
    paramsForCounts,
  );
  const counts = {
    total: totalRecords,
    open: 0,
    in_progress: 0,
    in_review: 0,
    on_hold: 0,
    reopen: 0,
    closed: 0,
  };

  countRows.forEach((row) => {
    switch (row.status) {
      case 1:
        counts.open = row.count;
        break;
      case 2:
        counts.in_progress = row.count;
        break;
      case 3:
        counts.in_review = row.count;
        break;
      case 4:
        counts.on_hold = row.count;
        break;
      case 5:
        counts.reopen = row.count;
        break;
      case 6:
        counts.closed = row.count;
        break;
    }
  });

  /* ================= PAGINATION ================= */
  const totalPages = Math.ceil(totalRecords / safeLimit);
  const nextPage = safePage < totalPages ? safePage + 1 : null;
  const prevPage = safePage > 1 ? safePage - 1 : null;

  return {
    tickets: enrichedTickets,
    counts,
    total_records: totalRecords,
    total_pages: totalPages,
    current_page: safePage,
    per_page: safeLimit,
    range_from: `Showing ${(safePage - 1) * safeLimit + 1}-${Math.min(safePage * safeLimit, totalRecords)} of ${totalRecords} entries`,
    next_page: nextPage,
    prev_page: prevPage,
  };
};
