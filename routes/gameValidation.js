// routes/gameValidation.js
import express from "express";
import { createClient } from "@supabase/supabase-js";
import AWS from "aws-sdk";
import archiver from "archiver";
import nodemailer from 'nodemailer';
import { getS3Config, getSMTPConfig } from "../config/config.js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

/* =========================================
   SUPABASE CLIENT
========================================= */

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing in environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
};

// AWS S3 setup
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

const getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30 in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

// ========= ADD NOTIFICATION FUNCTION =========
async function sendUINotification(gameName, username, actionType, environment = 'internal', extraData = {}) {
    const supabase = getSupabase();
    
    try {
        console.log('🎯 Sending Game notification for:', {
            gameName,
            username,
            actionType,
            environment,
            extraData
        });

        // Get users to notify from builduser
        const { data: buildUsers, error: buildError } = await supabase
            .from('builduser')
            .select('email')
            .eq('gamename', gameName)
            .neq('email', username)
            .not('email', 'is', null);

        if (buildError) throw buildError;

        // Get users to notify from gameinfodetails
        const { data: gameUsers, error: gameError } = await supabase
            .from('gameinfodetails')
            .select('gameassignee')
            .eq('name', gameName)
            .not('gameassignee', 'is', null);

        if (gameError) throw gameError;

        const defaultRecipients = [
            'dhineshvinayak@theunitytech.com',
            'kavin.s@theunitytech.com',
            'meera.r@theunitytech.com',
            'anjalipriya@theunitytech.com',
            'rathnavel@theunitytech.com',
            'saravanant@theunitytech.com',
        ];

        // Combine and deduplicate recipients
        const allUsers = [
            ...new Set([
                ...defaultRecipients,
                ...(buildUsers || []).map(u => u.email).filter(Boolean),
                ...(gameUsers || []).map(u => u.gameassignee).filter(Boolean)
            ])
        ];

        console.log(`📧 Total recipients for ${actionType}: ${allUsers.length}`);
        
        // Create notification object based on action type
        let notificationTitle, notificationMessage, notificationType;
        
        if (actionType === 'move_to_live') {
            notificationTitle = `${gameName} - Moved to Live`;
            notificationMessage = `${username} Moved the game to live environment.`;
            notificationType = 'game_move_to_live';
        } else if (actionType === 'game_reopened') {
            notificationTitle = `${gameName} - Game Reopened`;
            notificationMessage = `${username} reopened the game.`;
            notificationType = 'game_reopened';
        } else {
            notificationTitle = `${gameName} – Game Notification`;
            notificationMessage = `${username} performed an action on the game.`;
            notificationType = 'game_general';
        }
        
        // Build context data
        const contextData = {
            game_name: gameName,
            action: actionType,
            performed_by: username,
            environment: environment,
            ...extraData
        };
        
        const notificationTemplate = {
            type: notificationType,
            title: notificationTitle,
            message: notificationMessage,
            context: contextData,
            source_id: gameName,
            environment: environment,
            is_read: false
        };

        // Process each user
        for (const userEmail of allUsers) {
            // Skip the uploader
            if (userEmail === username) {
                console.log(`⏭️ Skipping notification for uploader: ${userEmail}`);
                continue;
            }

            console.log(`📨 Preparing ${actionType} notification for: ${userEmail}`);

            try {
                // Check for recent duplicate notification
                const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
                const { data: duplicateCheck, error: dupError } = await supabase
                    .from('notifications')
                    .select('id')
                    .eq('user_id', userEmail)
                    .eq('type', notificationType)
                    .eq('source_id', gameName)
                    .gte('created_at', oneMinuteAgo)
                    .limit(1);

                if (dupError) throw dupError;

                if (duplicateCheck && duplicateCheck.length > 0) {
                    console.log(`⚠️ Duplicate notification prevented for ${userEmail} (recent entry exists)`);
                    continue;
                }

                // Insert notification into database
                const currentTime = getCurrentISTForMySQL();
                const { data: inserted, error: insertError } = await supabase
                    .from('notifications')
                    .insert([{
                        user_id: userEmail,
                        type: notificationTemplate.type,
                        title: notificationTemplate.title,
                        message: notificationTemplate.message,
                        context: JSON.stringify(notificationTemplate.context),
                        source_id: notificationTemplate.source_id,
                        environment: notificationTemplate.environment,
                        is_read: notificationTemplate.is_read,
                        created_at: currentTime
                    }])
                    .select();

                if (insertError) throw insertError;

                console.log(`✅ Database notification inserted for ${userEmail}, ID: ${inserted[0]?.id}`);

                // Prepare websocket notification
                const wsNotification = {
                    type: 'notification',
                    data: {
                        id: inserted[0]?.id,
                        user_id: userEmail,
                        type: notificationTemplate.type,
                        title: notificationTemplate.title,
                        message: notificationTemplate.message,
                        context: notificationTemplate.context,
                        source_id: notificationTemplate.source_id,
                        environment: notificationTemplate.environment,
                        is_read: notificationTemplate.is_read,
                        created_at: new Date().toISOString()
                    }
                };

                // Send websocket notification
                if (global.sendNotification) {
                    console.log(`📡 Sending WebSocket notification to ${userEmail}`);
                    try {
                        const sent = await global.sendNotification(
                            userEmail, 
                            wsNotification.data,
                            { 
                                shouldNotifySelf: false
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
                continue;
            }
        }

        console.log(`✅ All ${actionType} notifications sent successfully for ${gameName}`);

    } catch (error) {
        console.error(`❌ Error in sendUINotification for ${actionType}:`, error);
        throw error;
    }
}

// ========= GET ALL GAMES LIST =========
router.get("/", async (req, res) => {
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

    // Get all active games
    const { data: games, error: gamesError } = await supabase
      .from('gameinfodetails')
      .select(`
        id, 
        name, 
        gamecategory,
        time_taken,
        gamelabel,
        isactive,
        current_status,
        game_type
      `)
      .eq('isgameactive', 1)
      .order('name', { ascending: true });

    if (gamesError) throw gamesError;

    // Get game categories
    const { data: categories, error: catError } = await supabase
      .from('gamecategories')
      .select('id, gametype');

    if (catError) throw catError;

    // Get latest verified builds for each game
    const { data: verifiedBuilds, error: buildError } = await supabase
      .from('builduser')
      .select('gamename, username, email, lastupdate')
      .eq('command', 'Game Verified')
      .order('lastupdate', { ascending: false });

    if (buildError) throw buildError;

    // Get latest verified build per game
    const latestVerified = {};
    for (const build of verifiedBuilds || []) {
      if (!latestVerified[build.gamename]) {
        latestVerified[build.gamename] = build;
      }
    }

    const gamesData = games.map((game) => {
      const category = categories?.find(c => c.id === game.game_type);
      const verified = latestVerified[game.name] || {};
      
      // Get verifiedBy details from email
      const verifiedByDetails = getUserDetailsByEmail(verified.email);
      
      return {
        id: game.id,
        phase: game.gamelabel,
        name: game.name,
        category: game.gamecategory || category?.gametype,
        status:
          game.current_status === "Verified" ||
          game.current_status === "Moved to Live"
            ? "Verified"
            : "Not Verified",
        moveToLive: game.current_status === "Moved to Live",
        timeTaken: game.time_taken ? `${game.time_taken} Min.` : "--",
        verifiedBy: verified.username || "--",
        verifiedBy_email: verified.email || null,
        verifiedBy_fullname: verifiedByDetails.fullname,
        verifiedBy_short_name: verifiedByDetails.short_name,
        lastVerified: verified.lastupdate
          ? new Date(verified.lastupdate).toLocaleString("en-IN", {
              timeZone: "Asia/Kolkata",
            })
          : "--",
        // Add raw date for sorting
        _rawDate: verified.lastupdate || null
      };
    });

    // Sort by lastVerified date (most recent first) - matching MySQL ORDER BY b.lastupdate DESC
    gamesData.sort((a, b) => {
      // If both have dates, compare them
      if (a._rawDate && b._rawDate) {
        return new Date(b._rawDate) - new Date(a._rawDate);
      }
      // If only a has date, a comes first
      if (a._rawDate) return -1;
      // If only b has date, b comes first
      if (b._rawDate) return 1;
      // If neither has date, sort by name
      return a.name.localeCompare(b.name);
    });

    // Remove the temporary _rawDate field before sending response
    const finalData = gamesData.map(({ _rawDate, ...rest }) => rest);

    res.json({ success: true, data: finalData });
  } catch (error) {
    console.error("Error fetching validation games:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// ========= MOVE GAME TO LIVE =========
router.post("/move-to-live", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { gameIds, username, email } = req.body;

    if (!gameIds || !Array.isArray(gameIds) || gameIds.length === 0) {
      return res.status(400).json({ success: false, message: "Game IDs are required" });
    }

    const currentTime = getCurrentISTForMySQL();
    const formattedLastUpdate = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).toUpperCase();

    const useraction = "Move to Live";

    for (const gamename of gameIds) {
      // Fetch game details
      const { data: gameData, error: gameError } = await supabase
        .from('gameinfodetails')
        .select('gamelabel, gameassignee, current_verson')
        .eq('name', gamename)
        .single();

      if (gameError) throw gameError;

      const labgame = gameData?.gamelabel || '';
      const gameassignee = gameData?.gameassignee || '';
      const current_verson = gameData?.current_verson || '';

      // Fetch build owner
      const { data: buildRows, error: buildError } = await supabase
        .from('builduser')
        .select('username')
        .eq('gamename', gamename)
        .eq('useraction', 'Build Uploaded')
        .order('id', { ascending: false })
        .limit(1);

      if (buildError) throw buildError;

      const buildowner = buildRows?.[0]?.username || '';

      // Insert into builduser
      const command = "Game moves to live";
      const { error: insertError } = await supabase
        .from('builduser')
        .insert([{
          gamename: gamename,
          username: username,
          email: email,
          gameversion: current_verson,
          command: command,
          useraction: useraction,
          lastupdate: currentTime
        }]);

      if (insertError) throw insertError;

      // Update game status
      const { error: updateError } = await supabase
        .from('gameinfodetails')
        .update({ 
          current_status: 'Moved to Live',
          current_verson: current_verson
        })
        .eq('name', gamename);

      if (updateError) throw updateError;

      // Send notification for move to live
      try {
        await sendUINotification(gamename, username, 'move_to_live', 'internal', {
          version: current_verson,
          moved_by: username,
          moved_at: formattedLastUpdate
        });
        console.log(`✅ Move to live notification sent for: ${gamename}`);
      } catch (notificationError) {
        console.error(`❌ Failed to send move to live notification:`, notificationError);
      }

      // Send email notification
      if (gamename) {
        try {
          const smtp = getSMTPConfigs()

        const transporter = nodemailer.createTransport({
          host: smtp.SMTP_HOST,
          port: smtp.SMTP_PORT,
          secure: false,
          auth: {
            user: smtp.SMTP_USER,
            pass: smtp.SMTP_PASS
          }
        });

          const mailHeader = `${gamename} - Moved to Live`;

          const htmlTemplate = `
<body style="margin: 0; padding: 0; background-color: #f2f4f6; font-family: Arial, sans-serif; color: #000;">
  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">

    <!-- Header -->
    <table width="100%" style="background: linear-gradient(90deg, #d4dbdfff, #00c6ff); padding: 0px 20px;">
      <tr>
        <td align="left">
          <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px;background: transparent; display:block;">
        </td>
        <td align="right">
          <img src="${smtp.BASE_URL}/assets/images/emailmessage.png" alt="Message" style="height: 35px;">
        </td>
      </tr>
    </table>

    <!-- Body -->
    <div style="padding: 25px;">
      <p style="font-size: 14px; margin: 0 0 15px;">Hi Team,</p>
      <p style="font-size: 14px; margin: 0 0 20px;">
        <strong>${gamename}</strong> has been moved from 
        <span style="color: #a61321; font-weight: bold;"> Internal</span> 
        to <span style="color: #139FFF; font-weight: bold;"> Live</span>.
      </p>

      <!-- Highlighted Info Box -->
      <div style="background: #f9fbff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
        <p style="margin: 5px 0; font-size: 14px;"><strong style="color: #139FFF;">Phase:</strong> ${labgame}</p>
        <p style="margin: 5px 0; font-size: 14px;"><strong style="color: #a61321;">Environment:</strong> Internal <span style="font-size:14px; margin:0 4px;">➡</span> Live</p>
      </div>

      <!-- Game Details -->
      <table width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Game Name:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${gamename}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Version:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">V${current_verson}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Developer Name:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${buildowner}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Moved By:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${username}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Moved Date & Time:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${formattedLastUpdate}</td>
        </tr>
      </table>

      <p style="font-size: 13px; margin-top: 20px; color: #444;">
        The game is moved by <strong>${username}</strong> into the live environment.
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
</body>`;

          const mailOptions = {
            from: smtp.SMTP_FROM || smtp.SMTP_USER,
            to: gameassignee ? [gameassignee, 'saravanant@theunitytech.com'] : ['saravanant@theunitytech.com'],
            cc: [
              'dhineshvinayak@theunitytech.com',
              'vipinsharma.r@theunitytech.com',
              'kavin.s@theunitytech.com',
              'meera.r@theunitytech.com',
              'anjalipriya@theunitytech.com',
              'rathnavel@theunitytech.com',
              email
            ],
            replyTo: email,
            subject: mailHeader,
            html: htmlTemplate,
          };

          await transporter.sendMail(mailOptions);

        } catch (emailError) {
          console.error(`Email error for ${gamename}:`, emailError);
        }
      }
    }

    res.json({
      success: true,
      message: "Selected games moved to Live successfully!"
    });

  } catch (error) {
    console.error("Error moving games to live:", error);
    res.status(500).json({ success: false, message: "Server Error: " + error.message });
  }
});

// ========= REOPEN GAME VERIFICATION =========
router.put("/reopen/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    const { id } = req.params;
    const { reason, gameName, username, email } = req.body;

    if (!reason.trim()) {
      return res.status(400).json({ success: false, message: "Reason required" });
    }

    const currentTime = getCurrentISTForMySQL();
    const formattedLastUpdate = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).toUpperCase();

    // Update game status
    const { error: updateError } = await supabase
      .from('gameinfodetails')
      .update({ current_status: "Reopened" })
      .eq('id', id);

    if (updateError) throw updateError;

    // Log DB Insert
    const { error: insertError } = await supabase
      .from('builduser')
      .insert([{
        gamename: gameName,
        username: username,
        email: email,
        command: reason,
        useraction: "Reopened",
        lastupdate: currentTime
      }]);

    if (insertError) throw insertError;

    // Get phase & version for mail
    const { data: infoRows, error: infoError } = await supabase
      .from('gameinfodetails')
      .select('gamelabel, current_verson')
      .eq('name', gameName)
      .single();

    if (infoError) throw infoError;

    const phase = infoRows?.gamelabel || "--";
    const currentVersion = infoRows?.current_verson || "Unknown";

    // Send notification for game reopened
    try {
      await sendUINotification(gameName, username, 'game_reopened', 'internal', {
        version: currentVersion,
        reason: reason,
        reopened_at: formattedLastUpdate
      });
      console.log(`✅ Game reopened notification sent for: ${gameName}`);
    } catch (notificationError) {
      console.error(`❌ Failed to send game reopened notification:`, notificationError);
    }

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

    const mailSubject = `${gameName} Has been Reopened By ${username}`;

    const htmlTemplate = `
<body style="margin: 0; padding: 0; background-color: #f2f4f6; font-family: Arial, sans-serif; color: #000;">
  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">

    <table width="100%" style="background: linear-gradient(90deg, #d4dbdfff, #00c6ff); padding: 0px 20px;">
      <tr>
        <td align="left">
          <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" style="height: 70px;">
        </td>
        <td align="right">
          <img src="${smtp.BASE_URL}/assets/images/emailmessage.png" style="height: 35px;">
        </td>
      </tr>
    </table>

    <div style="padding: 25px;">
      <p style="font-size: 14px;">Hi Team,</p>
      <p style="font-size: 14px;">The ${gameName} has been Reopened.</p>

      <div style="background: #f9fbff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
        <p><strong style="color: darkblue;">Phase:</strong> ${phase}</p>
        <p><strong style="color: #a61321;">Environment:</strong> Internal Testing</p>
      </div>

      <table width="100%" style="border-collapse: collapse;">
        <tr><td><strong>Game Name:</strong></td><td>${gameName}</td></tr>
        <tr><td><strong>Reopened Version:</strong></td><td>${currentVersion}</td></tr>
        <tr><td><strong>Reopened Time:</strong></td><td>${formattedLastUpdate}</td></tr>
        <tr><td><strong>Reopened By:</strong></td><td>${username}</td></tr>
        <tr><td><strong>Reason:</strong></td><td>${reason}</td></tr>
      </table>
    </div>

    <div style="background: #f9f9f9; text-align: center; padding: 15px;">
      <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" style="height: 70px;">
      <p style="font-size: 11px;">©2024 <span style="color: #139FFF;">Lootrix</span>. All Rights Reserved.</p>
    </div>

  </div>
</body>
`;

    await transporter.sendMail({
      from: smtp.SMTP_FROM || smtp.SMTP_USER,
      to: ["kavin.s@theunitytech.com", "meera.r@theunitytech.com", "anjalipriya@theunitytech.com", "rathnavel@theunitytech.com"],
      cc: ["dhineshvinayak@theunitytech.com", "saravanant@theunitytech.com"],
      replyTo: email,
      subject: mailSubject,
      html: htmlTemplate,
    });

    res.json({ success: true, message: "Game verification reopened & email sent successfully" });

  } catch (error) {
    console.error("Error reopen:", error);
    res.status(500).json({ success: false, message: "Server Error: " + error.message });
  }
});

// ========= DOWNLOAD GAME AS ZIP =========
router.get("/download/:gameName", async (req, res) => {
  try {
    const supabase = getSupabase();
    const s3 = getS3();
    const { gameName } = req.params;
    const { username, email } = req.query;

    // Get game version
    const { data: versionRows, error: versionError } = await supabase
      .from('gameinfodetails')
      .select('current_verson')
      .eq('name', gameName)
      .single();

    if (versionError) throw versionError;

    const currentVersion = versionRows?.current_verson || "Unknown";

    const currentTime = new Date().toISOString();

    // Log download
    const { error: insertError } = await supabase
      .from('builduser')
      .insert([{
        gamename: gameName,
        username: username,
        email: email,
        gameversion: currentVersion,
        command: "Game Download",
        useraction: "Download",
        lastupdate: currentTime
      }]);

    if (insertError) throw insertError;

    const objects = await s3.listObjectsV2({
      Bucket: process.env.S3_BUCKET_NAME,
      Prefix: `${gameName}/`,
    }).promise();

    if (!objects.Contents?.length) {
      return res.status(404).json({
        success: false,
        message: `No files found for the game: ${gameName}`,
      });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${gameName}.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", (err) => {
      console.error("Archive error:", err);
      res.status(500).send("Error creating ZIP file");
    });

    archive.pipe(res);

    for (const object of objects.Contents) {
      const s3Key = object.Key;
      
      // Skip if it's just the folder itself (ends with /)
      if (s3Key.endsWith('/')) continue;
      
      try {
        const fileData = await s3.getObject({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: s3Key,
        }).promise();

        // Extract the relative path after the game name
        const relativePath = s3Key.substring(gameName.length + 1); // +1 for the slash
        
        // Create the new path: gameName/ + relativePath
        const zipEntryPath = `${gameName}/${relativePath}`;
        
        archive.append(fileData.Body, { name: zipEntryPath });
      } catch (err) {
        console.error(`Error adding file ${s3Key}:`, err);
      }
    }

    await archive.finalize();
  } catch (error) {
    console.error("Error downloading:", error);
    res.status(500).json({ success: false, message: "Download failed" });
  }
});

export default router;