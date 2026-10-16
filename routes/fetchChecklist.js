// routes/checklist.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

/* =========================================
   SUPABASE CONFIG
========================================= */

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing in environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
};

// GET /api/checklist - Get checklist items by category
router.get('/checklist', async (req, res) => {
  const { category } = req.query;

  try {
    // Validate required parameter
    if (!category) {
      return res.status(400).json({
        success: false,
        error: 'Category is required'
      });
    }

    console.log(`Fetching checklist for category: ${category}`);

    // Get Supabase client
    const supabase = getSupabase();

    // Query to get checklist items for the category
    const { data: rows, error } = await supabase
      .from('ChecklistAddition')
      .select('ChecklistCase, Severity')
      .eq('Cat_name', category);

    if (error) {
      throw new Error(error.message);
    }

    console.log(`Found ${rows.length} checklist items for category: ${category}`);

    res.json(rows);

  } catch (error) {
    console.error('Error fetching checklist:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
});

export default router;