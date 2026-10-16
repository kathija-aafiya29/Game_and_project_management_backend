import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

/* =========================================
   GET SUPABASE CLIENT
========================================= */

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing in environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
};

// GET /api/last-iteration - Get next iteration (last iteration + 1) for a specific game
router.get('/last-iteration', async (req, res) => {
  const { game_name } = req.query;

  try {
    // Validate required parameter
    if (!game_name) {
      return res.status(400).json({
        success: false,
        error: 'Game name is required'
      });
    }

    console.log(`Fetching next iteration for game: ${game_name}`);

    // Get Supabase client
    const supabase = getSupabase();

    // Query to get the maximum iteration for the game
    const { data, error } = await supabase
      .from('revert')
      .select('iteration')
      .eq('game_name', game_name)
      .order('iteration', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(error.message);
    }

    let nextIteration = 1; // Default to 1 if no history exists
    
    if (data && data.length > 0 && data[0].iteration !== null) {
      // Parse iteration as integer (it might be stored as string)
      const lastIteration = parseInt(data[0].iteration) || 0;
      nextIteration = lastIteration + 1; // Calculate next iteration
    }

    console.log(`Next iteration for ${game_name}: ${nextIteration}`);

    res.json({
      success: true,
      nextIteration: nextIteration,
      message: `Next iteration: ${nextIteration}`
    });

  } catch (error) {
    console.error('Error fetching next iteration:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
});

export default router;