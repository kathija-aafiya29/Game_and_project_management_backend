const express = require("express");
const router = express.Router();
const { getS3Config, getSMTPConfig } = require("../config/config");
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require("uuid");
const AWS = require("aws-sdk");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

// Default game required data
const DEFAULT_GAME_REQUIRED_DATA = {
  betValues: [10, 20, 50, 100],
  maxBetValue: 10000,
  minBetValue: 10,
  incrementValue: 10,
  decrementValue: 10,
  entryAmounts: [10, 20, 50, 100],
  smallBlinds: [10, 20, 50, 100],
  potLimits: [1000, 2000, 5000, 10000],
  chaalLimits: [320, 640, 1600, 3200],
  player_count: 2,
  comission: 0
};

// Helper function to get current IST time
const getCurrentIST = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

// Helper function to convert object literal to JSON string
const convertToValidJSON = (str) => {
  if (!str || typeof str !== 'string' || str.trim() === '') {
    return JSON.stringify(DEFAULT_GAME_REQUIRED_DATA);
  }
  
  try {
    JSON.parse(str);
    return str;
  } catch (e) {
    try {
      const jsonStr = str
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
        .replace(/'/g, '"');
      JSON.parse(jsonStr);
      return jsonStr;
    } catch (error) {
      console.error("Failed to convert to JSON:", error);
      return JSON.stringify(DEFAULT_GAME_REQUIRED_DATA);
    }
  }
};

// Configure AWS SDK
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
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

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

// Upload file to S3
const uploadFileToS3 = async (file, folder) => {
  const params = {
    Bucket: process.env.S3_BUCKET_NAME,
    Key: `${folder}/${Date.now()}_${file.originalname}`,
    Body: file.buffer,
    ContentType: file.mimetype,
    ACL: 'public-read'
  };
   const s3 = getS3();
  try {
    const result = await s3.upload(params).promise();
    return result.Location;
  } catch (error) {
    console.error('S3 upload error:', error);
    throw error;
  }
};

// ✅ NOTIFICATION FUNCTION - Insert into notifications table
async function sendGameNotification(gameName, username, actionType, actionDetails = {}) {
  const supabase = getSupabase();
  
  try {
    console.log(`🎯 Sending game notification for action: ${actionType}`, {
      gameName,
      username,
      actionDetails
    });

    // Get recipients using the same logic
    const { data: buildUsers, error: buildError } = await supabase
      .from('builduser')
      .select('email')
      .eq('gamename', gameName)
      .neq('email', username)
      .not('email', 'is', null);

    const { data: gameInfo, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('gameassignee')
      .eq('name', gameName)
      .not('gameassignee', 'is', null);

    let allEmails = [];

    if (!buildError && buildUsers) {
      allEmails = allEmails.concat(buildUsers.map(u => u.email).filter(Boolean));
    }

    if (!gameError && gameInfo) {
      allEmails = allEmails.concat(gameInfo.map(g => g.gameassignee).filter(Boolean));
    }

    // Default recipients
    const defaultRecipients = [
      'kavin.s@theunitytech.com',
      'meera.r@theunitytech.com',
      'anjalipriya@theunitytech.com',
      'rathnavel@theunitytech.com',
      'saravanant@theunitytech.com',
      'dhineshvinayak@theunitytech.com'
    ];

    // Combine and deduplicate recipients
    const allUsers = [
      ...new Set([
        ...defaultRecipients,
        ...allEmails
      ])
    ];

    console.log(`📧 Total recipients for ${actionType} notification: ${allUsers.length}`);
    
    // Get current IST time
    const currentTime = getCurrentIST();
    
    // Define notification templates based on action type with the exact messages requested
    const notificationTemplates = {
      'add': {
        type: 'game_added',
        title: `${gameName} – New Game Created`,
        message: `${username} created a new game`,
        action: 'Created'
      },
      'game_data_updated': {
        type: 'game_data_updated',
        title: `${gameName} – Game Data Updated`,
        message: `${username} updated the required game configuration data`,
        action: 'Game Data Updated'
      },
      'category_change': {
        type: 'game_category',
        title: `${gameName} – Game Category Updated`,
        message: `${username} edited the game category to ${actionDetails.new_category || 'New Category'}`,
        action: 'Category Updated'
      },
      'status_change': {
        type: 'game_status',
        title: `${gameName} – Website Status Updated`,
        message: `${username} edited the website status to ${actionDetails.status === '1' ? 'Active' : 'Inactive'}`,
        action: actionDetails.status === '1' ? 'Activated' : 'Deactivated'
      },
      'priority_change': {
        type: 'game_priority',
        title: `${gameName} – Priority Updated`,
        message: `${username} updated the priority`,
        action: 'Priority Updated'
      },
      'delete': {
        type: 'game_deleted',
        title: `${gameName} – Game Deleted`,
        message: `${username} deleted the game`,
        action: 'Deleted'
      }
    };

    const template = notificationTemplates[actionType];
    
    // If no template found for this action type, don't send notification
    if (!template) {
      console.log(`⚠️ No notification template for action type: ${actionType}, skipping...`);
      return;
    }
    
    // Create notification object
    const notificationTemplate = {
      type: template.type,
      title: template.title,
      message: template.message,
      context: {
        game_name: gameName,
        updated_by: username,
        action: template.action,
        action_type: actionType,
        timestamp: currentTime,
        status: 'Completed',
        ...actionDetails
      },
      source_id: gameName,
      environment: 'internal',
      is_read: false
    };

    // Process each user
    for (const userEmail of allUsers) {
      // Skip the user who performed the action
      if (userEmail === username) {
        console.log(`⏭️ Skipping notification for action performer: ${userEmail}`);
        continue;
      }

      console.log(`📨 Preparing ${actionType} notification for: ${userEmail}`);

      try {
        // 1. CHECK FOR RECENT DUPLICATE NOTIFICATION (within 1 minute)
        const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
        
        const { data: duplicateCheck, error: duplicateError } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', userEmail)
          .eq('type', template.type)
          .eq('source_id', gameName)
          .eq('context->>action', template.action)
          .gte('created_at', oneMinuteAgo)
          .limit(1);

        if (!duplicateError && duplicateCheck && duplicateCheck.length > 0) {
          console.log(`⚠️ Duplicate ${actionType} notification prevented for ${userEmail} (recent entry exists)`);
          continue;
        }

        // 2. INSERT NOTIFICATION INTO DATABASE
        const { data: insertedData, error: insertError } = await supabase
          .from('notifications')
          .insert([{
            user_id: userEmail,
            type: notificationTemplate.type,
            title: notificationTemplate.title,
            message: notificationTemplate.message,
            context: notificationTemplate.context,
            source_id: notificationTemplate.source_id,
            environment: notificationTemplate.environment,
            is_read: notificationTemplate.is_read,
            created_at: currentTime
          }])
          .select('id');

        if (insertError) {
          throw new Error(insertError.message);
        }

        console.log(`✅ Database notification inserted for ${userEmail}, ID: ${insertedData[0]?.id}`);

        // 3. SEND WEBSOCKET NOTIFICATION IF AVAILABLE
        if (global.sendNotification) {
          try {
            const wsNotification = {
              type: 'notification',
              data: {
                id: insertedData[0]?.id,
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

            console.log(`📡 Sending WebSocket notification to ${userEmail}`);
            const sent = await global.sendNotification(
              userEmail, 
              wsNotification.data,
              { shouldNotifySelf: false }
            );
            
            if (!sent) {
              console.log(`⚠️ User ${userEmail} is not connected via WebSocket`);
            }
          } catch (wsError) {
            console.error(`❌ WebSocket error for ${userEmail}:`, wsError);
          }
        }

        // Small delay between users
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (userError) {
        console.error(`❌ Error processing notification for ${userEmail}:`, userError);
        continue;
      }
    }

    console.log(`✅ All ${actionType} notifications sent successfully for ${gameName}`);

  } catch (error) {
    console.error(`❌ Error in sendGameNotification (${actionType}):`, error);
    console.log('⚠️ Continuing despite notification error');
  }
}

// GET /api/categoriestype - Fetch all game categories (for testing)
router.get("/categoriestype", async (req, res) => {
  try {
    const supabase = getSupabase();
    
    const { data: rows, error } = await supabase
      .from('gamecategories')
      .select('id, gametype')
      .order('gametype', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    res.json({
      success: true,
      data: rows,
      message: "Categories fetched successfully",
      count: rows.length
    });

  } catch (error) {
    console.error("🔥 /categoriestype ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      data: []
    });
  }
});

// GET /api/categories - Fetch all game categories (for new UI)
router.get("/categories", async (req, res) => {
    console.log("📥 /categories API called");
  try {
    const supabase = getSupabase();
    
    const { data: rows, error } = await supabase
      .from('gamecategories')
      .select('id, gametype')
      .order('gametype', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    res.json({
      success: true,
      data: rows,
      message: "Categories fetched successfully",
      count: rows.length
    });

  } catch (error) {
    console.error("🔥 /categories ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      data: []
    });
  }
});

// GET /api/games - Fetch all games with details
router.get("/games", async (req, res) => {
  try {
    const supabase = getSupabase();

    // First, get all games from gameinfodetails
    const { data: games, error: gamesError } = await supabase
      .from('gameinfodetails')
      .select('*')
      .order('priority', { ascending: false })
      .order('name', { ascending: true });

    if (gamesError) {
      throw new Error(gamesError.message);
    }

    if (!games || games.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: "Games fetched successfully",
        count: 0,
      });
    }

    // Get all game IDs for the second query
    const gameIds = games.map(g => g.id);

    // Get all game data details for these games
    const { data: gameDetails, error: detailsError } = await supabase
      .from('gamedatadetails')
      .select('*')
      .in('game_id', gameIds);

    if (detailsError) {
      throw new Error(detailsError.message);
    }

    // Get all categories
    const { data: categories, error: categoriesError } = await supabase
      .from('gamecategories')
      .select('id, gametype');

    if (categoriesError) {
      throw new Error(categoriesError.message);
    }

    // Create maps for quick lookup
    const detailsMap = {};
    if (gameDetails) {
      gameDetails.forEach(detail => {
        detailsMap[detail.game_id] = detail;
      });
    }

    const categoryMap = {};
    if (categories) {
      categories.forEach(cat => {
        categoryMap[cat.id] = cat.gametype;
      });
    }

    // Transform data to match original response structure
    const transformedRows = games.map(game => {
      const details = detailsMap[game.id] || {};
      
      return {
        id: game.id,
        name: game.name,
        provider: game.provider_key,
        identifier: game.game_identificator,
        game_type: game.game_type,
        category: categoryMap[game.game_type] || null,
        status: game.isgameactive,
        liveStatus: game.isactive,
        priority: game.priority,
        eta: game.eta,
        urlType: game.url_type,
        serverUrl: game.server_url,
        port: game.server_port,
        content: game.texturedetails ? JSON.parse(game.texturedetails)[0]?.FileURL || null : null,
        howToPlay: game.texturedetails ? JSON.parse(game.texturedetails)[1]?.FileURL || null : null,
        title_name: details.title_name || null,
        gd_status: details.status || null,
        landscape: details.landscape || null,
        image: details.image || null,
        mobile_view_image: details.mobile_view_image || null,
        banner_video: details.banner_video || null,
        description: details.description || null,
        rules_content: details.rules_content || null,
        rules: details.rules || null,
        popular: details.popular || null,
        ingame_data: details.ingame_data || null
      };
    });

    res.json({
      success: true,
      data: transformedRows,
      message: "Games fetched successfully",
      count: transformedRows.length,
    });
  } catch (error) {
    console.error("🔥 /games ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      data: [],
    });
  }
});

// GET /api/gamesoverview/:gamename
router.get("/gamesoverview/:gamename", async (req, res) => {
  try {
    const supabase = getSupabase();
    
    const { gamename } = req.params;

    if (!gamename) {
      return res.status(400).json({
        success: false,
        message: "Game name is required",
        data: null
      });
    }

    // Get game details
    const { data: gameData, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('*')
      .eq('name', gamename)
      .limit(1);

    if (gameError || !gameData || gameData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
        data: null
      });
    }

    const game = gameData[0];

    // Get category name
    let categoryName = null;
    if (game.game_type) {
      const { data: categoryData, error: categoryError } = await supabase
        .from('gamecategories')
        .select('gametype')
        .eq('id', game.game_type)
        .limit(1);

      if (!categoryError && categoryData && categoryData.length > 0) {
        categoryName = categoryData[0].gametype;
      }
    }

    // Get UI document
    const { data: uiDoc, error: uiError } = await supabase
      .from('builduser')
      .select('command')
      .eq('gamename', gamename)
      .eq('useraction', 'UIdesign_upload')
      .order('id', { ascending: false })
      .limit(1);

    // Get latest iteration
    const { data: revertData, error: revertError } = await supabase
      .from('revert')
      .select('iteration')
      .eq('game_name', gamename)
      .order('id', { ascending: false })
      .limit(1);

    // Get latest developer
    const { data: buildData, error: buildError } = await supabase
      .from('builduser')
      .select('username')
      .eq('gamename', gamename)
      .eq('useraction', 'Build Uploaded')
      .order('id', { ascending: false })
      .limit(1);

    const result = {
      gamename: game.name,
      category: categoryName,
      phase: game.gamelabel || null,
      current_verson: game.current_verson || null,
      uiDocumentUrl: uiDoc && uiDoc.length > 0 ? uiDoc[0].command : null,
      iteration: revertData && revertData.length > 0 ? revertData[0].iteration : null,
      tester: game.gameassignee ? game.gameassignee.split('@')[0] : null,
      developer: buildData && buildData.length > 0 ? buildData[0].username : null,
      status: game.current_status || null
    };

    res.json({
      success: true,
      data: result,
      message: "Game details fetched successfully"
    });

  } catch (error) {
    console.error("🔥 /games/:gamename ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      data: null
    });
  }
});

