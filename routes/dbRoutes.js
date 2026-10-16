import express from "express";
import { getDB } from "../config/db.js";

const router = express.Router();

// Get all games
router.get("/games", async (req, res) => {
  const db = getDB();
  try {
    const [rows] = await db.query("SELECT * FROM gameinfodetails");
    res.json(rows);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

// Get active games
router.get("/activegames", async (req, res) => {
  const db = getDB();
  try {
    const [rows] = await db.query("SELECT * FROM gameinfodetails where isgameactive = 1");
    res.json(rows);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

// Get bug counts by status for a specific game
// Status mapping: 3 = In Review, 4 = On Hold
router.get("/bug-counts/:gameId", async (req, res) => {
  const db = getDB();
  try {
    const { gameId } = req.params;
    
    // Query to count bugs by status (only active bugs where deleted_at is NULL)
    const [rows] = await db.query(
      `SELECT 
         SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) as in_review_count,
         SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END) as on_hold_count
       FROM bug_details 
       WHERE game_id = ?
         AND deleted_at IS NULL`,
      [gameId]
    );
    
    const result = rows[0] || { in_review_count: 0, on_hold_count: 0 };
    
    res.json({
      success: true,
      data: {
        inReview: parseInt(result.in_review_count) || 0,
        onHold: parseInt(result.on_hold_count) || 0
      }
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch bug counts" 
    });
  }
});

// Get detailed bug information with counts and bug IDs
// Status mapping: 3 = In Review, 4 = On Hold
router.get("/bug-details/:gameId", async (req, res) => {
  const db = getDB();
  try {
    const { gameId } = req.params;
    
    // Get detailed bug information by status (only active bugs)
    const [rows] = await db.query(
      `SELECT 
         status,
         COUNT(*) as count,
         GROUP_CONCAT(bug_id) as bug_ids
       FROM bug_details 
       WHERE game_id = ? 
         AND status IN (3, 4)
         AND deleted_at IS NULL
       GROUP BY status`,
      [gameId]
    );
    
    const result = {
      inReview: { count: 0, bugIds: [] },
      onHold: { count: 0, bugIds: [] }
    };
    
    rows.forEach(row => {
      if (row.status === 3) {
        result.inReview = {
          count: row.count,
          bugIds: row.bug_ids ? row.bug_ids.split(',') : []
        };
      } else if (row.status === 4) {
        result.onHold = {
          count: row.count,
          bugIds: row.bug_ids ? row.bug_ids.split(',') : []
        };
      }
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch bug details" 
    });
  }
});

export default router;