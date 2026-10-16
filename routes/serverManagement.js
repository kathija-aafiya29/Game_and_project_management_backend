import express from 'express';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { getSMTPConfig } from "../config/config.js";
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

const getSMTPConfigs = () => {
  const smtp = getSMTPConfig();
  return {
    SMTP_HOST: smtp.SMTP_HOST,
    SMTP_PORT: smtp.SMTP_PORT,
    SMTP_USER: smtp.SMTP_USER,
    SMTP_PASS: smtp.SMTP_PASS,
    SMTP_FROM: smtp.SMTP_FROM,
    BASE_URL: smtp.BASE_URL
  };
};

// Validate IP
const isValidIP = (ip) => {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;
  return ip.split(".").every(num => Number(num) >= 0 && Number(num) <= 255);
};

const getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace("T", " ");
};

// Format date for email
const formatDateForEmail = (dateString) => {
  const date = new Date(dateString);

  const options = {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  };

  const parts = new Intl.DateTimeFormat('en-IN', options).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  return `${get('day')}/${get('month')}/${get('year')} , ${get('hour')}:${get('minute')}:${get('second')} ${get('dayPeriod')}`;
};


// Validate CloudFront URL format
const isValidCloudFrontUrl = (url) => {
  if (!url) return false;
  // Must start with https://
  if (!url.startsWith('https://')) return false;
  // Must contain .cloudfront.net
  if (!url.includes('.cloudfront.net')) return false;
  return true;
};

// Helper to parse assigned_games JSON array from text field
const parseAssignedGames = (text) => {
  if (!text || text.trim() === '') return [];

  try {
    // If it's already a JSON array string
    if (text.trim().startsWith('[')) {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    }

    // If it's already an array
    if (Array.isArray(text)) {
      return text;
    }

    return [];
  } catch (err) {
    console.log("Error parsing assigned_games:", text, err);
    return [];
  }
};

// Helper to format array to JSON string for database
const formatAssignedGamesForDB = (array) => {
  if (!Array.isArray(array) || array.length === 0) return '[]';

  // Filter out empty/null values
  const filteredArray = array
    .map(id => {
      if (typeof id === 'string') return id.trim();
      return id;
    })
    .filter(id => id && id !== '');

  // Return as JSON array string
  return JSON.stringify(filteredArray);
};

// Helper to parse game types (comma-separated string to array)
const parseGameTypes = (gameTypeData) => {
  console.log("parseGameTypes input:", gameTypeData, "Type:", typeof gameTypeData);

  if (!gameTypeData) {
    console.log("No gameTypeData provided");
    return [];
  }

  try {
    // If it's already an array, return it
    if (Array.isArray(gameTypeData)) {
      console.log("Already an array, returning:", gameTypeData);
      return gameTypeData.filter(item => item && item.toString().trim() !== '');
    }

    // Convert to string
    const stringValue = gameTypeData.toString();
    console.log("Converted to string:", stringValue);

    // Split by comma and clean up
    const result = stringValue
      .split(',')
      .map(item => item.trim())
      .filter(item => item !== '');

    console.log("Result after splitting:", result);
    return result;

  } catch (error) {
    console.error("Error in parseGameTypes:", error);
    return [];
  }
};

// Update gameinfodetails table with server URL and port
const updateGameServerInfo = async (gameIds, serverUrl, serverPort, supabase) => {
  try {
    if (!Array.isArray(gameIds) || gameIds.length === 0 || !serverUrl || !serverPort) {
      console.log("Invalid parameters for updateGameServerInfo");
      return;
    }

    console.log(`Updating ${gameIds.length} games with server URL: ${serverUrl}, port: ${serverPort}`);

    // Update each game's server_url and server_port
    for (const gameId of gameIds) {
      if (gameId && gameId.trim() !== '') {
        const { error } = await supabase
          .from('gameinfodetails')
          .update({ 
            server_url: serverUrl, 
            server_port: serverPort 
          })
          .eq('id', gameId)
          .eq('isgameactive', 1);

        if (error) {
          console.error(`Error updating game ${gameId}:`, error);
          throw error;
        }
        console.log(`Updated game ${gameId} with server URL and port`);
      }
    }
  } catch (error) {
    console.error("Error updating game server info:", error);
    throw error;
  }
};

