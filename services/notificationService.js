import { getDB } from "../config/db.js";
import { getCurrentISTForMySQL } from "../helpers/commonHelper.js";

export async function createNotification({
  userId,
  type,
  title,
  message,
  context = null,
  sourceId = null,
  environment = "internal",
}) {
  try {
    const db = getDB();

    const [result] = await db.query(
      `INSERT INTO notifications
       (user_id, type, title, message, context, source_id, environment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        type,
        title,
        message,
        context ? JSON.stringify(context) : null,
        sourceId,
        environment,
        getCurrentISTForMySQL(),
      ]
    );

    return result.insertId; // ✅ return insert ID

  } catch (error) {
    console.error("❌ Notification insert failed:", error);
    return null;
  }
}