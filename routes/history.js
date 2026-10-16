import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

/* =========================================
   SUPABASE CLIENT
========================================= */

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing. Please check your .env file.");
  }

  return createClient(supabaseUrl, supabaseKey);
};

// GET /api/history - Get testing history for a specific game
router.get('/history', async (req, res) => {
  const { game_name } = req.query;

  try {
    // Validate required parameter
    if (!game_name) {
      return res.status(400).json({
        success: false,
        error: 'Game name is required'
      });
    }

    console.log(`Fetching history for game: ${game_name}`);

    // Get Supabase client
    const supabase = getSupabase();

    // Query to get history from revert table
    const { data, error } = await supabase
      .from('revert')
      .select(`
        tester_name,
        note,
        added_at,
        total_test_cases,
        test_cases_passed,
        failed_cases,
        major,
        minor,
        medium,
        pending,
        hold,
        reopened,
        new_bugs,
        closed_bugs,
        iteration,
        test_case_link
      `)
      .eq('game_name', game_name)
      .order('id', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    console.log(`Found ${data?.length || 0} history records for game: ${game_name}`);

    res.json({
      success: true,
      history: data || []
    });

  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
});

export default router;