// Remove server URL and port from games when CloudFront is deleted
const removeGameServerInfo = async (gameIds, supabase) => {
  try {
    if (!Array.isArray(gameIds) || gameIds.length === 0) {
      console.log("No game IDs provided for removal");
      return;
    }

    console.log(`Removing server info from ${gameIds.length} games`);

    // Set server_url and server_port to NULL for each game
    for (const gameId of gameIds) {
      if (gameId && gameId.trim() !== '') {
        const { error } = await supabase
          .from('gameinfodetails')
          .update({ 
            server_url: null, 
            server_port: null 
          })
          .eq('id', gameId)
          .eq('isgameactive', 1);

        if (error) {
          console.error(`Error removing server info from game ${gameId}:`, error);
          throw error;
        }
        console.log(`Removed server info from game ${gameId}`);
      }
    }
  } catch (error) {
    console.error("Error removing game server info:", error);
    throw error;
  }
};

// Get previously assigned games for a CloudFront
const getPreviouslyAssignedGames = async (cloudfrontId, supabase) => {
  try {
    const { data, error } = await supabase
      .from('cloudfront_configurations')
      .select('assigned_games')
      .eq('id', cloudfrontId)
      .single();

    if (error) throw error;

    if (data) {
      return parseAssignedGames(data.assigned_games);
    }
    return [];
  } catch (error) {
    console.error("Error getting previously assigned games:", error);
    return [];
  }
};

