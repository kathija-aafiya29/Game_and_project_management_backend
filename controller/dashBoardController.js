import { getDB } from "../config/db.js";
import { getUserWithTeam } from "../services/keycloack.service.js";
import {getTextColorForUser, getProfileColorForUser} from "../helpers/commonHelper.js"
export const statusCountByGame = async (gameId) => {
  const db = getDB();

  const [rows] = await db.execute(
    `SELECT
        SUM(CASE WHEN s.slug IN ('open','in_progress') THEN 1 ELSE 0 END) AS open_bugs,
        SUM(CASE WHEN s.slug = 'in_review' THEN 1 ELSE 0 END) AS in_dev_review,
        SUM(CASE WHEN s.slug = 'on_hold' THEN 1 ELSE 0 END) AS on_hold,
        SUM(CASE WHEN s.slug = 'closed' THEN 1 ELSE 0 END) AS closed
     FROM bug_details b
     JOIN bug_statuses s ON b.status = s.id
     WHERE b.game_id = ? AND b.deleted_at IS NULL`,
    [gameId]
  );
  console.log(rows);

  return {
    open_bugs: rows[0].open_bugs || 0,
    in_dev_review: rows[0].in_dev_review || 0,
    on_hold: rows[0].on_hold || 0,
    closed: rows[0].closed || 0,
    iteration: ""
  };
};

export const dashboardHighSeverityBugs = async(gameId,type)=>{

  const db = getDB();
  if(type === 'on_hold'){
    const [rows] = await db.execute(
      `SELECT b.id, b.name, s.name AS status,b.bug_id,b.severity,b.assignee_id
       FROM bug_details b
       JOIN bug_statuses s ON b.status = s.id 
       WHERE b.game_id = ? AND s.slug = 'on_hold' AND b.severity = 3 AND b.deleted_at IS NULL`,
      [gameId]
    );
    const enrichedRows = await Promise.all(rows.map(async (row) => {
        const assignee = row.assignee_id
              ? await getUserWithTeam(row.assignee_id)
              : null;

              console.log(assignee,"user");
              
      return {
        ...row,
          assignee: assignee?.name || null
      }
    }));
    return enrichedRows;
  
  }
  if(type ==="open"){
    const [rows] = await db.execute(
      `SELECT b.id, b.name, s.name AS status,b.bug_id,b.severity,b.assignee_id
       FROM bug_details b
       JOIN bug_statuses s ON b.status = s.id
        WHERE b.game_id = ? AND s.slug IN ('open','in_progress') AND b.severity = 3 AND b.deleted_at IS NULL`,
      [gameId]
    );
    const enrichedRows = await Promise.all(rows.map(async (row) => {
        const assignee = row.assignee_id
              ? await getUserWithTeam(row.assignee_id)
              : null;
      return {
        ...row,
         assignee: assignee?.name || null
      }
    }));
    const [openMediumSevrityBugsCount]= await db.execute(
      `SELECT COUNT(*) AS count
       FROM bug_details b
        JOIN bug_statuses s ON b.status = s.id
        WHERE b.game_id = ? AND s.slug IN ('open','in_progress') AND b.severity = 2 AND b.deleted_at IS NULL`,
      [gameId]
    );
    const [openLowSevrityBugsCount]= await db.execute(
      `SELECT COUNT(*) AS count
       FROM bug_details b
        JOIN bug_statuses s ON b.status = s.id
        WHERE b.game_id = ? AND s.slug IN ('open','in_progress') AND b.severity = 1 AND b.deleted_at IS NULL`,
      [gameId]
    );
    return {
      highSeverity:enrichedRows,
      mediumSeverityCount :openMediumSevrityBugsCount[0].count || 0,
      lowSeverityCount :openLowSevrityBugsCount [0].count || 0,
    };
  }

}
export const openBugsByAssignee = async (gameId) => {

  const db = getDB();

  const [rows] = await db.execute(
    `SELECT b.assignee_id
     FROM bug_details b
     JOIN bug_statuses s ON b.status = s.id
     WHERE b.game_id = ?
     AND s.slug IN ('open','in_progress')
     AND b.deleted_at IS NULL
     AND b.assignee_id IS NOT NULL`,
    [gameId]
  );

  const counts = {};
  let total = 0;

  for (const row of rows) {
    const assignee = await getUserWithTeam(row.assignee_id);
    const name = assignee?.name;

    if (!name) continue;

    counts[name] = (counts[name] || 0) + 1;
    total++;
  }

  const assigneeCounts = Object.entries(counts).map(([assignee, count]) => ({
    assignee,
    count,
    color: getTextColorForUser(assignee),
    profile_color: getProfileColorForUser(assignee)
  }));

  return {
    total,
    data: assigneeCounts
  };
};
export const bugsByStatus = async (gameId) => {
  const db = getDB();

  const [rows] = await db.execute(
    `SELECT s.slug AS status, COUNT(*) AS count, s.name AS status_name
     FROM bug_details b
     JOIN bug_statuses s ON b.status = s.id
     WHERE b.game_id = ?
     AND s.slug IN ('open','in_review','in_progress','on_hold','closed','reopen')
     AND b.deleted_at IS NULL
     GROUP BY s.slug`,
    [gameId]
  );

  // Convert array → object
  const result = [
    { status: 'Bug Found', count: 0 },
    { status: 'In Progress', count: 0 },
    { status: 'In Review', count: 0 },
    { status: 'On Hold', count: 0 },
    { status: 'Reopened', count: 0 },
    { status: 'Closed', count: 0 }
  ]
  rows.forEach(row => {
      const found = result.find(r => r.status === row.status_name);
      if (found) {
          found.count = row.count;
      }
  });
  console.log(result,"bugs by status");
  console.log(rows,"rows");

  return result;
};