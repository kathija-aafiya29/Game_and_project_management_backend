import express from 'express';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { getDBConfig, getSMTPConfig } from "../config/config.js";
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
   SMTP CONFIG
========================================= */

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

// Helper function to convert UTC date from database to IST for display
const convertUTCToIST = (utcDate) => {
    if (!utcDate) return '';
    const date = new Date(utcDate);
    return formatDateForDisplay(date);
};

// Helper function to send UI notifications for testing summary
async function sendUINotification(gameName, username, iteration, totalBugs = 0) {
    const supabase = getSupabase();

    try {
        console.log('🎯 Sending UI notification for testing summary:', {
            gameName,
            username,
            iteration,
            totalBugs
        });

        // Get recipients - using Supabase queries
        // First query: Get users from builduser table
        const { data: buildUsers, error: buildUsersError } = await supabase
            .from('builduser')
            .select('email')
            .eq('gamename', gameName)
            .not('email', 'is', null)
            .neq('email', username);

        if (buildUsersError) {
            console.error('Error fetching build users:', buildUsersError);
        }

        // Second query: Get game assignee from gameinfodetails
        const { data: gameDetails, error: gameDetailsError } = await supabase
            .from('gameinfodetails')
            .select('gameassignee')
            .eq('name', gameName)
            .not('gameassignee', 'is', null);

        if (gameDetailsError) {
            console.error('Error fetching game details:', gameDetailsError);
        }

        // Default recipients as per your email list
        const defaultRecipients = [
            'dhineshvinayak@theunitytech.com',
            'kavin.s@theunitytech.com',
            'meera.r@theunitytech.com',
            'anjalipriya@theunitytech.com',
            'saravanant@theunitytech.com',
            'rathnavel@theunitytech.com'
        ];

        // Combine and deduplicate recipients
        const allUsers = [
            ...new Set([
                ...defaultRecipients,
                ...(buildUsers || []).map(u => u.email).filter(Boolean),
                ...(gameDetails || []).map(g => g.gameassignee).filter(Boolean)
            ])
        ];

        console.log(`📧 Total recipients for testing summary notification: ${allUsers.length}`);

        // Get current IST time for notification timestamp
        const currentTime = getCurrentISTForMySQL();

        // Get game details for context
        const { data: gamePhaseData, error: gamePhaseError } = await supabase
            .from('gameinfodetails')
            .select('gamelabel')
            .eq('name', gameName)
            .single();

        if (gamePhaseError) {
            console.error('Error fetching game phase:', gamePhaseError);
        }

        const environment = gamePhaseData ? 'Internal Testing' : 'Testing';

        // Calculate total bugs if not provided
        let bugsCount = totalBugs;

        // Create notification object for testing summary
        const notificationTemplate = {
            type: 'testing_completed',
            title: `${gameName} - Testing Completed, Bugs Reported`,
            message: `${username} reported bugs in Iteration ${iteration}`,
            context: {
                game_name: gameName,
                tester_name: username,
                iteration: iteration,
                total_bugs: bugsCount,
                environment: environment,
                action: 'Testing Completed',
                status: 'Pending on Dev Team',
                timestamp: currentTime
            },
            source_id: gameName,
            environment: 'internal',
            is_read: false
        };

        // Process each user
        for (const userEmail of allUsers) {
            // Skip the tester who submitted the testing summary
            if (userEmail === username) {
                console.log(`⏭️ Skipping notification for tester: ${userEmail}`);
                continue;
            }

            console.log(`📨 Preparing testing summary notification for: ${userEmail}`);

            try {
                // 1. CHECK FOR RECENT DUPLICATE NOTIFICATION (within 1 minute)
                const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
                
                const { data: duplicateCheck, error: duplicateError } = await supabase
                    .from('notifications')
                    .select('id')
                    .eq('user_id', userEmail)
                    .eq('type', 'testing_completed')
                    .eq('source_id', gameName)
                    .eq('context->>iteration', iteration.toString())
                    .gte('created_at', oneMinuteAgo)
                    .limit(1);

                if (duplicateError) {
                    console.error('Error checking duplicates:', duplicateError);
                }

                if (duplicateCheck && duplicateCheck.length > 0) {
                    console.log(`⚠️ Duplicate testing notification prevented for ${userEmail} (recent entry exists)`);
                    continue;
                }

                // 2. INSERT NOTIFICATION INTO DATABASE
                const { data: notificationData, error: insertError } = await supabase
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
                    throw new Error(insertError.message);
                }

                console.log(`✅ Database testing notification inserted for ${userEmail}, ID: ${notificationData.id}`);
                
                // 4. SEND WEBSOCKET NOTIFICATION
                if (global.sendNotification) {
                    console.log(`📡 Sending WebSocket testing notification to ${userEmail}`);
                    try {
                        const wsNotification = {
                            type: 'notification',
                            data: {
                                id: notificationData.id,
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

                        const sent = await global.sendNotification(userEmail, wsNotification.data);

                        if (!sent) {
                            console.log(`⚠️ ${userEmail} not connected via WebSocket`);
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
                console.error(`❌ Error processing testing notification for ${userEmail}:`, userError);
                // Continue with other users
                continue;
            }
        }

        console.log('✅ All testing summary notifications sent successfully');

    } catch (error) {
        console.error('❌ Error in sendUINotification (testing-summary):', error);
        // Don't throw error to prevent breaking the main flow
        console.log('⚠️ Continuing despite notification error');
    }
}

// GET /api/bug-stats/:game_id - Get bug statistics by game_id
router.get('/bug-stats/:game_id', async (req, res) => {
    const { game_id } = req.params;

    if (!game_id) {
        return res.status(400).json({
            success: false,
            error: 'Game ID is required'
        });
    }

    try {
        const supabase = getSupabase();
        
        // Get bug statistics using Supabase
        const { data: bugStats, error } = await supabase
            .from('bug_details')
            .select('status')
            .eq('game_id', game_id)
            .is('deleted_at', null);

        if (error) {
            throw new Error(error.message);
        }

        // Calculate statistics in JavaScript
        const stats = {
            newBugs: 0,
            reopenedBugs: 0,
            onHoldBugs: 0,
            closedBugs: 0
        };

        if (bugStats) {
            for (const bug of bugStats) {
                switch (bug.status) {
                    case 1:
                        stats.newBugs++;
                        break;
                    case 5:
                        stats.reopenedBugs++;
                        break;
                    case 4:
                        stats.onHoldBugs++;
                        break;
                    case 6:
                        stats.closedBugs++;
                        break;
                }
            }
        }

        console.log(`Bug stats for game_id ${game_id}:`, stats);

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('Error fetching bug stats:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// POST /api/testing-summary - Submit testing summary
router.post('/testing-summary', async (req, res) => {
    console.log('Received testing summary data:', req.body);

    const {
        game_name,
        game_id,
        username,
        email,
        totalTestCases,
        testCasesPassed,
        failedCases,
        newBugs,
        reopenedBugs,
        onHoldBugs,
        closedBugs,
        iteration,
        testCaseLink,
        note
    } = req.body;

    try {
        // Validate required fields
        if (!game_name || !username || !email) {
            return res.status(400).json({
                success: false,
                error: 'Game name, username, and email are required'
            });
        }

        // Use IST time for all operations
        const currentTime = getCurrentISTForMySQL();
        const currentTimeForDisplay = formatDateForDisplay(new Date());

        console.log(`Processing testing summary for game: ${game_name}, user: ${username}`);
        console.log(`Current IST Time: ${currentTime}`);
        console.log(`Current IST Time for Display: ${currentTimeForDisplay}`);

        // Get Supabase client
        const supabase = getSupabase();

        // First, get game details from the database
        const { data: gameResults, error: gameError } = await supabase
            .from('gameinfodetails')
            .select(`
                gamelabel,
                current_verson,
                name
            `)
            .eq('name', game_name)
            .single();

        if (gameError || !gameResults) {
            return res.status(404).json({
                success: false,
                error: 'Game not found in database'
            });
        }

        // Get build user details
        const { data: buildUserData, error: buildUserError } = await supabase
            .from('builduser')
            .select('username, email, lastupdate')
            .eq('gamename', game_name)
            .in('useraction', ['Build Uploaded', 'Build is uploaded and moved to testing'])
            .order('id', { ascending: false })
            .limit(1);

        if (buildUserError) {
            console.error('Error fetching build user:', buildUserError);
        }

        const buildUser = buildUserData && buildUserData.length > 0 ? buildUserData[0] : null;

        const gameData = gameResults;
        const phase = gameData.gamelabel;
        const environment = 'Internal Testing';

        // Convert build_shared_time from database to IST for display
        const buildSharedTime = buildUser ? new Date(buildUser.lastupdate) : new Date();
        const build_shared_time_ist = convertUTCToIST(buildSharedTime);

        const game_owner = buildUser ? buildUser.username : 'Unknown';
        const demail = buildUser ? buildUser.email : '';
        const current_verson = gameData.current_verson;

        console.log(`Game details found: ${game_name}, Phase: ${phase}, Version: ${current_verson}`);

        // Insert into revert table with IST time
        const { data: insertResult, error: insertError } = await supabase
            .from('revert')
            .insert({
                game_name: game_name,
                tester_name: username,
                tester_email: email,
                note: note || '',
                total_test_cases: totalTestCases || 0,
                test_cases_passed: testCasesPassed || 0,
                failed_cases: failedCases || 0,
                new_bugs: newBugs || 0,
                reopened: reopenedBugs || 0,
                hold: onHoldBugs || 0,
                closed_bugs: closedBugs || 0,
                iteration: iteration || 1,
                test_case_link: testCaseLink || '',
                added_at: currentTime
            })
            .select('id')
            .single();

        if (insertError) {
            throw new Error(insertError.message);
        }

        console.log(`Data inserted into revert table with ID: ${insertResult.id}`);

        // Update game status with IST time
        const { error: updateError } = await supabase
            .from('gameinfodetails')
            .update({
                current_status: 'Pending on Dev Team',
                gameassignee: email,
                last_transfered: currentTime
            })
            .eq('name', game_name);

        if (updateError) {
            throw new Error(updateError.message);
        }

        console.log(`Game status updated for: ${game_name}`);
        
        // Send UI notification
        await sendUINotification(game_name, username, iteration, newBugs);

        const smtp = getSMTPConfigs();
    
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

        try {
            const mailHeader = `${game_name} - Bugs Updated`;

            const emailBody = `
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
                        The <strong>Testing Team</strong> has completed the testing. Please find the details below:
                    </p>

                    <!-- Highlighted Info Box -->
                    <div style="background: #f9fbff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
                        <p style="margin: 5px 0; font-size: 14px;">
                            <strong style="color: #139FFF;">Phase:</strong> ${phase}
                        </p>
                        <p style="margin: 5px 0; font-size: 14px;">
                            <strong style="color: #a61321;">Environment:</strong> ${environment}
                        </p>
                    </div>

                    <!-- Game Details -->
                    <table width="100%" style="border-collapse: collapse;">
                        <tr>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Game Name:</strong></td>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${game_name}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Current Version:</strong></td>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${current_verson}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Build Shared Date & Time:</strong></td>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${build_shared_time_ist}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Iteration:</strong></td>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${iteration}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Testing Completed At:</strong></td>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${currentTimeForDisplay}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Game Owner:</strong></td>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${game_owner}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Tester Name:</strong></td>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${username}</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;"><strong>Note:</strong></td>
                            <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #ccc;">${note || 'N/A'}</td>
                        </tr>
                    </table>

                    <!-- Summary -->
                    <div style="margin-top: 20px; font-size: 13px; color: #444;">
                        <p style="margin: 4px 0;"><strong>Testing Summary:</strong></p>
                        <p style="margin: 4px 0;">- Total Test Cases: ${totalTestCases}</p>
                        <p style="margin: 4px 0;">- Test Cases Passed: ${testCasesPassed}</p>
                        <p style="margin: 4px 0;">- Failed Cases: ${failedCases}</p>
                        <p style="margin: 4px 0;">- New Bugs Reported: ${newBugs}</p>
                        <p style="margin: 4px 0;">- Reopened Bugs: ${reopenedBugs}</p>
                        <p style="margin: 4px 0;">- Bugs on Hold: ${onHoldBugs}</p>
                        <p style="margin: 4px 0;">- Bugs Closed: ${closedBugs}</p>
                        <p style="margin: 4px 0;">- Test Case Link: ${testCaseLink || 'N/A'}</p>
                    </div>
                </div>

                <!-- Footer -->
                <div style="background: #f9f9f9; text-align: center; padding: 15px;">
              <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px; background: transparent;">
              <p style="margin: 0; font-size: 11px; color: #777;">
                ©2026 <span style="color: #139FFF;">Unity one</span>. All Rights Reserved.
              </p>
            </div>
            </div>
        </body>
      `;

            const mailOptions = {
                from: smtp.SMTP_FROM,
                to: demail,
                cc: [
                    email,
                    'dhineshvinayak@theunitytech.com',
                    'kavin.s@theunitytech.com',
                    'meera.r@theunitytech.com',
                    'anjalipriya@theunitytech.com',
                    'saravanant@theunitytech.com',
                    'rathnavel@theunitytech.com',
                ].filter(Boolean).join(','),
                replyTo: email,
                subject: mailHeader,
                html: emailBody
            };

            const emailResult = await transporter.sendMail(mailOptions);
            console.log('Email sent successfully:', emailResult.messageId);

        } catch (emailError) {
            console.error('Email sending failed:', emailError);
            // Continue even if email fails - don't fail the whole request
        }

        res.json({
            success: true,
            message: 'Testing summary submitted successfully',
            insertId: insertResult.id,
            gameUpdated: true,
            emailSent: true,
            timestamp: currentTime,
            timestampDisplay: currentTimeForDisplay
        });

    } catch (error) {
        console.error('Error submitting testing summary:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

export default router;