// GET /api/games/:id - Get single game with details
router.get("/games/:id", async (req, res) => {
  try {
    const supabase = getSupabase();
    
    const { id } = req.params;

    // Get game details
    const { data: gameData, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('*')
      .eq('id', id)
      .limit(1);

    if (gameError) {
      throw new Error(gameError.message);
    }

    if (!gameData || gameData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const game = gameData[0];

    // Get game data details
    const { data: detailsData, error: detailsError } = await supabase
      .from('gamedatadetails')
      .select('*')
      .eq('game_id', id)
      .limit(1);

    if (detailsError) {
      throw new Error(detailsError.message);
    }

    const details = detailsData && detailsData.length > 0 ? detailsData[0] : {};
    
    // Handle ingame_data - convert to valid JSON string for display
    let gameDataResponse = {
      id: game.id,
      name: game.name,
      provider_key: game.provider_key,
      identifier: game.game_identificator,
      game_type: game.game_type,
      url_type: game.url_type,
      server_url: game.server_url,
      server_port: game.server_port,
      status: game.isgameactive,
      liveStatus: game.isactive,
      priority: game.priority,
      eta: game.eta,
      title_name: details.title_name || null,
      gd_status: details.status || null,
      landscape: details.landscape || null,
      image: details.image || null,
      mobile_view_image: details.mobile_view_image || null,
      banner_video: details.banner_video || null,
      description: details.description || null,
      rules_content: details.rules_content || null,
      rules: details.rules || null,
      popular: details.popular || null,
      ingame_data: details.ingame_data || null
    };
    
    let ingameDataValue = "";
    try {
      if (gameDataResponse.ingame_data) {
        ingameDataValue = convertToValidJSON(gameDataResponse.ingame_data);
        
        try {
          const parsed = JSON.parse(ingameDataValue);
          ingameDataValue = JSON.stringify(parsed, null, 2);
        } catch (e) {
          // Keep as-is if not valid JSON
        }
      } else {
        ingameDataValue = JSON.stringify(DEFAULT_GAME_REQUIRED_DATA, null, 2);
      }
    } catch (error) {
      console.error("Error processing ingame_data:", error);
      ingameDataValue = JSON.stringify(DEFAULT_GAME_REQUIRED_DATA, null, 2);
    }
    
    gameDataResponse.ingame_data = ingameDataValue;

    res.json({
      success: true,
      data: gameDataResponse,
      message: "Game fetched successfully",
    });
  } catch (error) {
    console.error("🔥 /games/:id ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// POST /api/games - Add new game
router.post("/games", async (req, res) => {
  const supabase = getSupabase();
  try {
    const {
      name,
      title_name,
      provider_key,
      identifier,
      game_type,
      url_type,
      server_url,
      server_port,
      status = "0",
      landscape = 0,
      gameImage,
      mobileViewImage,
      gameVideo,
      description,
      rules_content,
      rules,
      popular,
      ingame_data,
      username,
      email
    } = req.body;

    console.log("Received game data:", req.body);

    // Validation
    if (
      !name ||
      !title_name ||
      !identifier 
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled.",
      });
    }

    // Validate category ID exists and get gametype
    const { data: categoryCheck, error: categoryError } = await supabase
      .from('gamecategories')
      .select('id, gametype')
      .eq('id', game_type)
      .limit(1);

    if (categoryError || !categoryCheck || categoryCheck.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid category selected.",
      });
    }

    const categoryName = categoryCheck[0].gametype;

    // Check duplicate game
    const { data: existing, error: existingError } = await supabase
      .from('gameinfodetails')
      .select('id')
      .eq('name', name)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Game name already exists. No need to add again.",
      });
    }

    // Generate game ID
    const gameId = uuidv4();
    const currentTime = getCurrentISTForMySQL();
    const formattedLastUpdate = new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).toUpperCase();

    // Prepare texturedetails for gameinfodetails
    const texturedetails = JSON.stringify([
      { Name: "content", FileURL: description || "" },
      { Name: "how_to_play", FileURL: rules_content || "" },
    ]);

    // Process ingame_data - convert to valid JSON string
    let processedIngameData = convertToValidJSON(ingame_data);

    // Fixed assignee
    const gameAssignee = "kavin.s@theunitytech.com";
    const currentVersion = "1.0";

    // Insert into gameinfodetails
    const { error: insertGameError } = await supabase
      .from('gameinfodetails')
      .insert([{
        id: gameId,
        name: name,
        provider_key: provider_key || "",
        game_identificator: identifier,
        game_type: game_type,
        gamecategory: categoryName,
        texturedetails: texturedetails,
        current_status: 'Pending on Dev Team',
        isactive: 1,
        url_type: url_type || "Null",
        server_url: server_url || "Null",
        server_port: server_port || "Null",
        current_verson: currentVersion,
        gameassignee: gameAssignee,
        client_update_at: currentTime
      }]);

    if (insertGameError) {
      throw new Error(insertGameError.message);
    }

    // Insert into gamedatadetails with ingame_data
    const { error: insertGameDataError } = await supabase
      .from('gamedatadetails')
      .insert([{
        game_id: gameId,
        title_name: title_name,
        status: status,
        landscape: landscape,
        image: gameImage || "",
        mobile_view_image: mobileViewImage || "",
        banner_video: gameVideo || "",
        description: description || "",
        rules_content: rules_content || "",
        rules: rules || "",
        ingame_data: processedIngameData
      }]);

    if (insertGameDataError) {
      throw new Error(insertGameDataError.message);
    }

    // LOG TO BUILDUSER TABLE
    const commandText = `Game Added - Name: ${name}, Identifier: ${identifier}, Category: ${categoryName} (ID: ${game_type})`;
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: name,
        username: username,
        email: email,
        command: commandText,
        useraction: 'New Game Added',
        lastupdate: currentTime
      }]);

    if (logError) {
      throw new Error(logError.message);
    }

    // SEND DATABASE NOTIFICATIONS - New Game Created
    try {
      console.log(`🎮 Sending notifications for game addition: ${name}`);
      await sendGameNotification(name, username, 'add', {
        identifier,
        category: categoryName
      });
    } catch (notificationError) {
      console.error(`❌ Failed to send notifications:`, notificationError);
    }
    const smtp = getSMTPConfigs()
    // SEND EMAIL NOTIFICATION
    const transporter = nodemailer.createTransport({
      host: smtp.SMTP_HOST || "smtp.gmail.com",
      port: smtp.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: smtp.SMTP_USER,
        pass: smtp.SMTP_PASS,
      },
    });

    const mailSubject = `${name} - New Game details have been Added`;
    const urlTypeName = url_type == 0 ? "Direct" : (url_type == 1 ? "API" : "Null");

    const emailBody = `
<body style="margin: 0; padding: 0; background-color: #f2f4f6; font-family: Arial, sans-serif; color: #000;">
  <div style="max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); overflow: hidden;">

    <table width="100%" style="background: linear-gradient(90deg, #d4dbdf, #00c6ff); padding: 0px 20px;">
      <tr>
        <td align="left">
          <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px;background: transparent; display:block;">
        </td>
        <td align="right">
          <img src="${smtp.BASE_URL}/assets/images/emailmessage.png" alt="Message" style="height: 38px;">
        </td>
      </tr>
    </table>

    <div style="padding: 25px; text-align: left;">
      <p style="font-size: 14px; margin: 0 0 15px;">
        <strong style="color: #a61321; text-decoration: underline;">Environment: Internal Testing</strong>
      </p>

      <div style="background: #f9fbff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin-bottom: 20px;">
        <p style="margin: 6px 0; font-size: 14px;"><strong>Game Name:</strong> ${name}</p>
        <p style="margin: 6px 0; font-size: 14px;"><strong>Title Name:</strong> ${title_name}</p>
        <p style="margin: 6px 0; font-size: 14px;"><strong>Server URL:</strong> ${server_url || 'Null'}</p>
        <p style="margin: 6px 0; font-size: 14px;"><strong>URL Type:</strong> ${urlTypeName}</p>
        <p style="margin: 6px 0; font-size: 14px;"><strong>Port:</strong> ${server_port || 'Null'}</p>
        <p style="margin: 6px 0; font-size: 14px;"><strong>Category:</strong> ${categoryName}</p>
        <p style="margin: 6px 0; font-size: 14px;"><strong>Date and Time:</strong> ${formattedLastUpdate}</p>
        <p style="margin: 6px 0; font-size: 14px;"><strong>Added By:</strong> ${username}</p>
      </div>
      
      <div style="background: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 6px; padding: 15px; margin-top: 20px;">
        <p style="margin: 6px 0; font-size: 14px; color: #2e7d32;">
          <strong>🔔 Database notification sent to all team members!</strong>
        </p>
      </div>
    </div>

    <div style="background: #f9f9f9; text-align: center; padding: 15px;">
      <img src="https://lootrixdevgaames.s3.ap-south-1.amazonaws.com/mailicon/icon3.png" alt="Logo" style="height: 70px; background: transparent;">
      <p style="margin: 0; font-size: 11px; color: #777;">
        ©2026 <span style="color: #139FFF;">Unity one</span>. All Rights Reserved.
      </p>
    </div>

  </div>
</body>`;

    await transporter.sendMail({
      from: smtp.SMTP_FROM,
      to: [
        "kavin.s@theunitytech.com",
        "meera.r@theunitytech.com",
        "anjalipriya@theunitytech.com",
        "saravanant@theunitytech.com",
        "dhineshvinayak@theunitytech.com",
        "rathnavel@theunitytech.com",
      ],
      subject: mailSubject,
      html: emailBody,
      replyTo: email,
    });

    // Get the inserted record with category name
    const { data: insertedGame, error: fetchError } = await supabase
      .from('gameinfodetails')
      .select('*')
      .eq('id', gameId)
      .limit(1);

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    const { data: insertedDetails, error: detailsFetchError } = await supabase
      .from('gamedatadetails')
      .select('*')
      .eq('game_id', gameId)
      .limit(1);

    if (detailsFetchError) {
      throw new Error(detailsFetchError.message);
    }

    const game = insertedGame[0];
    const details = insertedDetails && insertedDetails.length > 0 ? insertedDetails[0] : {};

    const resultData = {
      ...game,
      category_name: categoryName,
      title_name: details.title_name || null,
      gd_status: details.status || null,
      landscape: details.landscape || null,
      image: details.image || null,
      mobile_view_image: details.mobile_view_image || null,
      banner_video: details.banner_video || null,
      description: details.description || null,
      rules_content: details.rules_content || null,
      rules: details.rules || null,
      popular: details.popular || null,
      ingame_data: details.ingame_data || null
    };

    res.status(201).json({
      success: true,
      data: resultData,
      message: "Game added successfully with notifications",
    });

  } catch (error) {
    console.error("Error adding game:", error);
    res.status(500).json({
      success: false,
      message: "Error adding game",
      error: error.message,
    });
  }
});

