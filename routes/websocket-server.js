const jwt = require("jsonwebtoken");
const { getDB } = require("../config/db");

const clients = new Map(); // userEmail -> WebSocket
const userConnections = new Map();

const setupWebSocketServer = (ws, req) => {
  console.log("🔗 New WebSocket connection attempt");

  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email");

  if (!token || !email) {
    ws.close(1008, "Authentication required");
    return;
  }

  try {
    const decoded = jwt.decode(token);
    const userEmail = email.toLowerCase().trim();

    const connectionId = `${userEmail}_${Date.now()}`;


    if (!clients.has(userEmail)) {
      clients.set(userEmail, new Set());
    }

    clients.get(userEmail).add(ws);

    userConnections.set(connectionId, {
      userEmail,
      ws,
      connectedAt: Date.now(),
    });

    ws.userEmail = userEmail;
    ws.connectionId = connectionId;

    console.log(`✅ WebSocket connected: ${userEmail}`);

    ws.send(
      JSON.stringify({
        type: "connected",
        user: userEmail,
        connectionId,
        timestamp: new Date().toISOString(),
      })
    );

    ws.on("pong", () => {
      const conn = userConnections.get(connectionId);
      if (conn) conn.lastPing = Date.now();
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        console.log("📩 WS message:", message);

        await handleMessage(userEmail, message, ws);
      } catch (err) {
        console.error("❌ Message parse error:", err);
      }
    });

    ws.on("close", () => {
      console.log(`🔴 WebSocket disconnected: ${userEmail}`);

      const userSet = clients.get(userEmail);
      if (userSet) {
        userSet.delete(ws);

        if (userSet.size === 0) {
          clients.delete(userEmail);
        }
      }

      userConnections.delete(connectionId);
    });

    ws.on("error", (err) => {
      console.error(`❌ WebSocket error for ${userEmail}`, err);
    });
  } catch (err) {
    console.error("❌ WS setup error:", err);
    ws.close(1008, "Setup failed");
  }
};

/* ------------------------------------------------ */
/* SEND TO USER */
/* ------------------------------------------------ */

const sendToUser = (userEmail, message) => {
  const sockets = clients.get(userEmail);

  if (!sockets || sockets.size === 0) {
    console.log(`⚠️ No active sockets for ${userEmail}`);
    return false;
  }

  let delivered = 0;

  sockets.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message));
      delivered++;
    }
  });

  console.log(`📡 Sent message to ${delivered} sockets of ${userEmail}`);
  return delivered > 0;
};

/* ------------------------------------------------ */
/* PUSH + SOCKET NOTIFICATION */
/* ------------------------------------------------ */

const sendNotification = async (userEmail, notification, options = {}) => {
  console.log(`🔔 Attempting to send notification to: ${userEmail}`);

  try {

    const shouldNotifySelf = options.shouldNotifySelf || false;

    // 1️⃣ Skip self notification
    if (notification.source_id === userEmail && !shouldNotifySelf) {
      console.log(`⏭️ Skipping self-notification for: ${userEmail}`);
      return false;
    }

    const db = getDB();

    // 2️⃣ Get user settings
    const [settings] = await db.query(
      "SELECT * FROM notification_settings WHERE user_id = ?",
      [userEmail]
    );

    let userSettings = settings[0];

    // 3️⃣ Create default settings if missing
    if (!userSettings) {

      console.log(`📭 No settings found for ${userEmail}, creating defaults`);

      await db.query(
        `INSERT INTO notification_settings
        (user_id, sound_enabled, in_app_notifications, push_notifications)
        VALUES (?, ?, ?, ?)`,
        [userEmail, true, true, false]
      );

      userSettings = {
        sound_enabled: true,
        in_app_notifications: true,
        push_notifications: false
      };
    }

    console.log(`⚙️ User settings`, {
      sound: userSettings.sound_enabled,
      in_app: userSettings.in_app_notifications,
      push: userSettings.push_notifications
    });

    if (userSettings.in_app_notifications) {
      const delivered = sendToUser(userEmail, {
        type: "notification",
        data: {
          ...notification,
          id: notification.id || Date.now(),
          settings: {
            sound_enabled: userSettings.sound_enabled,
            in_app_notifications: userSettings.in_app_notifications
          }
        }
      });

      if (delivered) {
        console.log(`📨 Notification delivered via WebSocket`);
        return true;
      }
    }

    // 5️⃣ Push notification fallback
    if (userSettings.push_notifications) {

      console.log(`📤 Sending push notification to ${userEmail}`);

      await sendPushNotification(userEmail, notification);

    } else {

      console.log(`📵 Push notifications disabled for ${userEmail}`);

    }

    return false;

  } catch (error) {

    console.error(`❌ Error in sendNotification`, error);
    return false;

  }
};


global.sendNotification = sendNotification;

/* ------------------------------------------------ */
/* HANDLE CLIENT MESSAGE */
/* ------------------------------------------------ */

const handleMessage = async (userEmail, message) => {
  console.log(`📥 Message from ${userEmail}:`, message.type);

  switch (message.type) {
    case 'mark_as_read':
      await markNotificationAsRead(userEmail, message.notificationId);
      break;
    case 'mark_all_as_read':
      await markAllNotificationsAsRead(userEmail);
      break;
    case 'notification_settings':
      await updateNotificationSettings(userEmail, message.settings);
      break;
    case 'ping':
      sendToUser(userEmail, {
        type: 'pong',
        timestamp: Date.now(),
        serverTime: new Date().toISOString()
      });
      break;
    default:
      console.log(`Unknown message type from ${userEmail}:`, message.type);
  }
};

