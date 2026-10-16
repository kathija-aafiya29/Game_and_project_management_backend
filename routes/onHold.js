const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const { getSMTPConfig, getDBConfig } = require("../config/config");

// Configure email transporter using environment variables

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

// Helper function to get current IST time in MySQL format
const getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30 in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

// Helper function to format date for display in IST
const formatDateForDisplay = (date) => {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
};

// Helper function to send UI notifications for hold-game action
async function sendUINotification(gameName, username, holdReason) {
    const supabase = getSupabase();
    
    try {
        console.log('🎯 Sending UI notification for hold-game:', {
            gameName,
            username,
            holdReason
        });

        // Get recipients - similar to your email logic
        // Get users from builduser table
        const { data: buildUsers, error: buildError } = await supabase
            .from('builduser')
            .select('email')
            .eq('gamename', gameName)
            .neq('email', username)
            .not('email', 'is', null);

        if (buildError) {
            console.error('Error fetching build users:', buildError);
        }

        // Get users from gameinfodetails table
        const { data: gameUsers, error: gameError } = await supabase
            .from('gameinfodetails')
            .select('gameassignee')
            .eq('name', gameName)
            .not('gameassignee', 'is', null);

        if (gameError) {
            console.error('Error fetching game users:', gameError);
        }

        // Combine users
        const usersToNotify = [
            ...(buildUsers || []).map(u => u.email).filter(Boolean),
            ...(gameUsers || []).map(u => u.gameassignee).filter(Boolean)
        ];

        // Default recipients as per your email list
        const defaultRecipients = [
            'dhineshvinayak@theunitytech.com',
            'kavin.s@theunitytech.com',
            'meera.r@theunitytech.com',
            'anjalipriya@theunitytech.com',
            'rathnavel@theunitytech.com',
            'saravanant@theunitytech.com',
            'vishaalpremkumar@theunitytech.com',
        ];

        // Combine and deduplicate recipients
        const allUsers = [
            ...new Set([
                ...defaultRecipients,
                ...usersToNotify
            ])
        ];

        console.log(`📧 Total recipients for hold notification: ${allUsers.length}`);
        
        // Get current IST time for notification timestamp
        const currentTime = getCurrentISTForMySQL();
        
        // Create notification object for hold-game
        const notificationTemplate = {
            type: 'game_hold_status',
            title: `${gameName} - Marked as on hold`,
            message: `${username} put the game on hold.`,
            context: {
                game_name: gameName,
                marked_by: username,
                hold_reason: holdReason,
                action: 'On-Hold',
                timestamp: currentTime
            },
            source_id: gameName,
            environment: 'internal',
            is_read: false
        };

        // Process each user
        for (const userEmail of allUsers) {
            // Skip the uploader (the person who marked it on hold)
            if (userEmail === username) {
                console.log(`⏭️ Skipping notification for uploader: ${userEmail}`);
                continue;
            }

            console.log(`📨 Preparing hold notification for: ${userEmail}`);

            try {
               
                // 2. INSERT NOTIFICATION INTO DATABASE
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
                    .select();

                if (insertError) {
                    console.error(`Error inserting notification for ${userEmail}:`, insertError);
                    continue;
                }

                const result = insertedData && insertedData[0];
                console.log(`✅ Database hold notification inserted for ${userEmail}, ID: ${result?.id || 'unknown'}`);

                // 3. PREPARE WEBSOCKET NOTIFICATION
                const wsNotification = {
                    type: 'notification',
                    data: {
                        id: result?.id || 'unknown',
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

                // 4. SEND WEBSOCKET NOTIFICATION
                if (global.sendNotification) {
                    console.log(`📡 Sending WebSocket hold notification to ${userEmail}`);
                    try {
                        const sent = await global.sendNotification(
                            userEmail, 
                            wsNotification.data,
                            { 
                                shouldNotifySelf: false // Skip self-notification
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

                // Small delay between users
                await new Promise(resolve => setTimeout(resolve, 50));

            } catch (userError) {
                console.error(`❌ Error processing hold notification for ${userEmail}:`, userError);
                // Continue with other users
                continue;
            }
        }

        console.log('✅ All hold notifications sent successfully');

    } catch (error) {
        console.error('❌ Error in sendUINotification (hold-game):', error);
        // Don't throw error to prevent breaking the main hold-game flow
        console.log('⚠️ Continuing despite notification error');
    }
}

// POST /api/hold-game - Put game on hold
router.post('/hold-game', async (req, res) => {
  console.log('Received hold game request:', req.body);

  const {
    holdgamename: gamename,
    commandinputhold,
    username,
    email: useremail
  } = req.body;

  try {
    // Validate required fields
    if (!gamename || !commandinputhold || !username || !useremail) {
      return res.status(400).json({
        code: 400,
        response: "Game name, hold reason, username, and email are required"
      });
    }

    // Use IST time for all operations
    const currentTime = getCurrentISTForMySQL();
    const currentTimeForDisplay = formatDateForDisplay(new Date());
    const useraction = "On-Hold";

    console.log(`Processing hold request for game: ${gamename}, user: ${username}`);
    console.log(`Current IST Time: ${currentTime}`);
    console.log(`Current IST Time for Display: ${currentTimeForDisplay}`);

    // Get Supabase client
    const supabase = getSupabase();

    // Get game details from database
    const { data: labelResults, error: labelError } = await supabase
        .from('gameinfodetails')
        .select('gamelabel, gameassignee, current_verson')
        .eq('name', gamename);

    if (labelError) {
      console.error('Error fetching game details:', labelError);
      throw new Error('Failed to fetch game details');
    }

    let labgame = '';
    let gameassignee = '';
    let current_version = '';

    if (labelResults && labelResults.length > 0) {
      const lab = labelResults[0];
      labgame = lab.gamelabel;
      gameassignee = lab.gameassignee;
      current_version = lab.current_verson;
    }

    console.log(`Game details: Label=${labgame}, Assignee=${gameassignee}, Version=${current_version}`);

    // Get build owner email
    const { data: buildOwnerResults, error: buildOwnerError } = await supabase
        .from('builduser')
        .select('email')
        .eq('gamename', gamename)
        .eq('useraction', 'Build Uploaded')
        .order('id', { ascending: false })
        .limit(1);

    if (buildOwnerError) {
      console.error('Error fetching build owner:', buildOwnerError);
    }
    
    let buildowner = '';
    if (buildOwnerResults && buildOwnerResults.length > 0) {
      buildowner = buildOwnerResults[0].email;
    }

    console.log(`Build owner: ${buildowner}`);

    // Insert into builduser table
    const { data: insertResult, error: insertError } = await supabase
        .from('builduser')
        .insert({
          gamename: gamename,
          username: username,
          email: useremail,
          gameversion: current_version,
          command: commandinputhold,
          useraction: useraction,
          lastupdate: currentTime
        })
        .select();

    if (insertError) {
      console.error('Error inserting into builduser:', insertError);
      throw new Error('Failed to insert build record');
    }

    console.log(`Data inserted into builduser table with ID: ${insertResult?.[0]?.id || 'unknown'}`);

    // Update game status to On-Hold
    const { error: updateError } = await supabase
        .from('gameinfodetails')
        .update({ current_status: 'On-Hold' })
        .eq('name', gamename);

    if (updateError) {
      console.error('Error updating game status:', updateError);
      throw new Error('Failed to update game status');
    }

    console.log(`Game status updated to On-Hold for: ${gamename}`);

    // Send email notification
    let emailResponse = "Build Uploaded without sending email";
    let emailCode = 200;
    await sendUINotification(gamename, username, commandinputhold);


    if (gamename) {
      try {
        const mailHeader = `${gamename} - Marked as On-Hold`;

        // Get game assignee username for email
        let gameassignee_username = 'Unassigned';
        if (gameassignee) {
          try {
            gameassignee_username = gameassignee.split('@')[0];
          } catch (keycloakError) {
            console.error('Keycloak username fetch failed:', keycloakError);
            gameassignee_username = 'Token Expired';
          }
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

        const emailBody = `
          <body style="margin: 0; padding: 0; background-color: #f2f4f6; font-family: Arial, sans-serif;">

            <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

              <!-- Header -->
              <table width="100%" style="background: linear-gradient(135deg, #d4dbdfff, #67c9ff); padding: 15px;">
                <tr>
                  <td align="left">
                    <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px;background: transparent; display:block;">
                  </td>
                  <td align="right">
                    <img src="${smtp.BASE_URL || 'https://yourdomain.com'}/assets/images/emailmessage.png" alt="Message" style="height: 40px;">
                  </td>
                </tr>
              </table>

              <!-- Body -->
              <div style="padding: 30px; color: #333;">
                <p style="font-size: 16px; font-weight: 600; margin: 0 0 20px;">Dear Team,</p>

                <p style="font-size: 14px; line-height: 22px; margin: 0 0 15px;">
                  The game <strong style="color:#139FFF;">${gamename}</strong> has been marked as 
                  <span style="background:#ffe9e9; color:#e63946; font-weight: 600; padding: 2px 6px; border-radius: 4px;">On-Hold</span> 
                  due to the following reason:
                </p>

                <div style="background:#f9f9f9; border-left: 4px solid #139FFF; padding: 12px 15px; margin: 15px 0; font-size: 14px; color:#444;">
                  <strong>Reason:</strong> ${commandinputhold}
                </div>

                <table style="width:100%; font-size: 14px; color: #444; margin-top: 15px;">
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Game Name:</strong></td>
                    <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${gamename}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Marked On-Hold By:</strong></td>
                    <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${username}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Date & Time:</strong></td>
                    <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${currentTimeForDisplay}</td>
                  </tr>
                </table>
              </div>

              <!-- Footer -->
              <div style="background: #f2f8ff; padding: 20px; text-align: center;">
                <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px; background: transparent;">
                <p style="font-size: 11px; color: #999; margin: 0;">
                  ©2026 <span style="color: #139FFF; font-weight: 600;">Unity one</span>. All Rights Reserved.
                </p>
              </div>

            </div>

          </body>
        `;

        // Prepare email recipients
        const toAddresses = [];
        const ccAddresses = [];

        // Add game assignee if exists
        if (gameassignee) {
          toAddresses.push(gameassignee);
        }

        // Add required addresses
        toAddresses.push('dhineshvinayak@theunitytech.com');
        
        // Add build owner if exists
        if (buildowner) {
          toAddresses.push(buildowner);
        }

        // Add CC addresses
        ccAddresses.push('kavin.s@theunitytech.com');
        ccAddresses.push('meera.r@theunitytech.com');
        ccAddresses.push('anjalipriya@theunitytech.com');
        ccAddresses.push('saravanant@theunitytech.com');
        ccAddresses.push('rathnavel@theunitytech.com');

        const mailOptions = {
          from: smtp.SMTP_FROM || smtp.SMTP_USER,
          to: toAddresses.join(','),
          cc: ccAddresses.join(','),
          replyTo: useremail,
          subject: mailHeader,
          html: emailBody
        };

        const emailResult = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', emailResult.messageId);

        emailResponse = 'Message and confirmation have been sent successfully!';
        emailCode = 200;

      } catch (emailError) {
        console.error('Email sending failed:', emailError);
        emailResponse = `Message could not be sent. Mailer Error: ${emailError.message}`;
        emailCode = 400;
      }
    }

    res.json({
      code: emailCode,
      response: emailResponse,
      gameName: gamename,
      timestamp: currentTime,
      timestampDisplay: currentTimeForDisplay
    });

  } catch (error) {
    console.error('Error putting game on hold:', error);
    res.status(500).json({
      code: 500,
      response: "Internal server error: " + error.message
    });
  }
});

module.exports = router;