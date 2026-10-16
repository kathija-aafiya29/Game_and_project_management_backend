import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

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

/* ICON MAP (React will receive icon name only) */
const iconMap = {
  "Game Added": "plus",
  "Build Uploaded": "upload",
  "Build Moved to Testing": "cogs",
  "On Hold": "pause",
  "Build Deleted": "trash",
  "Phases Updated": "edit",
  "Game UI Upload": "file-upload",
  "Tester Assigned": "user-check",
  "Bugs Escalated to the Dev": "alert-octagon",
  "Game Verified": "check",
  "Game Reopened": "redo",
  "Game Download": "download",
  "Game Updated": "update",
};

/* FORMAT DATE */
function formatDate(date) {
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

router.post("/timeline", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { gameName, fromDate, toDate, filterEventType } = req.body;
    
    if (!gameName) {
      return res.status(400).json({ 
        success: false, 
        message: "gameName required" 
      });
    }

    console.log("🔍 Backend received filters:", { gameName, fromDate, toDate, filterEventType });

    const events = [];

    // Build date filters
    let dateFilter = '';
    if (fromDate && toDate) {
      dateFilter = ` AND lastupdate >= '${fromDate}' AND lastupdate <= '${toDate}'`;
    } else if (fromDate) {
      dateFilter = ` AND lastupdate >= '${fromDate}'`;
    } else if (toDate) {
      dateFilter = ` AND lastupdate <= '${toDate}'`;
    }

    // For revert table date filters
    let revertDateFilter = '';
    if (fromDate && toDate) {
      revertDateFilter = ` AND added_at >= '${fromDate}' AND added_at <= '${toDate}'`;
    } else if (fromDate) {
      revertDateFilter = ` AND added_at >= '${fromDate}'`;
    } else if (toDate) {
      revertDateFilter = ` AND added_at <= '${toDate}'`;
    }

    try {
      // 1. Game Added
      if (!filterEventType || filterEventType === 'Game Added') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'New Game Added')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Game Added',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Game Added'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: null,
              notes: row.command || null,
              url: null,
              button: null,
              color: "info"
            });
          });
        }
      }

      // 2. Build Uploaded
      if (!filterEventType || filterEventType === 'Build Uploaded') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, gameversion, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Build Uploaded')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Build Uploaded',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Build Uploaded'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: row.gameversion || null,
              notes: row.command || null,
              url: null,
              button: 'View Note',
              color: "info"
            });
          });
        }
      }

      // 3. Build Moved to Testing
      if (!filterEventType || filterEventType === 'Build Moved to Testing') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, gameversion, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Build is uploaded and moved to testing')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Build Moved to Testing',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Build Moved to Testing'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: row.gameversion || null,
              notes: row.command || null,
              url: null,
              button: 'View Note',
              color: "info"
            });
          });
        }
      }

      // 4. On Hold
      if (!filterEventType || filterEventType === 'On Hold') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'On-Hold')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'On Hold',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['On Hold'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: null,
              notes: row.command || null,
              url: null,
              button: 'View Note',
              color: "info"
            });
          });
        }
      }

      // 5. Build Deleted
      if (!filterEventType || filterEventType === 'Build Deleted') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, gameversion, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Build Deleted')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Build Deleted',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Build Deleted'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: row.gameversion || null,
              notes: row.command || null,
              url: null,
              button: null,
              color: "info"
            });
          });
        }
      }

      // 6. Phases Updated
      if (!filterEventType || filterEventType === 'Phases Updated') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Phases Updated')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Phases Updated',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Phases Updated'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: null,
              notes: row.command || null,
              url: null,
              button: null,
              color: "info"
            });
          });
        }
      }

      // 7. Game UI Upload
      if (!filterEventType || filterEventType === 'Game UI Upload') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'UIdesign_upload')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Game UI Upload',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Game UI Upload'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: null,
              notes: row.command || null,
              url: row.command || null,
              button: null,
              color: "info"
            });
          });
        }
      }

      // 8. Tester Assigned
      if (!filterEventType || filterEventType === 'Tester Assigned') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Tester Assigned')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Tester Assigned',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Tester Assigned'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: null,
              notes: row.command || null,
              url: null,
              button: null,
              color: "info"
            });
          });
        }
      }

      // 9. Bugs Escalated to Development
      if (!filterEventType || filterEventType === 'Bugs Escalated to Development') {
        const { data, error } = await supabase
          .from('revert')
          .select('added_at, tester_name, iteration, note, id')
          .eq('game_name', gameName)
          .gte('added_at', fromDate || '1970-01-01')
          .lte('added_at', toDate || '9999-12-31')
          .order('added_at', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Bugs Escalated to Development',
              raw_date: row.added_at,
              date: formatDate(row.added_at),
              icon: iconMap['Bugs Escalated to the Dev'] || 'fas fa-info-circle',
              dev: null,
              tester: row.tester_name || null,
              iteration: row.iteration || null,
              version: null,
              notes: row.note || null,
              url: null,
              button: 'View Summary',
              color: "info"
            });
          });
        }
      }

      // 10. Game Verified
      if (!filterEventType || filterEventType === 'Game Verified') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Verified')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          // Get time_taken from gameinfodetails
          const { data: gameData, error: gameError } = await supabase
            .from('gameinfodetails')
            .select('time_taken')
            .eq('name', gameName)
            .single();

          const timeTaken = gameError ? null : gameData?.time_taken;

          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Game Verified',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Game Verified'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: null,
              notes: timeTaken || null,
              url: null,
              button: null,
              color: "info"
            });
          });
        }
      }

      // 11. Game Reopened
      if (!filterEventType || filterEventType === 'Game Reopened') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Reopened')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Game Reopened',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Game Reopened'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: null,
              notes: row.command || null,
              url: null,
              button: null,
              color: "info"
            });
          });
        }
      }

      // 12. Game Download
      if (!filterEventType || filterEventType === 'Game Download') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, gameversion, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Download')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Game Download',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Game Download'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: row.gameversion || null,
              notes: row.command || null,
              url: null,
              button: null,
              color: "info"
            });
          });
        }
      }

      // 13. Game Updated
      if (!filterEventType || filterEventType === 'Game Updated') {
        const { data, error } = await supabase
          .from('builduser')
          .select('lastupdate, username, command, id')
          .eq('gamename', gameName)
          .eq('useraction', 'Game Updated')
          .gte('lastupdate', fromDate || '1970-01-01')
          .lte('lastupdate', toDate || '9999-12-31')
          .order('lastupdate', { ascending: false });

        if (!error && data) {
          data.forEach(row => {
            events.push({
              id: row.id,
              type: 'Game Updated',
              raw_date: row.lastupdate,
              date: formatDate(row.lastupdate),
              icon: iconMap['Game Updated'] || 'fas fa-info-circle',
              dev: row.username || null,
              tester: null,
              iteration: null,
              version: null,
              notes: row.command || null,
              url: null,
              button: 'View Note',
              color: "info"
            });
          });
        }
      }

    } catch (queryError) {
      console.error(`Query error:`, queryError);
    }

    /* Sort latest first */
    events.sort((a, b) => new Date(b.raw_date) - new Date(a.raw_date));

    console.log(`✅ Found ${events.length} events for game: ${gameName} with filters:`, { fromDate, toDate, filterEventType });

    return res.json({ 
      success: true, 
      data: events
    });

  } catch (err) {
    console.error("❌ Timeline API Error:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Server error", 
      error: err.message 
    });
  }
});

export default router;