// PUT /api/games/:id - Update existing game
router.put("/games/:id", async (req, res) => {
  const supabase = getSupabase();
  try {
    const gameId = req.params.id;
    const {
      name,
      title_name,
      provider_key,
      identifier,
      game_type,
      status = "0",
      landscape = 0,
      gameImage,
      mobileViewImage,
      gameVideo,
      description,
      rules_content,
      rules,
      ingame_data,
      username,
      email
    } = req.body;

    console.log("Updating game ID:", gameId);
    console.log("📥 Full request body:", JSON.stringify(req.body, null, 2));

    // Get current game details for comparison
    const { data: existingGame, error: existingError } = await supabase
      .from('gameinfodetails')
      .select('*')
      .eq('id', gameId)
      .limit(1);

    if (existingError || !existingGame || existingGame.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const existing = existingGame[0];

    // Get current game data details
    const { data: existingDetails, error: detailsError } = await supabase
      .from('gamedatadetails')
      .select('*')
      .eq('game_id', gameId)
      .limit(1);

    if (detailsError) {
      throw new Error(detailsError.message);
    }

    const existingDetail = existingDetails && existingDetails.length > 0 ? existingDetails[0] : {};

    const currentTime = getCurrentISTForMySQL();
    let categoryName = existing.gamecategory;

    // Validate category ID if provided and get gametype
    let oldCategory = existing.gamecategory;
    if (game_type) {
      const { data: categoryCheck, error: categoryError } = await supabase
        .from('gamecategories')
        .select('id, gametype')
        .eq('id', game_type)
        .limit(1);

      if (categoryError || !categoryCheck || categoryCheck.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid category selected.",
        });
      }
      
      categoryName = categoryCheck[0].gametype;
    }

    // Process ingame_data - convert to valid JSON string
    let processedIngameData = convertToValidJSON(ingame_data);

    // Prepare texturedetails
    const texturedetails = JSON.stringify([
      { Name: "content", FileURL: description || "" },
      { Name: "how_to_play", FileURL: rules_content || "" },
    ]);

    // ============================================
    // UNIVERSAL FUNCTION TO CONVERT TO SMALLINT
    // ============================================
    const convertToSmallInt = (value, defaultValue = 0) => {
      // If value is null, undefined, or empty string, return default
      if (value === null || value === undefined || value === "") {
        return defaultValue;
      }

      // If it's a boolean
      if (typeof value === 'boolean') {
        return value ? 1 : 0;
      }

      // If it's a number already
      if (typeof value === 'number') {
        // Check if it's a valid integer
        if (Number.isInteger(value)) {
          return value;
        }
        return Math.round(value); // Round if it's a float
      }

      // If it's a string
      if (typeof value === 'string') {
        // Handle boolean strings
        if (value.toLowerCase() === 'true' || value === '1') {
          return 1;
        }
        if (value.toLowerCase() === 'false' || value === '0') {
          return 0;
        }
        
        // Try to parse as integer
        const parsed = parseInt(value);
        if (!isNaN(parsed)) {
          return parsed;
        }
        
        // If it's an empty string or "null" string
        if (value === '' || value.toLowerCase() === 'null') {
          return defaultValue;
        }
      }

      // If all else fails, return default
      return defaultValue;
    };

    // ============================================
    // CONVERT ALL SMALLINT FIELDS
    // ============================================
    // Convert status (smallint)
    const statusValue = convertToSmallInt(status, 0);
    
    // Convert landscape (smallint)
    const landscapeValue = convertToSmallInt(landscape, 0);

    console.log("Converted values - status:", statusValue, "landscape:", landscapeValue);

    // Update gameinfodetails
    const updateGameData = {
      name: name,
      provider_key: provider_key,
      game_identificator: identifier,
      game_type: game_type,
      gamecategory: categoryName,
      texturedetails: texturedetails,
      client_update_at: currentTime
    };

    // Remove undefined values
    Object.keys(updateGameData).forEach(key => {
      if (updateGameData[key] === undefined) {
        delete updateGameData[key];
      }
    });

    const { error: updateGameError } = await supabase
      .from('gameinfodetails')
      .update(updateGameData)
      .eq('id', gameId);

    if (updateGameError) {
      throw new Error(updateGameError.message);
    }

    // Prepare data for gamedatadetails - REMOVED updatedAt
    const gameData = {
      title_name: title_name || "",
      status: statusValue,
      landscape: landscapeValue,
      image: gameImage || "",
      mobile_view_image: mobileViewImage || "",
      banner_video: gameVideo || "",
      description: description || "",
      rules_content: rules_content || "",
      rules: rules || "",
      ingame_data: processedIngameData
    };

    // Remove undefined values
    Object.keys(gameData).forEach(key => {
      if (gameData[key] === undefined) {
        delete gameData[key];
      }
    });

    console.log("Final data to save:", gameData);

    // Check if record exists in gamedatadetails
    if (existingDetails && existingDetails.length > 0) {
      const { error: updateGameDataError } = await supabase
        .from('gamedatadetails')
        .update(gameData)
        .eq('game_id', gameId);

      if (updateGameDataError) {
        console.error("Update error:", updateGameDataError);
        throw new Error(updateGameDataError.message);
      }
    } else {
      // For insert, always include game_id
      const insertData = {
        game_id: gameId,
        ...gameData
      };

      console.log("Inserting with data:", insertData);

      const { error: insertGameDataError } = await supabase
        .from('gamedatadetails')
        .insert([insertData]);

      if (insertGameDataError) {
        console.error("Insert error:", insertGameDataError);
        throw new Error(insertGameDataError.message);
      }
    }

    // LOG TO BUILDUSER TABLE
    const commandText = `Game Updated - Name: ${name}, Category: ${categoryName} (ID: ${game_type})`;
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: name,
        username: username,
        email: email,
        command: commandText,
        useraction: 'Game Updated',
        lastupdate: currentTime
      }]);

    if (logError) {
      throw new Error(logError.message);
    }

    // SEND DATABASE NOTIFICATIONS - Only for specific fields
    try {
      console.log(`🎮 Checking what was updated for game: ${name}`);
      
      let notificationSent = false;

      // Check if category was updated
      if (game_type && existing.game_type !== game_type) {
        console.log(`📝 Category changed from ${oldCategory} to ${categoryName}`);
        await sendGameNotification(name, username, 'category_change', {
          old_category: oldCategory,
          new_category: categoryName
        });
        notificationSent = true;
      }

      // Check if website status was updated
      if (status !== undefined && existingDetail.status !== status) {
        console.log(`📝 Website status changed from ${existingDetail.status} to ${status}`);
        await sendGameNotification(name, username, 'status_change', {
          status: status
        });
        notificationSent = true;
      }

      // Check if it's a general game data update
      if (!notificationSent) {
        const fieldsChanged = [];
        
        if (existing.name !== name) fieldsChanged.push('name');
        if (existing.provider_key !== provider_key) fieldsChanged.push('provider_key');
        if (existing.game_identificator !== identifier) fieldsChanged.push('identifier');
        if (existingDetail.description !== description) fieldsChanged.push('description');
        if (existingDetail.rules_content !== rules_content) fieldsChanged.push('rules_content');
        if (existingDetail.rules !== rules) fieldsChanged.push('rules');
        if (existingDetail.ingame_data !== ingame_data) fieldsChanged.push('ingame_data');
        if (existingDetail.landscape !== landscape) fieldsChanged.push('landscape');
        if (existingDetail.image !== gameImage) fieldsChanged.push('image');
        if (existingDetail.mobile_view_image !== mobileViewImage) fieldsChanged.push('mobile_view_image');
        if (existingDetail.banner_video !== gameVideo) fieldsChanged.push('banner_video');
        
        if (fieldsChanged.length > 0) {
          console.log(`📝 General game data updated - fields changed: ${fieldsChanged.join(', ')}`);
          await sendGameNotification(name, username, 'game_data_updated', {
            fields_updated: fieldsChanged
          });
        } else {
          console.log(`📝 No significant changes detected, skipping notification`);
        }
      }

    } catch (notificationError) {
      console.error(`❌ Failed to send notifications:`, notificationError);
    }

    res.json({
      success: true,
      message: "Game updated successfully",
      data: { 
        id: gameId, 
        name,
        game_type: game_type,
        gamecategory: categoryName
      }
    });

  } catch (error) {
    console.error("Error updating game:", error);
    res.status(500).json({
      success: false,
      message: "Error updating game",
      error: error.message,
    });
  }
});
// PATCH /api/games/:id/popular - Update popular rank
router.patch("/games/:id/popular", async (req, res) => {
  const supabase = getSupabase();
  try {
    const gameId = req.params.id;
    const { popular, username, email } = req.body;
    const currentTime = getCurrentISTForMySQL();

    console.log(`Updating popular rank for game ${gameId}:`, popular);

    // Check if game exists
    const { data: existingGame, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('name')
      .eq('id', gameId)
      .limit(1);

    if (gameError || !existingGame || existingGame.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const gameName = existingGame[0].name;

    // Validate popular rank (1-7 or null)
    if (popular !== undefined && popular !== null && popular !== "") {
      const popularRank = parseInt(popular);
      if (isNaN(popularRank) || popularRank < 1 || popularRank > 7) {
        return res.status(400).json({
          success: false,
          message: "Popular rank must be between 1 and 7.",
        });
      }

      // Check if this rank is already taken by another game
      const { data: existingRank, error: rankError } = await supabase
        .from('gamedatadetails')
        .select('game_id')
        .eq('popular', popularRank)
        .neq('game_id', gameId)
        .limit(1);

      if (existingRank && existingRank.length > 0) {
        // Remove the rank from the existing game
        await supabase
          .from('gamedatadetails')
          .update({ popular: null })
          .eq('game_id', existingRank[0].game_id);
      }
    }

    // Update popular rank in gamedatadetails
    const { data: existingGameData, error: existingGameDataError } = await supabase
      .from('gamedatadetails')
      .select('game_id')
      .eq('game_id', gameId)
      .limit(1);

    if (existingGameData && existingGameData.length > 0) {
      const { error: updateError } = await supabase
        .from('gamedatadetails')
        .update({ popular: popular || null })
        .eq('game_id', gameId);

      if (updateError) {
        throw new Error(updateError.message);
      }
    } else {
      const { error: insertError } = await supabase
        .from('gamedatadetails')
        .insert([{
          game_id: gameId,
          popular: popular || null
        }]);

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    // LOG TO BUILDUSER TABLE
    const action = popular ? `Popular Rank Set to ${popular}` : "Popular Rank Removed";
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: gameName,
        username: username,
        email: email,
        command: action,
        useraction: 'Popular Rank Update',
        lastupdate: currentTime
      }]);

    if (logError) {
      throw new Error(logError.message);
    }

    res.json({
      success: true,
      message: popular 
        ? `Game ranked as #${popular} in Popular Games` 
        : "Popular rank removed",
      data: { id: gameId, popular: popular || null }
    });

  } catch (error) {
    console.error("Error updating popular rank:", error);
    res.status(500).json({
      success: false,
      message: "Error updating popular rank",
      error: error.message,
    });
  }
});

