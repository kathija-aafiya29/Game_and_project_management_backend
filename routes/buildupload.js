import express from 'express';
import multer from 'multer';
import AWS from 'aws-sdk';
import nodemailer from 'nodemailer';
import path from 'path';
import JSZip from 'jszip';
import { createClient } from '@supabase/supabase-js';

// Import configuration
import { getS3Config, getSMTPConfig } from "../config/config.js";

const router = express.Router();

/* =========================================
   SUPABASE CONFIG - Direct from environment
========================================= */

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing in environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
};

/* =========================================
   AWS S3 CONFIG
========================================= */

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

// Configure multer for file upload with size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 150 * 1024 * 1024, // 150MB limit
  },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.zip') {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  }
});

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

// Helper function to get MIME type by extension
function getMimeTypeByExtension(ext) {
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain'
  };
  return mimeTypes[ext.toLowerCase()] || 'application/octet-stream';
}

// Helper function to increment version
function getNextVersion(currentVersion) {
  if (!currentVersion) return '1.0';
  const parts = currentVersion.split('.');
  if (parts.length === 2) {
    const major = parts[0];
    const minor = parseInt(parts[1]) + 1;
    return `${major}.${minor}`;
  }
  return `${currentVersion}.1`;
}

// Helper function to remove the extra folder level from path
function getCorrectS3Path(gameName, relativePath) {
  const gameNamePrefix = `${gameName}/`;
  if (relativePath.startsWith(gameNamePrefix)) {
    return relativePath.substring(gameNamePrefix.length);
  }
  return relativePath;
}

