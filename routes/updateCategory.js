const express = require('express');
const router = express.Router();
const { getDB } = require('../config/db');

const getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30 in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

// POST /api/update-category - Update game category
router.post('/update-category', async (req, res) => {
  const { gameName, category, username, email } = req.body;

  try {
    // Validate required parameters
    if (!gameName || !category || !username || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: gameName, category, username, email'
      });
    }

    console.log(`Updating category for game: ${gameName} to: ${category} by user: ${username}`);
    const db = getDB();

    // Update category in gameinfodetails table
    const updateQuery = `
      UPDATE gameinfodetails 
      SET gamecategory = ? 
      WHERE name = ?
    `;
    await db.execute(updateQuery, [category, gameName]);

    // Insert into builduser table for audit trail
    const currentTime = getCurrentISTForMySQL();
    const buildUserQuery = `
      INSERT INTO builduser (gamename, username, email, command, useraction, lastupdate) 
      VALUES (?, ?, ?, ?, 'Category Updated', ?)
    `;
    const command = `Category updated to: ${category}`;
    await db.execute(buildUserQuery, [gameName, username, email, command, currentTime]);

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: {
        gameName,
        newCategory: category
      }
    });

  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
});

module.exports = router;