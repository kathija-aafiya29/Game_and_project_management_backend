import express from 'express';
import { createClient } from '@supabase/supabase-js';

import { getDBConfig, getS3Config } from '../config/config.js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

/* =========================================
   SUPABASE CONFIG
========================================= */

const getSupabaseConfig = () => {
  const config = getDBConfig();

  if (!config) {
    throw new Error(
      "DB Config not loaded. Call loadSecrets() first."
    );
  }

  return {
    supabaseUrl: config.SUPABASE_URL || process.env.SUPABASE_URL,
    supabaseKey: config.SUPABASE_KEY || process.env.SUPABASE_KEY,
  };
};

/* =========================================
   GET SUPABASE CLIENT
========================================= */

const getSupabase = () => {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing");
  }

  return createClient(supabaseUrl, supabaseKey);
};

/* =========================================
   HELPER: GET CURRENT IST TIME
========================================= */

const getCurrentISTForSupabase = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30 in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString();
};

/* =========================================
   UPDATE TESTER API
========================================= */

// POST /api/update-tester - Update game tester
router.post('/update-tester', async (req, res) => {
  const { gameName, tester, username, email } = req.body;

  try {
    // Validate required parameters
    if (!gameName || !tester || !username || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: gameName, tester, username, email'
      });
    }

    console.log(`Updating tester for game: ${gameName} to: ${tester} by user: ${username}`);
    const supabase = getSupabase();

    // Update tester in gameinfodetails table
    const { error: updateError } = await supabase
      .from('gameinfodetails')
      .update({ gameassignee: tester })
      .eq('name', gameName);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Insert into builduser table for audit trail
    const currentTime = getCurrentISTForSupabase();
    const command = `Tester updated to: ${tester}`;
    
    const { error: insertError } = await supabase
      .from('builduser')
      .insert([
        {
          gamename: gameName,
          username: username,
          email: email,
          command: command,
          useraction: 'Tester Updated',
          lastupdate: currentTime
        }
      ]);

    if (insertError) {
      throw new Error(insertError.message);
    }

    res.json({
      success: true,
      message: 'Tester updated successfully',
      data: {
        gameName,
        newTester: tester
      }
    });

  } catch (error) {
    console.error('Error updating tester:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
});

export default router;