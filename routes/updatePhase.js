const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Supabase configuration
const getSupabaseConfig = () => {
  // You can get these from environment variables or config
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials are missing');
  }
  
  return { supabaseUrl, supabaseKey };
};

const getSupabase = () => {
  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  return createClient(supabaseUrl, supabaseKey);
};

const getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30 in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

// POST /api/update-phase - Update game phase
router.post('/update-phase', async (req, res) => {
  const { gameName, phase, username, email } = req.body;

  try {
    // Validate required parameters
    if (!gameName || !phase || !username || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: gameName, phase, username, email'
      });
    }

    console.log(`Updating phase for game: ${gameName} to: ${phase} by user: ${username}`);
    const supabase = getSupabase();

    // Update phase in gameinfodetails table
    const { error: updateError } = await supabase
      .from('gameinfodetails')
      .update({ gamelabel: phase })
      .eq('name', gameName);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Insert into builduser table for audit trail
    const currentTime = getCurrentISTForMySQL();
    const command = `Phase updated to: ${phase}`;
    
    const { error: insertError } = await supabase
      .from('builduser')
      .insert({
        gamename: gameName,
        username: username,
        email: email,
        command: command,
        useraction: 'Phase Updated',
        lastupdate: currentTime
      });

    if (insertError) {
      throw new Error(insertError.message);
    }

    res.json({
      success: true,
      message: 'Phase updated successfully',
      data: {
        gameName,
        newPhase: phase
      }
    });

  } catch (error) {
    console.error('Error updating phase:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
});

module.exports = router;