// Helper function to get game names from IDs
const getGameNamesFromIds = async (gameIds, supabase) => {
  try {
    if (!Array.isArray(gameIds) || gameIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from('gameinfodetails')
      .select('id, name')
      .in('id', gameIds)
      .eq('isgameactive', 1);

    if (error) throw error;

    return data.map(row => row.name);
  } catch (error) {
    console.error("Error getting game names:", error);
    return [];
  }
};

// Send email notification function
const sendCloudFrontEmail = async (action, serverName, cloudfrontUrl, port, assignedGames, username, email, isEdit = false, oldData = null) => {
  try {
    // Create transporter
   const smtp = getSMTPConfigs()
    
        // Email transporter configuration
    const transporter = nodemailer.createTransport({
      host: smtp.SMTP_HOST,
      port: smtp.SMTP_PORT,
      secure: false,
      auth: {
        user: smtp.SMTP_USER,
        pass: smtp.SMTP_PASS
      }
    });

    const labgame = "CloudFront Management";
    const name = serverName;
    const formattedLastUpdate = formatDateForEmail(new Date());
    
    // Prepare assigned games display
    let assignedGamesHTML = '';
    if (assignedGames && assignedGames.length > 0) {
      assignedGamesHTML = assignedGames.map(game => `<div style="margin: 2px 0; padding: 3px 8px; background: #f0f8ff; border-radius: 4px; display: inline-block; margin-right: 5px;">${game}</div>`).join('');
    } else {
      assignedGamesHTML = '<div style="color: #666; font-style: italic;">No games assigned</div>';
    }

    // Prepare edited fields HTML for update
    let editedFieldsHTML = '';
    if (isEdit && oldData) {
      editedFieldsHTML = `
        <div style="background: #fff8e1; border: 1px solid #ffd54f; border-radius: 4px; padding: 10px; margin: 10px 0;">
          <p style="margin: 0 0 5px 0; color: #e65100; font-weight: bold;">Previous Values:</p>
          <p style="margin: 2px 0;"><strong>CloudFront URL:</strong> ${oldData.cloudfront_url || 'N/A'}</p>
          <p style="margin: 2px 0;"><strong>Port:</strong> ${oldData.port || 'N/A'}</p>
          <p style="margin: 2px 0;"><strong>Assigned Games:</strong> ${oldData.assignedGamesNames ? oldData.assignedGamesNames.join(', ') : 'N/A'}</p>
        </div>
        <div style="background: #e8f5e9; border: 1px solid #4caf50; border-radius: 4px; padding: 10px; margin: 10px 0;">
          <p style="margin: 0 0 5px 0; color: #2e7d32; font-weight: bold;">New Values:</p>
          <p style="margin: 2px 0;"><strong>CloudFront URL:</strong> ${cloudfrontUrl}</p>
          <p style="margin: 2px 0;"><strong>Port:</strong> ${port}</p>
          <p style="margin: 2px 0;"><strong>Assigned Games:</strong> ${assignedGames.join(', ') || 'No games assigned'}</p>
        </div>
      `;
    } else {
      editedFieldsHTML = `
        <p style="margin: 2px 0;"><strong>CloudFront URL:</strong> ${cloudfrontUrl}</p>
        <p style="margin: 2px 0;"><strong>Port:</strong> ${port}</p>
        <p style="margin: 2px 0;"><strong>Assigned Games:</strong> ${assignedGames.join(', ') || 'No games assigned'}</p>
      `;
    }

    const emailBody = `
<body style="margin:0;padding:0;background-color:#f2f4f6;font-family:Arial;color:#000;">
<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1)">
<table width="100%" style="background:linear-gradient(90deg,#d4dbdf,#00c6ff);padding:0px 20px;">
<tr>
<td align="left"><img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px;background: transparent; display:block;"></td>
<td align="right"><img src="${smtp.BASE_URL || '#'}/assets/images/emailmessage.png" style="height:38px;"></td>
</tr></table>

<div style="padding:25px;text-align:left;">
<div style="background:#f9fbff;border:1px solid #e2e8f0;border-radius:6px;padding:15px;margin-bottom:20px;">
<p><strong style="color:#a61321;">Environment:</strong> Internal Testing</p>
</div>

<table width="100%" style="border-collapse:collapse;">
<tr><td><strong>Server Name:</strong></td><td>${name}</td></tr>
<tr><td><strong>Cloudfront URL:</strong></td><td>${cloudfrontUrl}</td></tr>
<tr><td><strong>Cloudfront Port:</strong></td><td>${port}</td></tr>
<tr><td style="vertical-align:top;"><strong>Assigned Games:</strong></td><td>${assignedGamesHTML}</td></tr>
<tr><td><strong>Date & Time:</strong></td><td>${formattedLastUpdate}</td></tr>
<tr><td><strong>${isEdit ? 'Edited By:' : 'Added By:'}</strong></td><td>${username}</td></tr>
</table>

${isEdit ? editedFieldsHTML : ''}

</div>

<div style="background:#f9f9f9;text-align:center;padding:15px;">
<img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px; background: transparent;">
<p style="margin:0;font-size:11px;color:#777;">©2026 <span style="color:#139FFF;">Unity one</span>. All Rights Reserved.</p>
</div></div></body>
    `;

    const subject = isEdit 
      ? `${name} - CloudFront details have been Updated` 
      : `${name} - New CloudFront has been Added`;

    await transporter.sendMail({
      from: smtp.SMTP_FROM,
      to: [
        "kavin.s@theunitytech.com",
        "meera.r@theunitytech.com",
        "anjalipriya@theunitytech.com",
        "saravanant@theunitytech.com",
        "dhineshvinayak@theunitytech.com",
        "rathnavel@theunitytech.com"
        // "vipinsharma.r@theunitytech.com"
      ],
      subject: subject,
      html: emailBody,
      replyTo: email,
    });

    console.log(`${action} email sent successfully`);
  } catch (error) {
    console.error("Error sending email:", error);
    // Don't throw error, just log it so the main operation continues
  }
};

// -------------------- GET ALL SERVERS --------------------
router.get("/", async (req, res) => {
  try {
    const supabase = getSupabase();

    // Get servers - no AS aliases in select
    const { data: servers, error: serversError } = await supabase
      .from('server_management')
      .select('*')
      .order('id', { ascending: false });

    if (serversError) throw serversError;

    // Get cloudfronts - no AS aliases in select
    const { data: cloudfronts, error: cloudfrontsError } = await supabase
      .from('cloudfront_configurations')
      .select('*')
      .order('id', { ascending: false });

    if (cloudfrontsError) throw cloudfrontsError;

    // Map server data to match expected format
    const mappedServers = servers.map(srv => ({
      id: srv.id,
      serverName: srv.server_name,
      serverType: srv.server_type,
      ebsVolume: srv.ebs_volume,
      freeEbsVolume: srv.free_ebs_volume,
      serverPublicIP: srv.server_public_ip,
      domainName: srv.domain_name,
      gameType: srv.game_type,
      createdAt: srv.created_at,
      updatedAt: srv.updated_at
    }));

    // Group cloudfronts by server_id
    const group = {};
    cloudfronts.forEach(cf => {
      if (!group[cf.server_id]) group[cf.server_id] = [];
      group[cf.server_id].push({
        id: cf.id,
        cloudfrontUrl: cf.cloudfront_url,
        port: cf.port,
        assignedGames: parseAssignedGames(cf.assigned_games),
        createdAt: cf.created_at
      });
    });

    const finalData = mappedServers.map(srv => ({
      ...srv,
      cloudfront: group[srv.id] || []
    }));

    res.json({ success: true, data: finalData });
  } catch (error) {
    console.log("Error fetching servers:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// -------------------- GET CLOUDFRONTS BY SERVER ID --------------------
router.get("/:serverId/cloudfronts", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { serverId } = req.params;

    const { data: rows, error } = await supabase
      .from('cloudfront_configurations')
      .select('*')
      .eq('server_id', serverId)
      .order('id', { ascending: false });

    if (error) throw error;

    const formatted = rows.map((row) => ({
      id: row.id,
      cloudfrontUrl: row.cloudfront_url,
      port: row.port,
      assignedGames: parseAssignedGames(row.assigned_games),
      createdAt: row.created_at
    }));

    return res.json({ success: true, data: formatted });
  } catch (error) {
    console.log("Error fetching cloudfronts:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch cloudfronts",
      error: error.message
    });
  }
});

// -------------------- CREATE SERVER --------------------
router.post("/", async (req, res) => {
  try {
    const supabase = getSupabase();

    const {
      serverName,
      serverType,
      ebsVolume,
      freeEbsVolume,
      serverPublicIP,
      domainName,
      gameType,
      username,
      email
    } = req.body;

    console.log("Received data for POST:", {
      serverName,
      serverType,
      ebsVolume,
      freeEbsVolume,
      serverPublicIP,
      domainName,
      gameType,
      typeOfGameType: typeof gameType
    });

    if (!serverName || !serverType || !serverPublicIP || !domainName || !gameType)
      return res.status(400).json({ success: false, message: "Required fields missing" });

    if (!isValidIP(serverPublicIP))
      return res.status(400).json({ success: false, message: "Invalid IP" });

    // Parse game types (comma-separated string to array and validate)
    const gameTypesArray = parseGameTypes(gameType);
    console.log("Parsed gameTypesArray:", gameTypesArray);

    if (gameTypesArray.length === 0) {
      return res.status(400).json({ success: false, message: "At least one game type is required" });
    }

    // Validate EBS volumes are numbers
    if (isNaN(parseFloat(ebsVolume)) || parseFloat(ebsVolume) < 0) {
      return res.status(400).json({ success: false, message: "Invalid EBS Volume" });
    }

    if (isNaN(parseFloat(freeEbsVolume)) || parseFloat(freeEbsVolume) < 0) {
      return res.status(400).json({ success: false, message: "Invalid Free EBS Volume" });
    }

    // Use the original gameType string from request (it's already comma-separated)
    const gameTypeForDB = gameType;
    const time = getCurrentISTForMySQL();
    console.log("Using gameType for DB:", gameTypeForDB);

    const { error: insertError } = await supabase
      .from('server_management')
      .insert([{
        server_name: serverName,
        server_type: serverType,
        ebs_volume: ebsVolume,
        free_ebs_volume: freeEbsVolume,
        server_public_ip: serverPublicIP,
        domain_name: domainName,
        game_type: gameTypeForDB
      }]);

    if (insertError) throw insertError;

    const { error: buildError } = await supabase
      .from('builduser')
      .insert([{
        gamename: serverName,
        username: username,
        email: email,
        command: `Server Created`,
        useraction: "Server Created",
        lastupdate: time
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "Server added successfully" });
  } catch (err) {
    console.error("Error in POST /servers:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------- UPDATE SERVER --------------------
router.put("/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = req.params.id;

    const {
      serverName,
      serverType,
      ebsVolume,
      freeEbsVolume,
      serverPublicIP,
      domainName,
      gameType,
      username,
      email
    } = req.body;

    console.log("Received data for PUT:", {
      serverName,
      serverType,
      ebsVolume,
      freeEbsVolume,
      serverPublicIP,
      domainName,
      gameType,
      typeOfGameType: typeof gameType
    });

    const { data: oldData, error: oldError } = await supabase
      .from('server_management')
      .select('*')
      .eq('id', id)
      .single();

    if (oldError || !oldData) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    // Parse game types (comma-separated string to array and validate)
    const gameTypesArray = parseGameTypes(gameType);
    const time = getCurrentISTForMySQL();
    console.log("Parsed gameTypesArray:", gameTypesArray);

    if (gameTypesArray.length === 0) {
      return res.status(400).json({ success: false, message: "At least one game type is required" });
    }

    // Validate EBS volumes are numbers
    if (isNaN(parseFloat(ebsVolume)) || parseFloat(ebsVolume) < 0) {
      return res.status(400).json({ success: false, message: "Invalid EBS Volume" });
    }

    if (isNaN(parseFloat(freeEbsVolume)) || parseFloat(freeEbsVolume) < 0) {
      return res.status(400).json({ success: false, message: "Invalid Free EBS Volume" });
    }

    // Use the original gameType string from request (it's already comma-separated)
    const gameTypeForDB = gameType;
    console.log("Using gameType for DB:", gameTypeForDB);

    const { error: updateError } = await supabase
      .from('server_management')
      .update({
        server_name: serverName,
        server_type: serverType,
        ebs_volume: ebsVolume,
        free_ebs_volume: freeEbsVolume,
        server_public_ip: serverPublicIP,
        domain_name: domainName,
        game_type: gameTypeForDB,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    const { error: buildError } = await supabase
      .from('builduser')
      .insert([{
        gamename: serverName,
        username: username,
        email: email,
        command: `Server Updated (${oldData.server_name} → ${serverName})`,
        useraction: "Server Updated",
        lastupdate: time
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "Server updated successfully" });
  } catch (err) {
    console.error("Error in PUT /servers/:id:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------- DELETE SERVER --------------------
router.delete("/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const id = req.params.id;
    const { username, email } = req.body;
    const time = getCurrentISTForMySQL();
    
    // Check if server exists
    const { data: server, error: serverError } = await supabase
      .from('server_management')
      .select('server_name')
      .eq('id', id)
      .single();

    if (serverError || !server) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    const serverName = server.server_name;

    // Check if server has any cloudfront configurations
    const { data: cloudfronts, error: cloudfrontError } = await supabase
      .from('cloudfront_configurations')
      .select('id', { count: 'exact' })
      .eq('server_id', id);

    if (cloudfrontError) throw cloudfrontError;

    if (cloudfronts && cloudfronts.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete server with existing CloudFront configurations. Please delete CloudFronts first."
      });
    }

    const { error: deleteError } = await supabase
      .from('server_management')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    const { error: buildError } = await supabase
      .from('builduser')
      .insert([{
        gamename: serverName,
        username: username,
        email: email,
        command: "Server Deleted",
        useraction: "Server Deleted",
        lastupdate: time
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "Server deleted successfully" });
  } catch (err) {
    console.error("Error deleting server:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------- ADD CLOUDFRONT --------------------
router.post("/:serverId/cloudfronts", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { serverId } = req.params;

    const {
      cloudfrontUrl,
      port,
      assignedGames,
      username,
      email
    } = req.body;
    const time = getCurrentISTForMySQL();
    
    const { data: srv, error: srvError } = await supabase
      .from('server_management')
      .select('server_name')
      .eq('id', serverId)
      .single();

    if (srvError || !srv) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    // Validate CloudFront URL format
    if (!isValidCloudFrontUrl(cloudfrontUrl)) {
      return res.status(400).json({
        success: false,
        message: "CloudFront URL must be in format: https://xxxx.cloudfront.net"
      });
    }

    // Validate port
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({
        success: false,
        message: "Port must be a valid number between 1 and 65535"
      });
    }

    const assignedGamesText = formatAssignedGamesForDB(assignedGames);

    // Insert CloudFront configuration
    const { error: insertError } = await supabase
      .from('cloudfront_configurations')
      .insert([{
        server_id: serverId,
        cloudfront_url: cloudfrontUrl,
        port: portNum,
        assigned_games: assignedGamesText
      }]);

    if (insertError) throw insertError;

    // Update gameinfodetails table with server URL and port
    if (assignedGames && assignedGames.length > 0) {
      await updateGameServerInfo(assignedGames, cloudfrontUrl, portNum, supabase);
    }

    // Get game names for email
    const gameNames = await getGameNamesFromIds(assignedGames || [], supabase);

    // Send email notification
    await sendCloudFrontEmail(
      'ADD',
      srv.server_name,
      cloudfrontUrl,
      portNum,
      gameNames,
      username,
      email,
      false
    );

    const { error: buildError } = await supabase
      .from('builduser')
      .insert([{
        gamename: srv.server_name,
        username: username,
        email: email,
        command: `CloudFront Added (${cloudfrontUrl}:${port})`,
        useraction: "CloudFront Added",
        lastupdate: time
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "CloudFront added successfully" });
  } catch (err) {
    console.error("Error in POST /cloudfronts:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------- UPDATE CLOUDFRONT --------------------
router.put("/:serverId/cloudfronts/:cloudfrontId", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { serverId, cloudfrontId } = req.params;

    const {
      cloudfrontUrl,
      port,
      assignedGames,
      username,
      email
    } = req.body;
    const time = getCurrentISTForMySQL();
    
    const { data: server, error: serverError } = await supabase
      .from('server_management')
      .select('server_name')
      .eq('id', serverId)
      .single();

    if (serverError || !server) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    const { data: old, error: oldError } = await supabase
      .from('cloudfront_configurations')
      .select('cloudfront_url, port, assigned_games')
      .eq('id', cloudfrontId)
      .single();

    if (oldError || !old) {
      return res.status(404).json({ success: false, message: "CloudFront not found" });
    }
    
    // Validate CloudFront URL format
    if (!isValidCloudFrontUrl(cloudfrontUrl)) {
      return res.status(400).json({
        success: false,
        message: "CloudFront URL must be in format: https://xxxx.cloudfront.net"
      });
    }

    // Validate port
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({
        success: false,
        message: "Port must be a valid number between 1 and 65535"
      });
    }

    // Format assigned games as JSON array string
    const assignedGamesText = formatAssignedGamesForDB(assignedGames);

    // Get previously assigned games
    const previouslyAssignedGames = parseAssignedGames(old.assigned_games);
    const newlyAssignedGames = Array.isArray(assignedGames) ? assignedGames : [];

    // Update CloudFront configuration
    const { error: updateError } = await supabase
      .from('cloudfront_configurations')
      .update({
        cloudfront_url: cloudfrontUrl,
        port: portNum,
        assigned_games: assignedGamesText,
        updated_at: new Date().toISOString()
      })
      .eq('id', cloudfrontId);

    if (updateError) throw updateError;

    // Find games that were removed
    const removedGames = previouslyAssignedGames.filter(id => !newlyAssignedGames.includes(id));
    
    // Remove server info from games that were unassigned
    if (removedGames.length > 0) {
      await removeGameServerInfo(removedGames, supabase);
    }

    // Update server info for newly assigned games
    if (newlyAssignedGames.length > 0) {
      await updateGameServerInfo(newlyAssignedGames, cloudfrontUrl, portNum, supabase);
    }

    // Get old and new game names for email
    const oldGameNames = await getGameNamesFromIds(previouslyAssignedGames || [], supabase);
    const newGameNames = await getGameNamesFromIds(newlyAssignedGames || [], supabase);

    // Prepare old data for email
    const oldDataForEmail = {
      cloudfront_url: old.cloudfront_url,
      port: old.port,
      assignedGamesNames: oldGameNames
    };

    // Send email notification
    await sendCloudFrontEmail(
      'UPDATE',
      server.server_name,
      cloudfrontUrl,
      portNum,
      newGameNames,
      username,
      email,
      true,
      oldDataForEmail
    );

    const { error: buildError } = await supabase
      .from('builduser')
      .insert([{
        gamename: server.server_name,
        username: username,
        email: email,
        command: `CloudFront Updated (${old.cloudfront_url}:${old.port} → ${cloudfrontUrl}:${port})`,
        useraction: "CloudFront Updated",
        lastupdate: time
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "CloudFront updated successfully" });
  } catch (err) {
    console.error("Error in PUT /cloudfronts:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// -------------------- DELETE CLOUDFRONT --------------------
router.delete("/:serverId/cloudfronts/:cloudfrontId", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { serverId, cloudfrontId } = req.params;
    const { username, email } = req.body;
    const time = getCurrentISTForMySQL();
    
    const { data: srv, error: srvError } = await supabase
      .from('server_management')
      .select('server_name')
      .eq('id', serverId)
      .single();

    if (srvError || !srv) {
      return res.status(404).json({ success: false, message: "Server not found" });
    }

    const { data: old, error: oldError } = await supabase
      .from('cloudfront_configurations')
      .select('cloudfront_url, port, assigned_games')
      .eq('id', cloudfrontId)
      .single();

    if (oldError || !old) {
      return res.status(404).json({ success: false, message: "CloudFront not found" });
    }
    
    // Get assigned games before deletion
    const assignedGames = parseAssignedGames(old.assigned_games);

    // Remove server info from assigned games
    if (assignedGames.length > 0) {
      await removeGameServerInfo(assignedGames, supabase);
    }

    // Delete CloudFront configuration
    const { error: deleteError } = await supabase
      .from('cloudfront_configurations')
      .delete()
      .eq('id', cloudfrontId);

    if (deleteError) throw deleteError;

    const { error: buildError } = await supabase
      .from('builduser')
      .insert([{
        gamename: srv.server_name,
        username: username,
        email: email,
        command: `CloudFront Deleted (${old.cloudfront_url}:${old.port})`,
        useraction: "CloudFront Deleted",
        lastupdate: time
      }]);

    if (buildError) throw buildError;

    res.json({ success: true, message: "CloudFront deleted successfully" });
  } catch (err) {
    console.error("Error in DELETE /cloudfronts:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/games/list", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { filterUnassigned, excludeCloudfrontId } = req.query;
    
    // Get all active games
    const { data: games, error: gamesError } = await supabase
      .from('gameinfodetails')
      .select('id, name, server_url, server_port')
      .eq('isgameactive', 1)
      .order('name', { ascending: true });

    if (gamesError) throw gamesError;

    // Get all cloudfront configurations with assigned games
    const { data: allCloudfronts, error: cfError } = await supabase
      .from('cloudfront_configurations')
      .select('id, cloudfront_url, assigned_games, server_id');

    if (cfError) throw cfError;

    // Build a map of game_id -> cloudfront info
    const assignmentMap = new Map();
    const allAssignedGameIds = new Set();

    allCloudfronts.forEach(cf => {
      try {
        const assignedGames = parseAssignedGames(cf.assigned_games);
        assignedGames.forEach(gameId => {
          if (gameId) {
            // Skip if this cloudfront is being excluded
            if (excludeCloudfrontId && cf.id === parseInt(excludeCloudfrontId)) {
              // Still add to map but mark as assigned to this cloudfront
              assignmentMap.set(gameId, {
                cloudfrontUrl: cf.cloudfront_url,
                cloudfrontId: cf.id,
                serverId: cf.server_id,
                isExcluded: true
              });
            } else {
              assignmentMap.set(gameId, {
                cloudfrontUrl: cf.cloudfront_url,
                cloudfrontId: cf.id,
                serverId: cf.server_id,
                isExcluded: false
              });
            }
            allAssignedGameIds.add(gameId);
          }
        });
      } catch (error) {
        console.error("Error parsing assigned games:", error);
      }
    });

    let filteredGames = games;

    // If filtering for unassigned games
    if (filterUnassigned === 'true') {
      filteredGames = games.filter(game => !allAssignedGameIds.has(game.id));
    }

    // Add assignment info to games
    const gamesWithAssignments = filteredGames.map(game => {
      const assignment = assignmentMap.get(game.id);
      return {
        ...game,
        isAssigned: assignmentMap.has(game.id) && !assignment?.isExcluded,
        assignedCloudfront: assignment?.cloudfrontUrl || null,
        cloudfrontId: assignment?.cloudfrontId || null
      };
    });

    res.json({ success: true, data: gamesWithAssignments });
  } catch (error) {
    console.error("Error fetching games with cloudfront info:", error);
    res.status(500).json({ success: false, message: "Error fetching games" });
  }
});

export default router;