// PATCH /api/games/:id/priority - Update game priority
router.patch("/games/:id/priority", async (req, res) => {
  const supabase = getSupabase();
  try {
    const { id } = req.params;
    const { priority, eta, username, email } = req.body;
    const currentTime = getCurrentISTForMySQL();

    // Get game details first
    const { data: gameData, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('name')
      .eq('id', id)
      .limit(1);

    if (gameError || !gameData || gameData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const gameName = gameData[0].name;

    // Update priority and ETA in gameinfodetails
    const { data: result, error: updateError } = await supabase
      .from('gameinfodetails')
      .update({
        priority: priority,
        eta: eta,
        client_update_at: currentTime
      })
      .eq('id', id)
      .select('id');

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const action = priority ? "Priority Set" : "Priority Removed";

    // LOG TO BUILDUSER TABLE
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: gameName,
        username: username,
        email: email,
        command: action,
        useraction: 'Game Priority',
        lastupdate: currentTime
      }]);

    if (logError) {
      throw new Error(logError.message);
    }

    // SEND DATABASE NOTIFICATIONS - Priority Updated
    try {
      console.log(`🎮 Sending notifications for priority change: ${gameName}`);
      await sendGameNotification(gameName, username, 'priority_change', {
        priority: priority || null,
        eta: eta || null
      });
    } catch (notificationError) {
      console.error(`❌ Failed to send notifications:`, notificationError);
    }

    res.json({
      success: true,
      message: "Priority updated with notifications",
    });
  } catch (error) {
    console.error("Error updating priority:", error);
    res.status(500).json({
      success: false,
      message: "Error updating priority",
      error: error.message,
    });
  }
});

