import express from 'express';
import { getDB } from '../config/db.js';

const router = express.Router();

// Middleware to get user from JWT
const getUserFromToken = (req) => {
    try {
        const authHeader = req.headers?.authorization;
        if (!authHeader) return null;

        const token = authHeader.split(" ")[1];
        if (!token) return null;

        const base64Url = token.split(".")[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const decodedPayload = JSON.parse(
            Buffer.from(base64, "base64").toString("utf8")
        );

        // ✅ STRICT: EMAIL ONLY
        if (!decodedPayload.email) {
            console.error("❌ Email missing in JWT");
            return null;
        }

        return decodedPayload.email; // ✅ ALWAYS EMAIL
    } catch (err) {
        console.error("JWT decode failed:", err);
        return null;
    }
};

// Alternative: Get user from query parameter as fallback
const getUserFromRequest = (req) => {
    return getUserFromToken(req);
};

// Add this middleware to parse JSON body
router.use(express.json());

// GET /api/notifications - Get user notifications
router.get('/notifications', async (req, res) => {
    try {
        const userId = getUserFromRequest(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User authentication required'
            });
        }

        const db = getDB();

        // ✅ Params
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const days = parseInt(req.query.days) || 21;

        const type = req.query.type || 'all';
        const search = req.query.search || '';

        // =============================
        // ✅ TYPE FILTER
        // =============================
        let typeCondition = '';
        if (type === 'read') {
            typeCondition = 'AND is_read = 1';
        } else if (type === 'unread') {
            typeCondition = 'AND is_read = 0';
        }

        // =============================
        // ✅ SEARCH FILTER
        // =============================
        let searchCondition = '';
        let searchValues = [];

        if (search.trim()) {
            searchCondition = `AND (title LIKE ? OR message LIKE ?)`;
            const searchTerm = `%${search.trim()}%`;
            searchValues = [searchTerm, searchTerm];
        }

        // =============================
        // ✅ MAIN QUERY
        // =============================
        const [notifications] = await db.query(
            `SELECT * FROM notifications
             WHERE user_id = ?
             AND is_archived = FALSE
             AND created_at >= NOW() - INTERVAL ? DAY
             ${typeCondition}
             ${searchCondition}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, days, ...searchValues, limit, offset]
        );

        // =============================
        // ✅ TOTAL COUNT (ALL)
        // =============================
        const [totalResult] = await db.query(
            `SELECT COUNT(*) as total FROM notifications
             WHERE user_id = ?
             AND is_archived = FALSE
             AND created_at >= NOW() - INTERVAL ? DAY`,
            [userId, days]
        );

        // =============================
        // ✅ READ COUNT
        // =============================
        const [readResult] = await db.query(
            `SELECT COUNT(*) as read_count FROM notifications
             WHERE user_id = ?
             AND is_read = 1
             AND is_archived = FALSE
             AND created_at >= NOW() - INTERVAL ? DAY`,
            [userId, days]
        );

        // =============================
        // ✅ UNREAD COUNT
        // =============================
        const [unreadResult] = await db.query(
            `SELECT COUNT(*) as unread_count FROM notifications
             WHERE user_id = ?
             AND is_read = 0
             AND is_archived = FALSE
             AND created_at >= NOW() - INTERVAL ? DAY`,
            [userId, days]
        );

        // =============================
        // ✅ FILTERED COUNT (WITH SEARCH + TYPE)
        // =============================
        const [filteredCountResult] = await db.query(
            `SELECT COUNT(*) as total FROM notifications
             WHERE user_id = ?
             AND is_archived = FALSE
             AND created_at >= NOW() - INTERVAL ? DAY
             ${typeCondition}
             ${searchCondition}`,
            [userId, days, ...searchValues]
        );

        // =============================
        // ✅ FORMAT DATA
        // =============================
        const formattedNotifications = notifications.map(n => ({
            id: n.id,
            type: n.type,
            title: n.title,
            message: n.message,
            context: typeof n.context === 'string'
                ? JSON.parse(n.context)
                : n.context || {},
            source_id: n.source_id,
            environment: n.environment,
            is_read: Boolean(n.is_read),
            created_at: n.created_at,
            read_at: n.read_at
        }));

        // =============================
        // ✅ PAGINATION
        // =============================
        const totalFiltered = filteredCountResult[0].total;
        const totalPages = Math.ceil(totalFiltered / limit);

        const start = totalFiltered === 0 ? 0 : offset + 1;
        const end = Math.min(offset + limit, totalFiltered);

        const pagination = {
            total_records: totalFiltered,
            total_pages: totalPages,
            current_page: page,
            per_page: limit,
            range_from: totalFiltered === 0
                ? "Showing 0-0 of 0 entries"
                : `Showing ${start}-${end} of ${totalFiltered} entries`,
            next_page: page < totalPages ? page + 1 : null,
            prev_page: page > 1 ? page - 1 : null
        };

        // =============================
        // ✅ FINAL RESPONSE
        // =============================
        res.json({
            success: true,
            data: {
                notifications: formattedNotifications,

                counts: {
                    total: totalResult[0].total,
                    read: readResult[0].read_count,
                    unread: unreadResult[0].unread_count
                },

                pagination
            }
        });

    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

router.post('/notifications/sound', async (req, res) => {
    try {
        const { email, sound_enabled } = req.body;
        const db = getDB();

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required"
            });
        }

        await db.query(
            `UPDATE notification_settings
       SET sound_enabled = ?, 
           updated_at = NOW()
       WHERE user_id = ?`,
            [
                sound_enabled,
                email.toLowerCase().trim()
            ]
        );

        res.json({
            success: true,
            message: "Notification settings updated",
            data: {
                email,
                sound_enabled
            }
        });

    } catch (error) {
        console.error("Update notification settings error:", error);
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// GET /api/notifications/unread-count - Get unread notification count
router.get('/notifications/unread-count', async (req, res) => {
    try {
        const userId = getUserFromRequest(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User authentication required'
            });
        }

        console.log('Getting unread count for user:', userId);

        const db = getDB();

        // Check if notifications table exists
        const [tableCheck] = await db.query(`
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE() 
            AND table_name = 'notifications'
        `);

        if (tableCheck[0].count === 0) {
            return res.json({
                success: true,
                data: {
                    unread_count: 0
                }
            });
        }

        const [result] = await db.query(
            `SELECT COUNT(*) as count FROM notifications 
             WHERE user_id = ? AND is_read = FALSE AND is_archived = FALSE`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                unread_count: result[0].count
            }
        });

    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// POST /api/notifications/mark-read - Mark notification as read
router.post('/notifications/mark-read', async (req, res) => {
    try {
        const userId = getUserFromRequest(req);
        const { notificationId } = req.body;

        if (!userId || !notificationId) {
            return res.status(400).json({
                success: false,
                message: 'User ID and notification ID are required'
            });
        }

        console.log(`Marking notification ${notificationId} as read for user ${userId}`);

        const db = getDB();
        await db.query(
            'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ? AND user_id = ?',
            [notificationId, userId]
        );

        res.json({
            success: true,
            message: 'Notification marked as read'
        });

    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// POST /api/notifications/mark-all-read - Mark all notifications as read
router.post('/notifications/mark-all-read', async (req, res) => {
    try {
        const userId = getUserFromRequest(req);

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        console.log(`Marking all notifications as read for user ${userId}`);

        const db = getDB();
        await db.query(
            'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        res.json({
            success: true,
            message: 'All notifications marked as read'
        });

    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// GET /api/notifications/settings - Get notification settings
router.get('/notifications/settings', async (req, res) => {
    try {
        const userId = getUserFromRequest(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User authentication required'
            });
        }

        console.log('Getting notification settings for user:', userId);

        const db = getDB();

        // Check if notification_settings table exists
        const [tableCheck] = await db.query(`
            SELECT COUNT(*) as count 
            FROM information_schema.tables 
            WHERE table_schema = DATABASE() 
            AND table_name = 'notification_settings'
        `);

        // ✅ UPDATED: Default settings with push_notifications
        const defaultSettings = {
            email_notifications: true,
            push_notifications: false, // Default to false for privacy
            in_app_notifications: true,
            sound_enabled: true,
            critical_priority_sound: true,
            normal_priority_sound: true,
            low_priority_sound: false
        };

        if (tableCheck[0].count === 0) {
            return res.json({
                success: true,
                data: defaultSettings
            });
        }

        const [settings] = await db.query(
            'SELECT * FROM notification_settings WHERE user_id = ?',
            [userId]
        );

        // ✅ UPDATED: Merge with defaults to ensure push_notifications field exists
        const userSettings = settings[0] || {};
        const mergedSettings = {
            ...defaultSettings,
            ...userSettings
        };

        res.json({
            success: true,
            data: mergedSettings
        });

    } catch (error) {
        console.error('Error fetching notification settings:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// POST /api/notifications/settings - Update notification settings
router.post('/notifications/settings', async (req, res) => {
    try {
        const userId = getUserFromRequest(req);
        const settings = req.body.settings;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'User authentication required'
            });
        }

        console.log('Updating notification settings for user:', userId);

        const db = getDB();

        // ✅ UPDATED: Include push_notifications in the query
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
                userId,
                settings.email_notifications ?? true,
                settings.push_notifications ?? true,
                settings.in_app_notifications ?? true,
                settings.sound_enabled ?? true,
                settings.critical_priority_sound ?? true,
                settings.normal_priority_sound ?? true,
                settings.low_priority_sound ?? false,
            ]
        );


        res.json({
            success: true,
            message: 'Notification settings updated successfully'
        });

    } catch (error) {
        console.error('Error updating notification settings:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// ✅ NEW: Push notification subscription endpoint
router.post('/notifications/push-subscribe', async (req, res) => {
    try {
        const userId = getUserFromRequest(req);
        const { subscription } = req.body;

        if (!userId || !subscription) {
            return res.status(400).json({
                success: false,
                message: 'User ID and subscription are required'
            });
        }

        console.log('Saving push subscription for user:', userId);

        const db = getDB();

        // Create push_subscriptions table if it doesn't exist
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                subscription_data JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `;

        await db.query(createTableQuery);

        // Store subscription
        await db.query(
            `INSERT INTO push_subscriptions (email, subscription_data, created_at, updated_at)
             VALUES (?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE
             subscription_data = VALUES(subscription_data),
             updated_at = NOW()`,
            [userId, JSON.stringify(subscription)]
        );

        res.json({
            success: true,
            message: 'Push subscription saved successfully'
        });

    } catch (error) {
        console.error('Error saving push subscription:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// ✅ NEW: Push notification unsubscribe endpoint
router.post('/notifications/push-unsubscribe', async (req, res) => {
    try {
        const userId = getUserFromRequest(req);

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        console.log('Removing push subscription for user:', userId);

        const db = getDB();
        await db.query('DELETE FROM push_subscriptions WHERE email = ?', [userId]);

        res.json({
            success: true,
            message: 'Push subscription removed successfully'
        });

    } catch (error) {
        console.error('Error removing push subscription:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Test endpoint to decode JWT token
router.get('/notifications/decode-token', async (req, res) => {
    try {
        console.log('=== DECODE TOKEN ENDPOINT ===');
        console.log('Headers:', req.headers);

        const authHeader = req.headers.authorization;
        if (!authHeader) {
            console.log('No authorization header');
            return res.status(401).json({
                success: false,
                message: 'No authorization header'
            });
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
            console.log('No token found in authorization header');
            return res.status(401).json({
                success: false,
                message: 'No token found'
            });
        }

        // Decode JWT
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const decodedPayload = JSON.parse(Buffer.from(base64, 'base64').toString('binary'));

        console.log('Decoded payload:', decodedPayload);

        res.json({
            success: true,
            data: decodedPayload,
            message: 'Token decoded successfully'
        });

    } catch (error) {
        console.error('Error decoding token:', error);
        res.status(500).json({
            success: false,
            message: 'Error decoding token'
        });
    }
});

export default router;