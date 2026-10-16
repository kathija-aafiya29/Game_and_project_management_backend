import { getDB } from "../config/db.js";
import {
  getProfileColorForUser,
  getShortName,
  getTextColorForUser,
} from "../helpers/commonHelper.js";
import {
  getUserWithTeam,
  getAllKeycloakUsers,
} from "../services/keycloack.service.js";

/* ---------------- Helpers ---------------- */

/* ---------------- DB-based IDs ---------------- */
const getDistinctUserIdsByType = async (type, game_id) => {
  const db = getDB();

  const columnMap = {
    reported_by: "created_by",
    kanban_assignee: "assignee_id",
  };

  const column = columnMap[type];
  if (!column) return [];

  // const query = `
  //   SELECT DISTINCT ${column} AS user_id
  //   FROM bug_details
  //   WHERE ${column} IS NOT NULL AND deleted_at IS NULL
  //   ${game_id ? "AND game_id = ?" : ""}
  // `;

  const query = `
    SELECT DISTINCT b.${column} AS user_id
    FROM bug_details b
    INNER JOIN gameinfodetails g 
        ON g.id = b.game_id
    WHERE b.${column} IS NOT NULL
      AND b.deleted_at IS NULL
      AND g.isgameactive = 1
      ${game_id ? "AND b.game_id = ?" : ""}
  `;

  const [rows] = game_id
    ? await db.execute(query, [game_id])
    : await db.execute(query);

  return rows.map((r) => r.user_id);
};

const getCommonFieldValues = async (game_id, type) => {
  const db = getDB();

  const columnMap = {
    iteration: "iteration_id",
    platform: "platform",
    environment: "environment",
  };
  const column = columnMap[type];
  if (!column) return [];
  console.log(
    `Fetching distinct values for column: ${column} and game_id: ${game_id}`,
  );
  const [rows] = await db.execute(
    `
    SELECT DISTINCT ${column}
    FROM bug_details
    WHERE game_id = ? AND ${column} IS NOT NULL AND deleted_at IS NULL AND ${column} != 'None'
  `,
    [game_id],
  );

  return rows.map((r) => r[column]);
};

/* ---------------- Dropdown Main ---------------- */
export const getDropdownList = async (type, game_id, userId) => {
  if (!type) return [];

  /* 🔑 ASSIGNEE = ALL KEYCLOAK USERS */
  if (type === "assignee") {
    const users = await getAllKeycloakUsers();
    return users
      .filter((u) => u.id !== userId) // ❌ exclude current user
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        short_name: getShortName(u.name),
        color: getTextColorForUser(u.name),
        profile_color: getProfileColorForUser(u.name),
      }));
  }

  /* 🏷️ STATUS = bug_statuses TABLE */
  if (type === "status") {
    const db = getDB();

    const [rows] = await db.execute(`
      SELECT id, name
      FROM bug_statuses
      WHERE is_active = 1
      ORDER BY sort_order ASC
    `);

    return rows.map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  /* 🚨 SEVERITY = STATIC */
  if (type === "severity") {
    const severities = [
      { id: 1, name: "Low" },
      { id: 2, name: "Medium" },
      { id: 3, name: "High" },
      { id: 4, name: "Critical" },
    ];

    return severities.map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  /* 🕹️ GAMES = ALL GAMES */
  if (type === "games") {
    const db = getDB();
    const [rows] = await db.execute(`
      SELECT id, name
      FROM gameinfodetails
      WHERE  isgameactive =1 
      ORDER BY name ASC
    `);

    return rows.map((g) => ({
      id: g.id,
      name: g.name,
    }));
  }

  if (type === "iteration" || type === "platform" || type === "environment") {
    console.log("Fetching iterations for game_id:", game_id);
    if (!game_id) return [];
    const iterationIds = await getCommonFieldValues(game_id, type);
    return iterationIds.map((id) => ({
      name: type === "iteration" ? `IT-${id}` : id,
      id: id,
    }));
  }

  /* 🗄️ REPORTED BY = DB USERS */
  const ids = await getDistinctUserIdsByType(type, game_id);

  const users = await Promise.all(ids.map((id) => getUserWithTeam(id)));

  const mappedUsers = users.filter(Boolean).map((u) => ({
    id: u.id,
    name: u.name,
    short_name: getShortName(u.name),
    color: getTextColorForUser(u.name),
    profile_color: getProfileColorForUser(u.name),
  }));
  if (type === "kanban_assignee") {
    return [
      {
        id: userId,
        name: "Assigned to Me",
      },
      {
        id: "none",
        name: "Unassigned",
        short_name: "UA",
        color: "#6c757d",
        profile_color: "#e9ecef",
      },
      ...mappedUsers.filter((u) => u.id !== userId),
    ];
  }
  if (type === "reported_by") {
    return [
      // ✅ Reported by Me
      {
        id: userId,
        name: "Reported by Me",
      },

      // ✅ Remaining users
      ...mappedUsers.filter((u) => u.id !== userId),
    ];
  }
};

export const getDropdownListAPI = async (req, res) => {
  try {
    const { type, game_id } = req.query;
    const userId = req.user?.sub; // ✅ get user ID from auth middleware
    if (!type) {
      return res.status(400).json({
        success: false,
        message: "type query param is required",
      });
    }

    // 🎯 game_id mandatory only for these types
    const gameRequiredTypes = ["reported_by", "kanban_assignee", "iteration"];

    if (gameRequiredTypes.includes(type) && !game_id) {
      return res.status(400).json({
        success: false,
        message: "game_id is required for this dropdown type",
      });
    }

    const dropdown = await getDropdownList(type, game_id, userId);

    return res.json({
      success: true,
      type,
      data: dropdown,
    });
  } catch (err) {
    console.error("Dropdown API error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dropdown data",
    });
  }
};
