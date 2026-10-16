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

const getCurrentIST = () => {
  const now = new Date();
  // Get IST time by formatting with timezone
  const istTime = now.toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata'
  });
  return new Date(istTime).toISOString();
};

// GET /api/ip-access - Fetch all IP addresses
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    
    const { data, error } = await supabase
      .from('allowed_ips')
      .select('ip_address, description')
      .order('ip_address', { ascending: true });
    
    if (error) throw error;
    
    // Transform data for frontend
    const ipData = data.map((item, index) => ({
      id: index + 1,
      ip: item.ip_address,
      description: item.description
    }));

    res.json({
      success: true,
      data: ipData,
      message: 'IP addresses fetched successfully'
    });

  } catch (error) {
    console.error('Error fetching IP addresses:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// POST /api/ip-access - Add new IP address
router.post('/', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { ip, description, username, email } = req.body;

    if (!ip || !description) {
      return res.status(400).json({
        success: false,
        message: 'Both IP address and description are required'
      });
    }

    // Validate IP address format
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IP address format'
      });
    }

    const currentTime = getCurrentIST();

    // Insert into allowed_ips table
    const { error: insertError } = await supabase
      .from('allowed_ips')
      .insert([{ 
        ip_address: ip, 
        description: description 
      }]);

    if (insertError) {
      // Handle duplicate IP address
      if (insertError.code === '23505') { // PostgreSQL duplicate key error code
        return res.status(400).json({
          success: false,
          message: 'IP address already exists'
        });
      }
      throw insertError;
    }

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: ip,
        username: username,
        email: email,
        command: description,
        useraction: 'IPs Access Added',
        lastupdate: currentTime
      }]);

    if (logError) throw logError;

    res.json({
      success: true,
      message: 'IP address added successfully'
    });

  } catch (error) {
    console.error('Error adding IP address:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error adding IP address',
      error: error.message
    });
  }
});

// PUT /api/ip-access/:oldIp - Update IP address
router.put('/:oldIp', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { oldIp } = req.params;
    const { newIp, description, username, email } = req.body;

    if (!newIp || !description) {
      return res.status(400).json({
        success: false,
        message: 'Both IP address and description are required'
      });
    }

    // Validate IP address format
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(newIp)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid IP address format'
      });
    }

    const currentTime = getCurrentIST();

    // Update the IP address
    const { error: updateError } = await supabase
      .from('allowed_ips')
      .update({ 
        ip_address: newIp, 
        description: description 
      })
      .eq('ip_address', oldIp);

    if (updateError) {
      // Handle duplicate IP address
      if (updateError.code === '23505') {
        return res.status(400).json({
          success: false,
          message: 'IP address already exists'
        });
      }
      throw updateError;
    }

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: newIp,
        username: username,
        email: email,
        command: description,
        useraction: 'IPs Access Updated',
        lastupdate: currentTime
      }]);

    if (logError) throw logError;

    res.json({
      success: true,
      message: 'IP address updated successfully'
    });

  } catch (error) {
    console.error('Error updating IP address:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error updating IP address',
      error: error.message
    });
  }
});

// DELETE /api/ip-access/:ip - Delete IP address
router.delete('/:ip', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { ip } = req.params;
    const { reason, username, email } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Reason is required for deletion'
      });
    }

    const currentTime = getCurrentIST();

    // Delete from allowed_ips table
    const { error: deleteError } = await supabase
      .from('allowed_ips')
      .delete()
      .eq('ip_address', ip);

    if (deleteError) throw deleteError;

    // Log the action in builduser table
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: ip,
        username: username,
        email: email,
        command: reason,
        useraction: 'IPs Access Deleted',
        lastupdate: currentTime
      }]);

    if (logError) throw logError;

    res.json({
      success: true,
      message: 'IP address deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting IP address:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting IP address',
      error: error.message
    });
  }
});

export default router;