// POST /api/upload - Upload file to S3
router.post("/upload", upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const { folder } = req.body;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded"
      });
    }

    if (!folder) {
      return res.status(400).json({
        success: false,
        message: "Folder name is required"
      });
    }

    const validFolders = ['gameimage', 'mobileimage', 'gamevideo', 'rules'];
    if (!validFolders.includes(folder)) {
      return res.status(400).json({
        success: false,
        message: "Invalid folder name"
      });
    }

    // Upload to S3
    const fileUrl = await uploadFileToS3(file, folder);

    res.json({
      success: true,
      data: {
        url: fileUrl,
        filename: file.originalname,
        folder: folder
      },
      message: "File uploaded successfully"
    });

  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({
      success: false,
      message: "Error uploading file",
      error: error.message
    });
  }
});

// DELETE /api/games/:id - Delete game
router.delete("/games/:id", async (req, res) => {
  const supabase = getSupabase();
  try {
    const { id } = req.params;
    const { reason, username, email } = req.body;
    const currentTime = getCurrentISTForMySQL();

    // Check if game exists
    const { data: gameResult, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('name')
      .eq('id', id)
      .limit(1);

    if (gameError || !gameResult || gameResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const gameName = gameResult[0].name;

    // Delete from gamedatadetails first (foreign key constraint)
    const { error: deleteGameDataError } = await supabase
      .from('gamedatadetails')
      .delete()
      .eq('game_id', id);

    if (deleteGameDataError) {
      throw new Error(deleteGameDataError.message);
    }

    // Delete from gameinfodetails
    const { error: deleteGameError } = await supabase
      .from('gameinfodetails')
      .delete()
      .eq('id', id);

    if (deleteGameError) {
      throw new Error(deleteGameError.message);
    }

    // LOG TO BUILDUSER TABLE
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: gameName,
        username: username,
        email: email,
        command: reason,
        useraction: 'Game Deleted',
        lastupdate: currentTime
      }]);

    if (logError) {
      throw new Error(logError.message);
    }

    // SEND DATABASE NOTIFICATIONS - Game Deleted
    try {
      console.log(`🎮 Sending notifications for game deletion: ${gameName}`);
      await sendGameNotification(gameName, username, 'delete', {
        reason: reason || 'No reason provided'
      });
    } catch (notificationError) {
      console.error(`❌ Failed to send notifications:`, notificationError);
    }

    res.json({
      success: true,
      message: "Game deleted successfully with notifications",
    });
  } catch (error) {
    console.error("Error deleting game:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting game",
      error: error.message,
    });
  }
});