// Helper function to send UI notifications for build upload
async function sendUINotification(gameName, username, version) {
  const supabase = getSupabase();
  
  try {
    console.log('🎯 Sending UI notification for build upload:', {
      gameName,
      username,
      version
    });

    // Get the uploader's email from builduser table where useraction = 'Build Uploaded'
    const { data: uploaderData, error: uploaderError } = await supabase
      .from('builduser')
      .select('email')
      .eq('gamename', gameName)
      .eq('useraction', 'Build Uploaded')
      .not('email', 'is', null)
      .order('lastupdate', { ascending: false })
      .limit(1);

    if (uploaderError) {
      console.error('Error fetching uploader email:', uploaderError);
    }

    // Get gameassignee from gameinfodetails
    const { data: assigneeData, error: assigneeError } = await supabase
      .from('gameinfodetails')
      .select('gameassignee')
      .eq('name', gameName)
      .not('gameassignee', 'is', null)
      .limit(1);

    if (assigneeError) {
      console.error('Error fetching assignee:', assigneeError);
    }

    // Build recipients array with dynamic emails
    const dynamicRecipients = [];
    
    // Add uploader's email if exists and not the same as username
    if (uploaderData && uploaderData.length > 0 && uploaderData[0].email !== username) {
      dynamicRecipients.push(uploaderData[0].email);
    }
    
    // Add gameassignee email if exists and not the same as username
    if (assigneeData && assigneeData.length > 0 && assigneeData[0].gameassignee !== username) {
      dynamicRecipients.push(assigneeData[0].gameassignee);
    }

    // Default recipients
    const defaultRecipients = [
      // 'dhineshvinayak@theunitytech.com',
      // 'kavin.s@theunitytech.com',
      // 'meera.r@theunitytech.com',
      // 'anjalipriya@theunitytech.com',
      // 'saravanant@theunitytech.com',
      'rathnavel@theunitytech.com'
    ];

    // Combine and deduplicate all recipients (default + dynamic)
    const allUsers = [
      ...new Set([
        ...defaultRecipients,
        ...dynamicRecipients
      ])
    ].filter(email => email && email !== username); // Filter out null/undefined and uploader

    console.log(`📧 Total recipients for build upload notification: ${allUsers.length}`);
    console.log('Dynamic recipients:', dynamicRecipients);
    
    // Get current IST time for notification timestamp
    const currentTime = getCurrentISTForMySQL();
    
    // Get game label for context
    const { data: gameDetails, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('gamelabel')
      .eq('name', gameName)
      .limit(1);

    if (gameError) {
      console.error('Error fetching game details:', gameError);
    }
    
    const environment = gameDetails && gameDetails.length > 0 ? 'Internal Testing' : 'Testing';
    const gameLabel = gameDetails && gameDetails.length > 0 ? gameDetails[0].gamelabel : '';
    
    // Create notification object
    const notificationTemplate = {
      type: 'build_uploaded',
      title: `${gameName} - New Build Ready for Testing`,
      message: `${username} uploaded Build ${version} for testing`,
      context: {
        game_name: gameName,
        developer_name: username,
        version: version,
        environment: environment,
        phase: gameLabel,
        action: 'Build Uploaded',
        status: 'Pending on Testing Team',
        timestamp: currentTime
      },
      source_id: gameName,
      environment: 'internal',
      is_read: false
    };

    // Process each user
    for (const userEmail of allUsers) {
      if (!userEmail) continue;

      console.log(`📨 Preparing build upload notification for: ${userEmail}`);

      try {
        // Check for recent duplicate notification
        const { data: duplicateCheck, error: dupError } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', userEmail)
          .eq('type', 'build_uploaded')
          .eq('source_id', gameName)
          .eq('context->>version', version)
          .gte('created_at', new Date(Date.now() - 60000).toISOString())
          .limit(1);

        if (dupError) {
          console.error('Error checking duplicate:', dupError);
        }

        if (duplicateCheck && duplicateCheck.length > 0) {
          console.log(`⚠️ Duplicate build upload notification prevented for ${userEmail}`);
          continue;
        }

        // Insert notification into database
        const { data: insertData, error: insertError } = await supabase
          .from('notifications')
          .insert([
            {
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
          ])
          .select();

        if (insertError) {
          console.error(`Error inserting notification for ${userEmail}:`, insertError);
          continue;
        }

        console.log(`✅ Database notification inserted for ${userEmail}, ID: ${insertData[0]?.id}`);

        // Send WebSocket notification
        if (global.sendNotification) {
          try {
            await global.sendNotification(
              userEmail,
              {
                id: insertData[0]?.id,
                user_id: userEmail,
                type: notificationTemplate.type,
                title: notificationTemplate.title,
                message: notificationTemplate.message,
                context: notificationTemplate.context,
                source_id: notificationTemplate.source_id,
                environment: notificationTemplate.environment,
                is_read: notificationTemplate.is_read,
                created_at: currentTime
              },
              { shouldNotifySelf: false }
            );
          } catch (wsError) {
            console.error(`❌ WebSocket error for ${userEmail}:`, wsError);
          }
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (userError) {
        console.error(`❌ Error processing notification for ${userEmail}:`, userError);
      }
    }

    console.log('✅ All build upload notifications sent successfully');
  } catch (error) {
    console.error('❌ Error in sendUINotification:', error);
  }
}

// Main upload endpoint
router.post('/upload-build', upload.single('file'), async (req, res) => {
  const s3 = getS3();
  const supabase = getSupabase();
  
  try {
    const { gameName, buildNotes, username, userEmail } = req.body;
    const file = req.file;
    
    const uploadUsername = username || 'system';
    const uploadUserEmail = userEmail || 'system@example.com';
    
    console.log('Upload by:', uploadUsername, uploadUserEmail);

    // Validate required fields
    if (!gameName || !file) {
      return res.status(400).json({
        success: false,
        message: 'Game name and file are required'
      });
    }

    // Check if file name matches game name
    const fileNameWithoutExt = path.basename(file.originalname, '.zip');
    if (fileNameWithoutExt !== gameName) {
      return res.status(400).json({
        success: false,
        message: `Zip file name must match the game name. Expected: ${gameName}, Got: ${fileNameWithoutExt}`
      });
    }

    // Check game status and details
    const { data: gameRows, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('current_status, current_verson, gameassignee, gamelabel')
      .eq('name', gameName);

    if (gameError) {
      throw new Error(gameError.message);
    }

    if (!gameRows || gameRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const game = gameRows[0];
    
    // Check if game can be uploaded
    if (game.current_status === 'Pending on Testing Team') {
      return res.status(400).json({
        success: false,
        message: `${gameName} cannot be uploaded. Testing is in progress.`
      });
    }

    if (game.current_status === 'Verified') {
      return res.status(400).json({
        success: false,
        message: `${gameName} cannot be uploaded. Already verified.`
      });
    }

    // Calculate next version
    const nextVersion = getNextVersion(game.current_verson);

    // Process ZIP file
    const zip = new JSZip();
    const zipData = await zip.loadAsync(file.buffer);
    
    let totalFileCount = 0;
    let totalFolderCount = 0;

    // Delete existing folder in S3
    const folderToDelete = `${gameName}/`;
    
    try {
      const objects = await s3.listObjectsV2({
        Bucket: process.env.S3_BUCKET_NAME,
        Prefix: folderToDelete
      }).promise();

      if (objects.Contents && objects.Contents.length > 0) {
        const deleteObjects = objects.Contents.map(obj => ({ Key: obj.Key }));
        
        await s3.deleteObjects({
          Bucket: process.env.S3_BUCKET_NAME,
          Delete: { Objects: deleteObjects }
        }).promise();
        
        console.log(`Deleted folder and all its contents: ${folderToDelete}`);
      }
    } catch (s3Error) {
      console.log(`Error deleting folder: ${s3Error.message}`);
    }

    // Upload new files to S3
    const uploadPromises = [];
    
    zipData.forEach((relativePath, zipEntry) => {
      if (!zipEntry.dir) {
        const correctRelativePath = getCorrectS3Path(gameName, relativePath);
        
        const pathParts = correctRelativePath.split('/');
        if (pathParts.length === 1) {
          totalFileCount++;
        } else if (pathParts.length > 1 && correctRelativePath.endsWith('/')) {
          totalFolderCount++;
        }

        const uploadPromise = zipEntry.async('nodebuffer').then(fileData => {
          const s3Key = `${gameName}/${correctRelativePath}`;
          const fileExt = path.extname(correctRelativePath);
          
          return s3.upload({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: s3Key,
            Body: fileData,
            ACL: 'public-read',
            ContentType: getMimeTypeByExtension(fileExt),
            ContentDisposition: 'inline'
          }).promise();
        });
        
        uploadPromises.push(uploadPromise);
      }
    });

    await Promise.all(uploadPromises);

    // Insert build record with IST time
    const currentTime = getCurrentISTForMySQL();
    const currentTimeForDisplay = formatDateForDisplay(new Date());
    const userAction = "Build Uploaded";
    const newStatus = "Pending on Testing Team";

    console.log(`Inserting with IST time: ${currentTime}`);
    console.log(`Display time: ${currentTimeForDisplay}`);

    // Insert into builduser table using Supabase
    const { data: insertData, error: insertError } = await supabase
      .from('builduser')
      .insert([
        {
          gamename: gameName,
          username: uploadUsername,
          email: uploadUserEmail,
          gameversion: nextVersion,
          command: buildNotes,
          useraction: userAction,
          lastupdate: currentTime
        }
      ]);

    if (insertError) {
      throw new Error(insertError.message);
    }

    // Update game version and status
    const { error: updateError } = await supabase
      .from('gameinfodetails')
      .update({
        current_verson: nextVersion,
        current_status: newStatus
      })
      .eq('name', gameName);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Send notifications
    try {
      await sendUINotification(gameName, username, nextVersion);
    } catch (notifyError) {
      console.error('Notification error:', notifyError);
    }

    try {
      await sendEmailNotification({
        gameName,
        gameLabel: game.gamelabel,
        currentVersion: nextVersion,
        username: uploadUsername,
        userEmail: uploadUserEmail,
        gameAssignee: game.gameassignee,
        buildNotes,
        currentTime: currentTimeForDisplay
      });
    } catch (emailError) {
      console.error('Email error:', emailError);
    }

    res.json({
      success: true,
      message: 'Build uploaded successfully',
      data: {
        gameName,
        version: nextVersion,
        totalFiles: totalFileCount,
        totalFolders: totalFolderCount,
        uploadedAt: currentTimeForDisplay,
        uploadedBy: uploadUsername
      }
    });

  } catch (error) {
    console.error('Upload error:', error);
    
    // Handle specific error types
    if (error.message && error.message.includes('ZIP')) {
      return res.status(400).json({
        success: false,
        message: 'Failed to process ZIP file'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Email notification function
async function sendEmailNotification({
  gameName,
  gameLabel,
  currentVersion,
  username,
  userEmail,
  gameAssignee,
  buildNotes,
  currentTime
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

    const mailOptions = {
      from: smtp.SMTP_FROM,
      to: gameAssignee ? [gameAssignee, userEmail] : userEmail,
      cc: [
        'dhineshvinayak@theunitytech.com',
        'kavin.s@theunitytech.com',
        'meera.r@theunitytech.com',
        'anjalipriya@theunitytech.com',
        'saravanant@theunitytech.com',
        'rathnavel@theunitytech.com'
      ],
      subject: `${gameName} - Ready for Testing`,
      html: `
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
            <div style="padding: 25px; text-align: left;">
              <p style="font-size: 14px; margin: 0 0 15px;">Hi Team,</p>
              <p style="font-size: 14px; margin: 0 0 20px;">
                The build has been uploaded. Please find the details below:
              </p>

              <!-- Highlighted Info -->
              <div style="background: #f9fbff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
                <p style="margin: 5px 0; font-size: 14px;"><strong style="color: darkblue;">Phase:</strong> ${gameLabel}</p>
                <p style="margin: 5px 0; font-size: 14px;"><strong style="color: #a61321;">Environment:</strong> Internal Testing</p>
              </div>

              <!-- Game Details -->
              <table width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Game Name:</strong></td>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${gameName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Current Version:</strong></td>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${currentVersion}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Uploaded Time:</strong></td>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${currentTime}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Game Owner:</strong></td>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${username}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Tester Name:</strong></td>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${gameAssignee ? gameAssignee.split('@')[0] : 'Unassigned'}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;"><strong>Notes:</strong></td>
                  <td style="padding: 6px 0; font-size: 14px; border-bottom: 1px solid #eee;">${buildNotes || 'No notes provided'}</td>
                </tr>
              </table>

              <p style="font-size: 13px; margin-top: 20px; color: #444;">
                The game is uploaded by the <strong>Dev Team</strong>, and the <strong>Testing Team</strong> can now begin testing.
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
        </body>
      `,
      replyTo: userEmail
    };

    await transporter.sendMail(mailOptions);
    console.log('Email notification sent successfully');
  } catch (emailError) {
    console.error('Failed to send email:', emailError);
  }
}

export default router;