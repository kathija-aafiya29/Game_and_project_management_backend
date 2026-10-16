import express from 'express';
import fileUpload from 'express-fileupload';
import { createClient } from '@supabase/supabase-js';
import AWS from 'aws-sdk';
import nodemailer from 'nodemailer';

import { getS3Config, getSMTPConfig } from "../config/config.js";

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

const getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30 in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

// Add express-fileupload middleware for this router
router.use(fileUpload({
    createParentPath: true,
    limits: {
        fileSize: 200 * 1024 * 1024, // 200MB limit for PDF files
    }
}));

// Configure AWS S3
const getAWSConfig = () => {
  const s3Config = getS3Config();
  return {
    accessKeyId: s3Config.AWS_ACCESS_KEY_ID,
    secretAccessKey: s3Config.AWS_SECRET_ACCESS_KEY,
    region: s3Config.AWS_REGION,
  };
};

const getS3 = () => {
  return new AWS.S3(
    getAWSConfig()
  );
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

// FIXED VERSION - routes/game-documents-api.js
async function sendUINotification(gameName, username, gameVersion, documentUrl) {
    const supabase = getSupabase();
    
    try {
        console.log('🎯 Sending UI notification for:', {
            gameName,
            username,
            gameVersion,
            documentUrl
        });

        // 🔧 FIXED: Get users to notify from Supabase
        // Get users from builduser table
        const { data: buildUsers, error: buildError } = await supabase
            .from('builduser')
            .select('email')
            .eq('gamename', gameName)
            .not('email', 'is', null)
            .neq('email', username);

        if (buildError) {
            console.error('Error fetching build users:', buildError);
        }

        // Get users from gameinfodetails table
        const { data: gameInfo, error: gameError } = await supabase
            .from('gameinfodetails')
            .select('gameassignee')
            .eq('name', gameName)
            .not('gameassignee', 'is', null);

        if (gameError) {
            console.error('Error fetching game info:', gameError);
        }

        // Extract emails
        const buildUserEmails = (buildUsers || []).map(u => u.email).filter(Boolean);
        const gameAssigneeEmails = (gameInfo || []).map(g => g.gameassignee).filter(Boolean);

        const defaultRecipients = [
            'dhineshvinayak@theunitytech.com',
            'kavin.s@theunitytech.com',
            'meera.r@theunitytech.com',
            'anjalipriya@theunitytech.com',
            'rathnavel@theunitytech.com',
            'saravanant@theunitytech.com',
            'vishaalpremkumar@theunitytech.com',
            'mohammedameen.ot@theunitytech.com'
        ];

        // Combine and deduplicate recipients
        const allUsers = [
            ...new Set([
                ...defaultRecipients,
                ...buildUserEmails,
                ...gameAssigneeEmails
            ])
        ];

        console.log(`📧 Total recipients: ${allUsers.length}`);
        
        // Create notification object template
        const notificationTemplate = {
            type: 'ui_design_upload',
            title: `${gameName} - UI Document Updated`,
            message: `${username} uploaded UI document version R${gameVersion}`,
            context: {
                game_name: gameName,
                version: gameVersion,
                document_url: documentUrl,
                uploaded_by: username
            },
            source_id: gameName,
            environment: 'internal',
            is_read: false
        };

        // Process each user
        for (const userEmail of allUsers) {
            // 🔴 FIX: Skip the uploader (ADD THIS CHECK FIRST)
            if (userEmail === username) {
                console.log(`⏭️ Skipping notification for uploader: ${userEmail}`);
                continue;
            }

            console.log(`📨 Preparing notification for: ${userEmail}`);

            try {
                // 🔹 1. CHECK FOR RECENT DUPLICATE NOTIFICATION
                const { data: duplicateCheck, error: dupError } = await supabase
                    .from('notifications')
                    .select('id')
                    .eq('user_id', userEmail)
                    .eq('type', 'ui_design_upload')
                    .eq('source_id', gameName)
                    .eq('context->>version', gameVersion.toString())
                    .gte('created_at', new Date(Date.now() - 60000).toISOString())
                    .limit(1);

                if (dupError) {
                    console.error('Error checking duplicates:', dupError);
                }

                if (duplicateCheck && duplicateCheck.length > 0) {
                    console.log(`⚠️ Duplicate notification prevented for ${userEmail} (recent entry exists)`);
                    continue;
                }

                const currentTime = getCurrentISTForMySQL();
                
                // 🔹 2. INSERT NOTIFICATION INTO DATABASE (ONLY ONCE)
                const { data: insertedData, error: insertError } = await supabase
                    .from('notifications')
                    .insert({
                        user_id: userEmail,
                        type: notificationTemplate.type,
                        title: notificationTemplate.title,
                        message: notificationTemplate.message,
                        context: notificationTemplate.context,
                        source_id: notificationTemplate.source_id,
                        environment: notificationTemplate.environment,
                        is_read: notificationTemplate.is_read,
                        created_at: currentTime
                    })
                    .select('id')
                    .single();

                if (insertError) {
                    console.error('Error inserting notification:', insertError);
                    continue;
                }

                console.log(`✅ Database notification inserted for ${userEmail}, ID: ${insertedData.id}`);

                // 🔹 3. PREPARE WEBSOCKET NOTIFICATION
                const wsNotification = {
                    type: 'notification',
                    data: {
                        id: insertedData.id,
                        user_id: userEmail,
                        type: notificationTemplate.type,
                        title: notificationTemplate.title,
                        message: notificationTemplate.message,
                        context: notificationTemplate.context,
                        source_id: notificationTemplate.source_id,
                        environment: notificationTemplate.environment,
                        is_read: notificationTemplate.is_read,
                        created_at: currentTime
                    }
                };

                // 🔹 4. SEND WEBSOCKET NOTIFICATION WITH SELF-NOTIFICATION CHECK
                if (global.sendNotification) {
                    console.log(`📡 Sending WebSocket notification to ${userEmail}`);
                    try {
                        // Determine if this is a self-notification
                        const shouldNotifySelf = (userEmail === username);
                        
                        // Send notification via WebSocket with proper options
                        const sent = await global.sendNotification(
                            userEmail, 
                            wsNotification.data,
                            { 
                                shouldNotifySelf: false // 🔴 IMPORTANT: Always false since we already skipped uploader
                            }
                        );
                        
                        if (!sent) {
                            console.log(`⚠️ User ${userEmail} is not connected via WebSocket`);
                        }
                    } catch (wsError) {
                        console.error(`❌ WebSocket error for ${userEmail}:`, wsError);
                    }
                } else {
                    console.warn('⚠️ global.sendNotification function not available');
                }

                // Small delay between users to prevent race conditions
                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (userError) {
                console.error(`❌ Error processing notification for ${userEmail}:`, userError);
                // Continue with other users even if one fails
                continue;
            }
        }

        console.log('✅ All UI notifications sent successfully');

    } catch (error) {
        console.error('❌ Error in sendUINotification:', error);
        throw error;
    }
}


// GET /api/game-documents - Fetch all games with UI design documents
router.get('/game-documents', async (req, res) => {
    try {
        const supabase = getSupabase();

        // User mapping data for designers
        const userMapping = [
            { "name": "Akashvel m", "email": "akashvel@theunitytech.com", "short_name": "AM" },
            { "name": "Anjali Priya", "email": "anjalipriya@theunitytech.com", "short_name": "AP" },
            { "name": "Vipin Sharma", "email": "vipinsharma.r@theunitytech.com", "short_name": "VS" },
            { "name": "Deepika s", "email": "deepika.s@theunitytech.com", "short_name": "DS" },
            { "name": "Kavin S", "email": "kavin.s@theunitytech.com", "short_name": "KS" },
            { "name": "Manikandan g", "email": "manikandan@theunitytech.com", "short_name": "MG" },
            { "name": "Meera R", "email": "meera.r@theunitytech.com", "short_name": "MR" },
            { "name": "Ameen Mhd", "email": "mohammedameen.ot@theunitytech.com", "short_name": "AM" },
            { "name": "Rathna Vel S", "email": "rathnavel@theunitytech.com", "short_name": "RS" },
            { "name": "saru saravanan", "email": "saravanant@theunitytech.com", "short_name": "SS" },
            { "name": "Ida Scader", "email": "scader.ida@theunitytech.com", "short_name": "IS" },
            { "name": "Mrr Rrrr", "email": "vipinsharmagwl59@gmail.com", "short_name": "MR" },
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

        // Get all active games
        const { data: games, error: gamesError } = await supabase
            .from('gameinfodetails')
            .select('name, gamelabel')
            .eq('isgameactive', 1)
            .order('name', { ascending: true });

        if (gamesError) {
            throw new Error(gamesError.message);
        }

        // Get the latest UI design upload for each game
        const gameNames = games.map(g => g.name);
        
        const { data: uiUploads, error: uiError } = await supabase
            .from('builduser')
            .select('gamename, username, email, gameversion, lastupdate, command, id')
            .in('gamename', gameNames)
            .eq('useraction', 'UIdesign_upload')
            .order('id', { ascending: false });

        if (uiError) {
            throw new Error(uiError.message);
        }

        // Get the latest upload for each game
        const latestUploads = {};
        for (const upload of uiUploads || []) {
            if (!latestUploads[upload.gamename]) {
                latestUploads[upload.gamename] = upload;
            }
        }

        // Format the data for frontend
        const gamesData = games.map(game => {
            const upload = latestUploads[game.name] || {};
            
            // Get designer details from email
            const designerDetails = getUserDetailsByEmail(upload.email);
            
            return {
                id: game.name,
                name: game.name,
                designer: upload.username || 'unknown_user',
                designer_email: upload.email || null,
                designer_fullname: designerDetails.fullname,
                designer_short_name: designerDetails.short_name,
                version: upload.gameversion ? `R${upload.gameversion}` : 'N/A',
                currentVersion: upload.gameversion || null,
                updatedAt: upload.lastupdate ? formatDateForDisplay(upload.lastupdate) : 'Unknown',
                documentUrl: upload.command || null
            };
        });

        res.json({
            success: true,
            data: gamesData,
            message: 'Games fetched successfully'
        });

    } catch (error) {
        console.error('Error fetching game documents:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/game-documents/stats - Get last updated game and recent uploads count
router.get('/game-documents/stats', async (req, res) => {
    try {
        const supabase = getSupabase();

        // Get the last updated game (most recent UIdesign_upload)
        const { data: lastUpdatedData, error: lastError } = await supabase
            .from('builduser')
            .select('gamename')
            .eq('useraction', 'UIdesign_upload')
            .order('id', { ascending: false })
            .limit(1);

        if (lastError) {
            throw new Error(lastError.message);
        }

        const lastUpdatedGame = lastUpdatedData?.[0]?.gamename || 'No games';

        // Get count of games updated in last 48 hours
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        
        const { data: recentData, error: recentError } = await supabase
            .from('builduser')
            .select('gamename')
            .eq('useraction', 'UIdesign_upload')
            .gte('lastupdate', fortyEightHoursAgo);

        if (recentError) {
            throw new Error(recentError.message);
        }

        // Count distinct game names
        const uniqueGames = new Set((recentData || []).map(item => item.gamename));
        const recentUploadsCount = uniqueGames.size;

        res.json({
            success: true,
            data: {
                lastUpdatedGame,
                recentUploadsCount
            },
            message: 'Stats fetched successfully'
        });

    } catch (error) {
        console.error('Error fetching game documents stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// GET /api/game-timeline/:gameName - Fetch timeline for specific game
router.get('/game-timeline/:gameName', async (req, res) => {
    try {
        const supabase = getSupabase();
        const { gameName } = req.params;
        const { fromDate, toDate } = req.query;

        // Build the query
        let query = supabase
            .from('builduser')
            .select('lastupdate, username, gameversion, id, command')
            .eq('gamename', gameName)
            .eq('useraction', 'UIdesign_upload');

        // Add date filters if provided
        if (fromDate) {
            query = query.gte('lastupdate', fromDate);
        }
        if (toDate) {
            query = query.lte('lastupdate', toDate);
        }

        const { data: results, error } = await query
            .order('lastupdate', { ascending: false });

        if (error) {
            throw new Error(error.message);
        }

        const events = (results || []).map(event => ({
            id: event.id,
            type: 'UI Design Uploaded',
            date: formatDateForDisplay(event.lastupdate),
            dev: event.username,
            version: event.gameversion,
            url: event.command,
            icon: 'upload',
            color: 'primary'
        }));

        res.json({
            success: true,
            data: events,
            message: 'Timeline fetched successfully'
        });

    } catch (error) {
        console.error('Error fetching timeline:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// POST /api/upload-ui-document - Upload UI design document
router.post('/upload-ui-document', async (req, res) => {
    const supabase = getSupabase();
    const s3 = getS3();
    try {
        console.log("REQ BODY:", req.body);
        console.log("REQ FILES:", req.files);
        
        // Check if files exist
        if (!req.files || !req.files.pdfFile) {
            return res.status(400).json({
                success: false,
                message: "No PDF file uploaded",
            });
        }

        // Extract FormData fields safely
        const { gameName, gameVersion, username, email } = req.body;
        const file = req.files.pdfFile;

        if (!gameName || !gameVersion) {
            return res.status(400).json({
                success: false,
                message: "Game name or version missing",
            });
        }

        // Validate file type
        if (file.mimetype !== 'application/pdf') {
            return res.status(400).json({
                success: false,
                message: "Only PDF files are allowed",
            });
        }

        const currentTime = getCurrentISTForMySQL();
        const formattedLastUpdate = new Date().toLocaleString("en-IN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        }).toUpperCase();

        // Fetch tester & dev emails from Supabase
        const { data: assigneeResult, error: assigneeError } = await supabase
            .from('gameinfodetails')
            .select('gameassignee')
            .eq('name', gameName)
            .single();

        if (assigneeError && assigneeError.code !== 'PGRST116') { // PGRST116 is "not found"
            console.error('Error fetching assignee:', assigneeError);
        }

        // Get dev email from builduser
        const { data: devResult, error: devError } = await supabase
            .from('builduser')
            .select('email')
            .eq('gamename', gameName)
            .in('useraction', ['Build Uploaded', 'Build is uploaded and moved to testing'])
            .order('id', { ascending: false })
            .limit(1);

        if (devError) {
            console.error('Error fetching dev email:', devError);
        }

        const gameassignee = assigneeResult?.gameassignee || null;
        const Devemail = devResult?.[0]?.email || null;

        // Get previous version
        const { data: prevVersionResult, error: prevError } = await supabase
            .from('builduser')
            .select('gameversion')
            .eq('gamename', gameName)
            .eq('useraction', 'UIdesign_upload')
            .order('id', { ascending: false })
            .limit(1);

        if (prevError) {
            console.error('Error fetching previous version:', prevError);
        }

        const prevVersion = prevVersionResult?.[0]?.gameversion || null;

        // Upload to S3
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9_\-\.]/g, "_");

        const uploadResult = await s3.upload({
            Bucket: "gamesui",
            Key: cleanFileName,
            Body: file.data,
            ContentType: "application/pdf",
            ACL: 'public-read',
        }).promise();

        const fileUrl = uploadResult.Location;

        // Insert into Supabase database
        const { error: insertError } = await supabase
            .from('builduser')
            .insert({
                gamename: gameName,
                username: username,
                email: email,
                gameversion: gameVersion,
                command: fileUrl,
                useraction: 'UIdesign_upload',
                lastupdate: currentTime
            });

        if (insertError) {
            throw new Error(insertError.message);
        }

        // Send email notification
        await sendUIUploadEmail({
            gameName,
            username,
            gameVersion,
            prevVersion,
            formattedLastUpdate,
            gameassignee,
            Devemail
        });

        // Send real-time notifications
        await sendUINotification(gameName, username, gameVersion, fileUrl);

        return res.json({
            success: true,
            message: "UI document uploaded successfully",
            url: fileUrl,
            version: gameVersion,
        });

    } catch (error) {
        console.error("Error uploading UI document:", error);
        return res.status(500).json({
            success: false,
            message: "Error uploading document",
            error: error.message,
        });
    }
});

// Helper function to send email
async function sendUIUploadEmail({
    gameName,
    username,
    gameVersion,
    prevVersion,
    formattedLastUpdate,
    gameassignee,
    Devemail
}) {
    try {
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

        let message = "";
        if (prevVersion) {
            message += `<span style="display:inline-block; color: #ff1e46; background:#ffe6e6; padding:3px 8px; border-radius:6px; font-size:12px; margin-right:6px;">R${prevVersion}</span> 
      <span style="font-size:14px; margin:0 4px;">➡</span>`;
        }
        message += `<span style="display:inline-block; color: #ffffffff; background: green; color:#fff; padding:3px 10px; border-radius:6px; font-size:12px;">R${gameVersion}</span>`;

        const mailOptions = {
            from: smtp.SMTP_FROM,
            to: [
                'dhineshvinayak@theunitytech.com',
                ...(gameassignee ? [gameassignee] : []),
                ...(Devemail ? [Devemail] : [])
            ],
            cc: [
                'kavin.s@theunitytech.com',
                'meera.r@theunitytech.com',
                'anjalipriya@theunitytech.com',
                'rathnavel@theunitytech.com',
                'saravanant@theunitytech.com',
                'vishaalpremkumar@theunitytech.com',
                'mohammedameen.ot@theunitytech.com',
            ],
            replyTo: 'noreply@example.com',
            subject: `${gameName} - UI Document has been updated`,
            html: `
<body style="margin: 0; padding: 0; background-color: #f2f4f6; font-family: Arial, sans-serif; color: #000;">
  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">

    <!-- Header -->
    <table width="100%" style="background: linear-gradient(90deg, #d4dbdf, #00c6ff); padding: 0px 20px;">
      <tr>
        <td align="left">
          <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px;background: transparent; display:block;">
        </td>
        <td align="right">
          <img src="${smtp.BASE_URL || ''}/assets/images/emailmessage.png" alt="Message" style="height: 35px;">
        </td>
      </tr>
    </table>

    <!-- Body -->
    <div style="padding: 25px; text-align: left;">
      <p style="font-size: 14px; margin: 0 0 15px;">Hi Team,</p>
      <p style="font-size: 14px; margin: 0 0 20px;">
        A new UI document has been uploaded for the game mentioned below. Please review the latest version to stay aligned with the current design specifications.
      </p>

      <!-- Game Details -->
      <table width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Game Name:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${gameName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Designer:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${username}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Version:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${message}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Uploaded On:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${formattedLastUpdate}</td>
        </tr>
      </table>

      <p style="font-size: 13px; margin-top: 20px; color: #444;">
        You can view or download the document directly from the <strong>Dashboard (by clicking the game name)</strong>.
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #f9f9f9; text-align: center; padding: 15px;">
      <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px; background: transparent;">
      <p style="margin: 0; font-size: 11px; color: #777;">
        ©2026 <span style="color: #139FFF;">Unity one</span>. All Rights Reserved.
      </p>
    </div>
  </div>
</body>`
        };

        await transporter.sendMail(mailOptions);
        console.log('UI upload email sent successfully');

    } catch (emailError) {
        console.error('Error sending UI upload email:', emailError);
        throw emailError;
    }
}

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