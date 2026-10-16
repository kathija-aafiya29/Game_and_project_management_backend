const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const { getSMTPConfig } = require("../config/config");
const dotenv = require('dotenv');

dotenv.config();

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

// Configure nodemailer transporter (update with your SMTP settings)
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

// Function to get current IST time in MySQL format
function getCurrentIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
}

// Helper function to send UI notifications for checklist verification
async function sendUINotification(gameName, username, totalChecklist) {
    const supabase = getSupabase();
    
    try {
        console.log('🎯 Sending UI notification for checklist verification:', {
            gameName,
            username,
            totalChecklist
        });

        // Get recipients using the same logic
        // First query: Get users from builduser table
        const { data: buildUsers, error: buildUsersError } = await supabase
            .from('builduser')
            .select('email')
            .eq('gamename', gameName)
            .neq('email', username)
            .not('email', 'is', null);

        if (buildUsersError) {
            console.error('Error fetching build users:', buildUsersError);
        }

        // Second query: Get game assignee from gameinfodetails
        const { data: gameAssignee, error: gameAssigneeError } = await supabase
            .from('gameinfodetails')
            .select('gameassignee')
            .eq('name', gameName)
            .not('gameassignee', 'is', null)
            .limit(1);

        if (gameAssigneeError) {
            console.error('Error fetching game assignee:', gameAssigneeError);
        }

        // Combine users from both queries
        const usersToNotify = [];
        
        if (buildUsers && !buildUsersError) {
            usersToNotify.push(...buildUsers.map(u => u.email).filter(Boolean));
        }
        
        if (gameAssignee && !gameAssigneeError && gameAssignee.length > 0) {
            usersToNotify.push(gameAssignee[0].gameassignee);
        }

        // Default recipients (same as your email recipients)
        const defaultRecipients = [
            'kavin.s@theunitytech.com',
            'meera.r@theunitytech.com',
            'anjalipriya@theunitytech.com',
            'rathnavel@theunitytech.com',
            'saravanant@theunitytech.com',
            'dhineshvinayak@theunitytech.com' // Added from CC
        ];

        // Combine and deduplicate recipients
        const allUsers = [
            ...new Set([
                ...defaultRecipients,
                ...usersToNotify.filter(Boolean)
            ])
        ];

        console.log(`📧 Total recipients for checklist notification: ${allUsers.length}`);
        
        // Get current IST time
        const currentTime = getCurrentIST();
        
        // Create notification object for checklist verification
        const notificationTemplate = {
            type: 'checklist_verified',
            title: `${gameName} - Checklist Verified`,
            message: `${username} verified ${totalChecklist} checklist items.`,
            context: {
                game_name: gameName,
                verified_by: username,
                checklist_count: totalChecklist,
                action: 'Verified',
                timestamp: currentTime,
                status: 'Verified'
            },
            source_id: gameName,
            environment: 'internal',
            is_read: false
        };

        // Process each user
        for (const userEmail of allUsers) {
            // Skip the tester who verified the checklist
            if (userEmail === username) {
                console.log(`⏭️ Skipping notification for tester: ${userEmail}`);
                continue;
            }

            console.log(`📨 Preparing checklist notification for: ${userEmail}`);

            try {
                // 1. CHECK FOR RECENT DUPLICATE NOTIFICATION (within 1 minute)
                const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
                
                const { data: duplicateCheck, error: duplicateError } = await supabase
                    .from('notifications')
                    .select('id')
                    .eq('user_id', userEmail)
                    .eq('type', 'checklist_verified')
                    .eq('source_id', gameName)
                    .eq('context->action', 'Verified')
                    .gte('created_at', oneMinuteAgo)
                    .limit(1);

                if (duplicateError) {
                    console.error('Error checking duplicates:', duplicateError);
                }

                if (duplicateCheck && duplicateCheck.length > 0) {
                    console.log(`⚠️ Duplicate checklist notification prevented for ${userEmail} (recent entry exists)`);
                    continue;
                }

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
                    .select()
                    .single();

                if (insertError) {
                    console.error('Error inserting notification:', insertError);
                    continue;
                }

                console.log(`✅ Database checklist notification inserted for ${userEmail}, ID: ${insertedData.id}`);

                // 3. PREPARE WEBSOCKET NOTIFICATION
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

                // 4. SEND WEBSOCKET NOTIFICATION
                if (global.sendNotification) {
                    console.log(`📡 Sending WebSocket checklist notification to ${userEmail}`);
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
                console.error(`❌ Error processing checklist notification for ${userEmail}:`, userError);
                // Continue with other users
                continue;
            }
        }

        console.log('✅ All checklist verification notifications sent successfully');

    } catch (error) {
        console.error('❌ Error in sendUINotification (checklist):', error);
        // Don't throw error to prevent breaking the main verification flow
        console.log('⚠️ Continuing despite notification error');
    }
}

// POST /api/verify-checklist - Handle checklist verification
router.post('/verify-checklist', async (req, res) => {
  const { gameName, timeTaken, timeTakenSeconds, username, email } = req.body;
  const smtp = getSMTPConfigs();
  const supabase = getSupabase();

  try {
    // Validate required parameters
    if (!gameName || !timeTaken || !username || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: gameName, timeTaken, username, email'
      });
    }
    console.log(`Processing checklist verification for game: ${gameName} by user: ${username}`);
    
    // Get game details from Supabase
    const { data: gameRows, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('gamelabel, current_verson, gamecategory')
      .eq('name', gameName);

    if (gameError) {
      throw new Error(gameError.message);
    }

    if (!gameRows || gameRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Game not found'
      });
    }

    const game = gameRows[0];
    const labgame = game.gamelabel;
    const current_verson = game.current_verson;
    const gamecategory = game.gamecategory;

    // Calculate next version
    let currentversion = '1.0';
    if (current_verson && /^\d+(\.\d+)?$/.test(current_verson)) {
      const parts = current_verson.split('.');
      if (parts.length === 2) {
        const major = parseInt(parts[0]) + 1;
        const minor = 0;
        currentversion = `${major}.${minor}`;
      } else {
        const major = parseInt(parts[0]) + 1;
        currentversion = `${major}.0`;
      }
    }

    // 2. Update game status and version
    const { error: updateError } = await supabase
      .from('gameinfodetails')
      .update({
        current_status: 'Verified',
        current_verson: currentversion,
        time_taken: timeTaken
      })
      .eq('name', gameName);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // 3. Insert into builduser table with IST time
    const currentTimeIST = getCurrentIST(); // Get current IST time
    const { error: insertError } = await supabase
      .from('builduser')
      .insert({
        gamename: gameName,
        username: username,
        email: email,
        command: 'Game Verified',
        useraction: 'Verified',
        lastupdate: currentTimeIST
      });

    if (insertError) {
      throw new Error(insertError.message);
    }

    // 4. Get last iteration from revert table
    const { data: iterationRows, error: iterationError } = await supabase
      .from('revert')
      .select('iteration')
      .eq('game_name', gameName)
      .order('id', { ascending: false })
      .limit(1);

    if (iterationError) {
      console.error('Error fetching iteration:', iterationError);
    }

    const latestIteration = iterationRows && iterationRows.length > 0 ? iterationRows[0].iteration : '';

    // 5. Get total checklist count
      const { count, error: checklistError } = await supabase
        .from('ChecklistAddition')
        .select('*', { count: 'exact', head: true })
        .eq('Cat_name', gamecategory);

      if (checklistError) {
        console.error('Checklist count error:', checklistError);
      }

      // The count is available directly from the response
      const totalChecklistCount = count || 0;
      console.log('Total checklist count:', totalChecklistCount);

    // Format date for email (keeping the original for email display)
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

    // Send UI notification
    await sendUINotification(gameName, username, totalChecklist);
    
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
    const mailHeader = `${gameName} Checklist Checked By ${username}`;
    
    const emailHtml = `
<body style="margin: 0; padding: 0; background-color: #f2f4f6; font-family: Arial, sans-serif; color: #000;">
  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">

    <!-- Header -->
    <table width="100%" style="background: linear-gradient(90deg, #d4dbdfff, #00c6ff); padding: 0px 20px;">
                        <tr>
                            <td align="left">
                                <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px;background: transparent; display:block;">
                            </td>
                            <td align="right">
                                <img src="${smtp.BASE_URL || 'https://yourdomain.com'}/assets/images/emailmessage.png" alt="Message" style="height: 35px;">
                            </td>
                        </tr>
                </table>

    <!-- Body -->
    <div style="padding: 25px;">
      <p style="font-size: 14px; margin: 0 0 15px;">Hi Team,</p>
      <p style="font-size: 14px; margin: 0 0 20px;">
        <strong>${gameName}</strong> checklist has been verified by 
        <span style="color: #139FFF; font-weight: bold;">${username}</span>.
      </p>

      <!-- Highlighted Info Box -->
      <div style="background: #f9fbff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
        <p style="margin: 5px 0; font-size: 14px;"><strong style="color: #139FFF;">Phase:</strong> ${labgame}</p>
        <p style="margin: 5px 0; font-size: 14px;"><strong style="color: #a61321;">Environment:</strong> Internal Testing</p>
      </div>

      <!-- Game Details -->
      <table width="100%" style="border-collapse: collapse;">
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Game Name:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${gameName}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Iteration:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${latestIteration}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Date & Time:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${formattedLastUpdate}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>No. of Checklists Verified:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${totalChecklist}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Time Taken:</strong></td>
          <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${timeTaken} Min.</td>
        </tr>
      </table>

      <p style="font-size: 13px; margin-top: 20px; color: #444;">
        Checklist verification has been completed successfully by <strong>${username}</strong>.
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
      from: smtp.SMTP_FROM,
      to: [
        // 'vipinsharma.r@theunitytech.com',
        'kavin.s@theunitytech.com',
        'meera.r@theunitytech.com',
        'anjalipriya@theunitytech.com',
        'rathnavel@theunitytech.com',
        'saravanant@theunitytech.com'
      ].join(','),
      cc: 'dhineshvinayak@theunitytech.com',
      replyTo: email,
      subject: mailHeader,
      html: emailHtml
    };

    // Send email
    await transporter.sendMail(mailOptions);
    console.log('Verification email sent successfully');
    res.json({
      success: true,
      message: 'Checklist verified successfully and email sent',
      data: {
        gameName,
        newVersion: currentversion,
        timeTaken,
        totalChecklist,
        latestIteration,
        timestamp: currentTimeIST
      }
    });

  } catch (error) {
    console.error('Error processing checklist verification:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
});

module.exports = router;