// PATCH /api/games/:id/status - Update game status
router.patch("/games/:id/status", async (req, res) => {
  const supabase = getSupabase();
  try {
    const { id } = req.params;
    const { status, username, email } = req.body;
    const currentTime = getCurrentISTForMySQL();

    // Get game name first
    const { data: gameData, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('name')
      .eq('id', id)
      .limit(1);

    if (gameError || !gameData || gameData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const gameName = gameData[0].name;
    
    // Convert status to smallint (1 for true, 0 for false)
    const statusValue = status === true || status === 'true' || status === 1 ? 1 : 0;
    
    // Update status in gameinfodetails
    const { data: result, error: updateError } = await supabase
      .from('gameinfodetails')
      .update({
        isgameactive: statusValue,
        client_update_at: currentTime
      })
      .eq('id', id)
      .select('id');

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const command = statusValue === 1 ? "Game Activated" : "Game Deactivated";

    // LOG TO BUILDUSER TABLE
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: gameName,
        username: username,
        email: email,
        command: command,
        useraction: "isgameactive",
        lastupdate: currentTime
      }]);

    if (logError) {
      throw new Error(logError.message);
    }

    // SEND DATABASE NOTIFICATIONS - Website Status Updated
    try {
      console.log(`🎮 Sending notifications for game status: ${gameName}`);
      await sendGameNotification(gameName, username, 'status_change', {
        status: statusValue.toString(),
        action: statusValue === 1 ? 'activated' : 'deactivated'
      });
    } catch (notificationError) {
      console.error(`❌ Failed to send notifications:`, notificationError);
    }

    res.json({
      success: true,
      message: "Status updated with notifications",
    });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating status",
      error: error.message,
    });
  }
});

