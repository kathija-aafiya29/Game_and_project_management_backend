
import { getDB } from "../config/db.js";
import { getUserWithTeam } from "../services/keycloack.service.js";
import { getCurrentISTForMySQL, getProfileColorForUser, getShortName, getTextColorForUser } from "./commonHelper.js";

export const logActivity = async ({
  bug_id,
  activity_type,
  activity_content,
  performed_by,
  old_value = null,
  new_value = null,
  related_comment_id = null,
  related_file = null,
}) => {
  const db = getDB();
  
  try {
    const currentTime = getCurrentISTForMySQL();
    const formattedRelatedFile =
      related_file && typeof related_file === "object"
        ? JSON.stringify(related_file)
        : related_file ?? null;

    const formattedOldValue =
      old_value && typeof old_value === "object"
        ? JSON.stringify(old_value)
        : old_value ?? null;

    const formattedNewValue =
      new_value && typeof new_value === "object"
        ? JSON.stringify(new_value)
        : new_value ?? null;

    const [result] = await db.execute(
      `
      INSERT INTO bug_activities (
        bug_id,
        activity_type,
        activity_content,
        old_value,
        new_value,
        related_comment_id,
        related_file,
        performed_by,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?,?)
      `,
      [
        bug_id,
        activity_type,
        activity_content,
        formattedOldValue,
        formattedNewValue,
        related_comment_id,
        formattedRelatedFile,
        performed_by ?? null,
        currentTime
      ]
    );

    const [rows] = await db.execute(
      `SELECT * FROM bug_activities WHERE id = ?`,
      [result.insertId]
    );

    const formattedRows = await Promise.all(
      rows.map(async (row) => {

        let userDetails = null;

        try {
          if (row.performed_by) {
            const user = await getUserWithTeam(row.performed_by);

            if (user) {
              userDetails = {
                ...user,
                short_name: getShortName(user.name),
                color: getTextColorForUser(user.name),
                profile_color: getProfileColorForUser(user.name)
              };
            }
          }
        } catch (err) {
          console.error("User fetch failed:", err.message);
        }

        let parsedFile = null;
        try {
          parsedFile = row.related_file
            ? JSON.parse(row.related_file)
            : null;
        } catch (err) {
          parsedFile = null;
        }

        return {
          ...row,
          related_file: parsedFile,
          performed_by: userDetails,
        };
      })
    );

    return formattedRows[0];

  } catch (error) {
    console.error("❌ logActivity ERROR:", error);
    throw error;
  }
};

