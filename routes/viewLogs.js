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

// GET /api/view-logs - Fetch logs with filters and pagination
router.get('/', async (req, res) => {
  try {
    const supabase = getSupabase();

    // User mapping data
    const userMapping = [
      { "name": "Abuthahir A", "email": "abuthahir@theunitytech.com", "short_name": "AA" },
      { "name": "Abhinav Singh", "email": "abhinav@theunitytech.com", "short_name": "AS" },
      { "name": "Akashvel m", "email": "akashvel@theunitytech.com", "short_name": "AM" },
      { "name": "akil sw", "email": "akileswar@theunitytech.com", "short_name": "AS" },
      { "name": "Amal K P", "email": "amal@theunitytech.com", "short_name": "AP" },
      { "name": "Anjali Priya", "email": "anjalipriya@theunitytech.com", "short_name": "AP" },
      { "name": "Aparna Ashok", "email": "aparna.a@theunitytech.com", "short_name": "AA" },
      { "name": "Arun m", "email": "arun.m@theunitytech.com", "short_name": "AM" },
      { "name": "Vipin Sharma", "email": "vipinsharma.r@theunitytech.com", "short_name": "VS" },
      { "name": "Deepika s", "email": "deepika.s@theunitytech.com", "short_name": "DS" },
      { "name": "Dhinesh Vinayak G", "email": "dhineshvinayak@theunitytech.com", "short_name": "DG" },
      { "name": "Gibson Sam", "email": "gibsonvictor@theunitytech.com", "short_name": "GS" },
      { "name": "Immaculain g", "email": "immaculain@theunitytech.com", "short_name": "IG" },
      { "name": "Karthick Periasami", "email": "karthick.p@theunitytech.com", "short_name": "KP" },
      { "name": "Kavin S", "email": "kavin.s@theunitytech.com", "short_name": "KS" },
      { "name": "Manikandan g", "email": "manikandan@theunitytech.com", "short_name": "MG" },
      { "name": "Meera R", "email": "meera.r@theunitytech.com", "short_name": "MR" },
      { "name": "Ameen Mhd", "email": "mohammedameen.ot@theunitytech.com", "short_name": "AM" },
      { "name": "Muthuvelraj Kumaran", "email": "muthuvelraj.k@theunitytech.com", "short_name": "MK" },
      { "name": "Nathishma N", "email": "nathishma.n@theunitytech.com", "short_name": "NN" },
      { "name": "Pushkal Sharma", "email": "pushkal@theunitytech.com", "short_name": "PS" },
      { "name": "Rajesh Kanna", "email": "rajeshkanna.s@theunitytech.com", "short_name": "RK" },
      { "name": "Ram prasath", "email": "ramprasath.r@theunitytech.com", "short_name": "RP" },
      { "name": "Rathna Vel S", "email": "rathnavel@theunitytech.com", "short_name": "RS" },
      { "name": "Sahil Nandal", "email": "sahil.s@theunitytech.com", "short_name": "SN" },
      { "name": "Sankarganesh R", "email": "sankarganesh@theunitytech.com", "short_name": "SR" },
      { "name": "saru saravanan", "email": "saravanant@theunitytech.com", "short_name": "SS" },
      { "name": "Ida Scader", "email": "scader.ida@theunitytech.com", "short_name": "IS" },
      { "name": "Shivaji R", "email": "shivaji.r@theunitytech.com", "short_name": "SR" },
      { "name": "Sivaprasath K", "email": "sivaprasath.k@theunitytech.com", "short_name": "SK" },
      { "name": "Mrr Rrrr", "email": "vipinsharmagwl59@gmail.com", "short_name": "MR" },
      { "name": "Vaishnavi  Saravanan", "email": "vaishnavi.s@theunitytech.com", "short_name": "VS" },
      { "name": "Varsha Viswanathan", "email": "varsha.v@theunitytech.com", "short_name": "VV" },
      { "name": "Vimal S", "email": "vimal.s@theunitytech.com", "short_name": "VS" },
      { "name": "Vishaal Premkumar", "email": "vishaalpremkumar@theunitytech.com", "short_name": "VP" }
    ];

    // Helper function to get user details by email
    function getUserDetailsByEmail(email) {
      const user = userMapping.find(u => u.email === email);
      if (user) {
        return {
          fullname: user.name,
          short_name: user.short_name
        };
      }
      return {
        fullname: email || "Unknown",
        short_name: email ? email.substring(0, 2).toUpperCase() : "UN"
      };
    }

    // Get filter parameters
    const {
      gamename,
      useraction,
      startdate,
      enddate,
      email,
      page = 1,
      limit = 20
    } = req.query;

    const currentPage = parseInt(page);
    const rowsPerPage = parseInt(limit);
    const offset = (currentPage - 1) * rowsPerPage;

    let combinedLogs = [];
    let totalRows = 0;
    let actions = [];

    // Check if we need to show only revert data (Bugs Escalated to Development)
    // Important: Check useraction first, regardless of when gamename was selected
    const showOnlyRevert = useraction === 'Bugs Escalated to Development';
    const showOnlyBuilduser = useraction && useraction !== 'Bugs Escalated to Development';
    const showBoth = !useraction || useraction === '';

    if (showOnlyRevert) {
      // ONLY fetch from revert table with ALL filters (including gamename)
      let query = supabase
        .from('revert')
        .select('id, tester_name, tester_email, game_name, note, added_at', { count: 'exact' });

      // Add gamename filter for revert table (using game_name column)
      if (gamename && gamename !== '') {
        query = query.eq('game_name', gamename);
      }

      if (startdate && startdate !== '') {
        query = query.gte('added_at', startdate);
      }

      if (enddate && enddate !== '') {
        query = query.lte('added_at', enddate);
      }

      if (email && email !== '') {
        query = query.ilike('tester_email', `%${email}%`);
      }

      // Get total count
      const { count, error: countError } = await query;
      
      if (countError) throw countError;
      
      totalRows = count || 0;
      const totalPages = Math.ceil(totalRows / rowsPerPage);

      // Get paginated data
      const { data: revertLogs, error: dataError } = await query
        .order('added_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + rowsPerPage - 1);

      if (dataError) throw dataError;

      combinedLogs = (revertLogs || []).map(log => ({
        id: log.id,
        username: log.tester_name,
        email: log.tester_email,
        gamename: log.game_name,
        bug_name: null,
        command: log.note,
        useraction: 'Bugs Escalated to Development',
        lastupdate: log.added_at,
        source: 'revert'
      }));

      // Format dates and add user details
      const formattedLogs = combinedLogs.map(log => {
        return {
          ...log,
          date_time: formatDateForDisplay(log.lastupdate),
          user_fullname: log.username || "Unknown",
          user_short_name: log.username ? log.username.substring(0, 2).toUpperCase() : "UN"
        };
      });

      // Get unique values for filters
      const { data: gamesData } = await supabase
        .from('gameinfodetails')
        .select('name')
        .order('name', { ascending: true });

      const { data: builduserActionsData } = await supabase
        .from('builduser')
        .select('useraction')
        .not('useraction', 'is', null)
        .neq('useraction', '')
        .order('useraction', { ascending: true });

      actions = [...(builduserActionsData || []).map(a => a.useraction), 'Bugs Escalated to Development'];
      actions.sort();

      return res.json({
        success: true,
        data: {
          logs: formattedLogs,
          pagination: {
            currentPage,
            totalPages,
            totalRows,
            rowsPerPage,
            showing: formattedLogs.length
          },
          filters: {
            games: (gamesData || []).map(g => g.name),
            actions: actions
          }
        },
        message: 'Logs fetched successfully'
      });

    } else if (showOnlyBuilduser) {
      // ONLY fetch from builduser table
      let query = supabase
        .from('builduser')
        .select('id, username, email, gamename, bug_name, command, useraction, lastupdate', { count: 'exact' });

      if (gamename && gamename !== '') {
        query = query.eq('gamename', gamename);
      }

      if (useraction && useraction !== '') {
        query = query.eq('useraction', useraction);
      }

      if (startdate && startdate !== '') {
        query = query.gte('lastupdate', startdate);
      }

      if (enddate && enddate !== '') {
        query = query.lte('lastupdate', enddate);
      }

      if (email && email !== '') {
        query = query.ilike('email', `%${email}%`);
      }

      // Get total count
      const { count, error: countError } = await query;
      
      if (countError) throw countError;
      
      totalRows = count || 0;
      const totalPages = Math.ceil(totalRows / rowsPerPage);

      // Get paginated data
      const { data: builduserLogs, error: dataError } = await query
        .order('lastupdate', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + rowsPerPage - 1);

      if (dataError) throw dataError;

      combinedLogs = (builduserLogs || []).map(log => ({
        ...log,
        source: 'builduser'
      }));

      // Format dates and add user details
      const formattedLogs = combinedLogs.map(log => {
        const userDetails = getUserDetailsByEmail(log.email);
        return {
          ...log,
          date_time: formatDateForDisplay(log.lastupdate),
          user_fullname: userDetails.fullname,
          user_short_name: userDetails.short_name
        };
      });

      // Get unique values for filters
      const { data: gamesData } = await supabase
        .from('gameinfodetails')
        .select('name')
        .order('name', { ascending: true });

      const { data: builduserActionsData } = await supabase
        .from('builduser')
        .select('useraction')
        .not('useraction', 'is', null)
        .neq('useraction', '')
        .order('useraction', { ascending: true });

      actions = [...(builduserActionsData || []).map(a => a.useraction), 'Bugs Escalated to Development'];
      actions.sort();

      return res.json({
        success: true,
        data: {
          logs: formattedLogs,
          pagination: {
            currentPage,
            totalPages,
            totalRows,
            rowsPerPage,
            showing: formattedLogs.length
          },
          filters: {
            games: (gamesData || []).map(g => g.name),
            actions: actions
          }
        },
        message: 'Logs fetched successfully'
      });

    } else {
      // Show BOTH tables (when no action filter or empty action filter)
      // Build query for builduser
      let builduserQuery = supabase
        .from('builduser')
        .select('id, username, email, gamename, bug_name, command, useraction, lastupdate', { count: 'exact' });

      if (gamename && gamename !== '') {
        builduserQuery = builduserQuery.eq('gamename', gamename);
      }

      if (startdate && startdate !== '') {
        builduserQuery = builduserQuery.gte('lastupdate', startdate);
      }

      if (enddate && enddate !== '') {
        builduserQuery = builduserQuery.lte('lastupdate', enddate);
      }

      if (email && email !== '') {
        builduserQuery = builduserQuery.ilike('email', `%${email}%`);
      }

      // Get total count for builduser
      const { count: builduserTotalRows, error: builduserCountError } = await builduserQuery;
      
      if (builduserCountError) throw builduserCountError;

      // Build query for revert
      let revertQuery = supabase
        .from('revert')
        .select('id, tester_name, tester_email, game_name, note, added_at', { count: 'exact' });

      if (gamename && gamename !== '') {
        revertQuery = revertQuery.eq('game_name', gamename);
      }

      if (startdate && startdate !== '') {
        revertQuery = revertQuery.gte('added_at', startdate);
      }

      if (enddate && enddate !== '') {
        revertQuery = revertQuery.lte('added_at', enddate);
      }

      if (email && email !== '') {
        revertQuery = revertQuery.ilike('tester_email', `%${email}%`);
      }

      // Get total count for revert
      const { count: revertTotalRows, error: revertCountError } = await revertQuery;
      
      if (revertCountError) throw revertCountError;

      totalRows = (builduserTotalRows || 0) + (revertTotalRows || 0);
      const totalPages = Math.ceil(totalRows / rowsPerPage);

      // Fetch builduser data
      let builduserLogs = [];
      if (builduserTotalRows > 0 && offset < builduserTotalRows) {
        const { data, error } = await builduserQuery
          .order('lastupdate', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + rowsPerPage - 1);

        if (!error && data) {
          builduserLogs = data.map(log => ({
            ...log,
            source: 'builduser'
          }));
        }
      }

      // Fetch revert data if needed
      let revertLogs = [];
      if (revertTotalRows > 0) {
        const remainingNeeded = rowsPerPage - builduserLogs.length;
        if (remainingNeeded > 0) {
          let revertOffset = 0;
          if (offset >= builduserTotalRows) {
            revertOffset = offset - builduserTotalRows;
          } else if (builduserLogs.length < rowsPerPage) {
            revertOffset = 0;
          } else {
            revertOffset = -1;
          }

          if (revertOffset >= 0) {
            const { data, error } = await revertQuery
              .order('added_at', { ascending: false })
              .order('id', { ascending: false })
              .range(revertOffset, revertOffset + remainingNeeded - 1);

            if (!error && data) {
              revertLogs = data.map(log => ({
                id: log.id,
                username: log.tester_name,
                email: log.tester_email,
                gamename: log.game_name,
                bug_name: null,
                command: log.note,
                useraction: 'Bugs Escalated to Development',
                lastupdate: log.added_at,
                source: 'revert'
              }));
            }
          }
        }
      }

      combinedLogs = [...builduserLogs, ...revertLogs];
      
      // Sort combined logs by lastupdate descending
      combinedLogs.sort((a, b) => {
        const dateA = new Date(a.lastupdate);
        const dateB = new Date(b.lastupdate);
        if (dateB.getTime() === dateA.getTime()) {
          return b.id - a.id;
        }
        return dateB - dateA;
      });

      // Format dates and add user details
      const formattedLogs = combinedLogs.map(log => {
        if (log.source === 'revert') {
          return {
            ...log,
            date_time: formatDateForDisplay(log.lastupdate),
            user_fullname: log.username || "Unknown",
            user_short_name: log.username ? log.username.substring(0, 2).toUpperCase() : "UN"
          };
        } else {
          const userDetails = getUserDetailsByEmail(log.email);
          return {
            ...log,
            date_time: formatDateForDisplay(log.lastupdate),
            user_fullname: userDetails.fullname,
            user_short_name: userDetails.short_name
          };
        }
      });

      // Get unique values for filters
      const { data: gamesData } = await supabase
        .from('gameinfodetails')
        .select('name')
        .order('name', { ascending: true });

      const { data: builduserActionsData } = await supabase
        .from('builduser')
        .select('useraction')
        .not('useraction', 'is', null)
        .neq('useraction', '')
        .order('useraction', { ascending: true });

      actions = [...(builduserActionsData || []).map(a => a.useraction), 'Bugs Escalated to Development'];
      actions.sort();

      return res.json({
        success: true,
        data: {
          logs: formattedLogs,
          pagination: {
            currentPage,
            totalPages,
            totalRows,
            rowsPerPage,
            showing: formattedLogs.length
          },
          filters: {
            games: (gamesData || []).map(g => g.name),
            actions: actions
          }
        },
        message: 'Logs fetched successfully'
      });
    }

  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Helper function to format date
function formatDateForDisplay(dateString) {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export default router;