// PATCH /api/games/:id/live-status - Update live status
router.patch("/games/:id/live-status", async (req, res) => {
  const supabase = getSupabase();
  try {
    const { id } = req.params;
    const { status, username, email } = req.body;

    const currentTime = getCurrentISTForMySQL();

    // Get game name first
    const { data: gameData, error: gameError } = await supabase
      .from('gameinfodetails')
      .select('name')
      .eq('id', id)
      .limit(1);

    if (gameError || !gameData || gameData.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const gameName = gameData[0].name;

    const { data: result, error: updateError } = await supabase
      .from('gameinfodetails')
      .update({
        isactive: status,
        client_update_at: currentTime
      })
      .eq('id', id)
      .select('id');

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!result || result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    const action = status === 1 ? "Game in live mode" : "Game in maintenance mode";

    // LOG TO BUILDUSER TABLE
    const { error: logError } = await supabase
      .from('builduser')
      .insert([{
        gamename: gameName,
        username: username,
        email: email,
        command: action,
        useraction: "isactive",
        lastupdate: currentTime
      }]);

    if (logError) {
      throw new Error(logError.message);
    }

    res.json({
      success: true,
      message: "Live status updated successfully",
    });
  } catch (error) {
    console.error("Error updating live status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating live status",
      error: error.message,
    });
  }
});

module.exports = router;