async function sendPushNotification(email, notification) {
  try {
    if (!email || !notification) {
      console.log('Missing email or notification');
      return;
    }

    const db = getDB();

    // 1. Check if user has push notifications enabled
    const [settings] = await db.query(
      'SELECT push_notifications FROM notification_settings WHERE user_id = ?',
      [email]
    );

    if (settings.length === 0 || !settings[0].push_notifications) {
      console.log(`📭 Push notifications disabled for: ${email}`);
      return;
    }

    // 2. Check if user has push subscription
    const [subscriptionRows] = await db.query(
      'SELECT subscription_data FROM push_subscriptions WHERE email = ?',
      [email]
    );

    if (subscriptionRows.length === 0) {
      console.log(`📭 No push subscription found for: ${email}`);
      return;
    }

    // 3. Parse subscription data
    const subscriptionData = subscriptionRows[0].subscription_data;
    let subscription;

    try {
      subscription = typeof subscriptionData === 'string'
        ? JSON.parse(subscriptionData)
        : subscriptionData;
    } catch (parseError) {
      console.error(`❌ Error parsing subscription for ${email}:`, parseError);
      return;
    }

    // Check if subscription has required fields
    if (!subscription || !subscription.endpoint) {
      console.error(`❌ Invalid subscription for ${email}`);
      return;
    }

    console.log(`📤 Preparing push notification for: ${email}`);
    console.log('Subscription endpoint:', subscription.endpoint);

    // 4. Import webpush
    const webpush = require('web-push');

    // 5. Create payload with TTL (Time To Live) - IMPORTANT!
    const env = (notification.environment || 'internal').toUpperCase();
    const payload = JSON.stringify({
      title: `[${env}] ${notification.title || "New Notification"}`,
      body: notification.message || "You have a new notification",
      icon: '/logo192.png',
      badge: '/logo192.png',
      data: {
        url: notification.context?.document_url || '/',
        notificationId: notification.id || Date.now(),
        type: notification.type || 'general',
        environment: env,
        timestamp: Date.now()
      }
    });

    // 6. Send notification with TTL (0 = immediate, 2419200 = 4 weeks)
    const options = {
      TTL: 0, // Send immediately (0 seconds delay)
      urgency: 'high' // High priority for immediate delivery
    };

    console.log(`🚀 Sending push to ${email}...`);
    const result = await webpush.sendNotification(subscription, payload, options);
    console.log(`✅ Push notification sent successfully to: ${email}`);
    console.log('Response status:', result.statusCode);

  } catch (error) {
    console.error('❌ Push notification error:', error.message);

    // Remove invalid subscription
    if (error.statusCode === 410 || error.statusCode === 404 || error.statusCode === 400) {
      try {
        const db = getDB();
        await db.query("DELETE FROM push_subscriptions WHERE email = ?", [email]);
        console.log(`🗑️ Removed invalid subscription for: ${email} (status: ${error.statusCode})`);
      } catch (dbError) {
        console.error('Failed to remove subscription:', dbError);
      }
    }
  }
}

const markNotificationAsRead = async (userEmail, notificationId) => {
  const db = getDB();
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE, read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [notificationId, userEmail]
    );

    // Acknowledge to client
    sendToUser(userEmail, {
      type: 'notification_read',
      notificationId: notificationId
    });

  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
  }
};

const markAllNotificationsAsRead = async (userEmail) => {
  const db = getDB();
  try {
    await db.query(
      'UPDATE notifications SET is_read = TRUE, read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_read = FALSE',
      [userEmail]
    );

    // Acknowledge to client
    sendToUser(userEmail, {
      type: 'all_notifications_read'
    });

  } catch (error) {
    console.error('❌ Error marking all notifications as read:', error);
  }
};

const updateNotificationSettings = async (userEmail, settings) => {
  const db = getDB();
  try {
    await db.query(
      `INSERT INTO notification_settings 
             (user_id, email_notifications, push_notifications, in_app_notifications, 
              sound_enabled, critical_priority_sound, normal_priority_sound, low_priority_sound) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
             email_notifications = VALUES(email_notifications),
             push_notifications = VALUES(push_notifications),
             in_app_notifications = VALUES(in_app_notifications),
             sound_enabled = VALUES(sound_enabled),
             critical_priority_sound = VALUES(critical_priority_sound),
             normal_priority_sound = VALUES(normal_priority_sound),
             low_priority_sound = VALUES(low_priority_sound)`,
      [
        userEmail,
        settings.email_notifications || true,
        settings.push_notifications || true,
        settings.in_app_notifications || true,
        settings.sound_enabled || true,
        settings.critical_priority_sound || true,
        settings.normal_priority_sound || true,
        settings.low_priority_sound || false
      ]
    );

    sendToUser(userEmail, {
      type: 'settings_updated',
      message: 'Notification settings updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating notification settings:', error);
  }
};

/* ------------------------------------------------ */
/* STATS */
/* ------------------------------------------------ */

const getWebSocketStats = () => ({
  totalClients: clients.size,
  users: Array.from(clients.keys()),
});

module.exports = {
  setupWebSocketServer,
  sendNotification,
  getWebSocketStats,
};