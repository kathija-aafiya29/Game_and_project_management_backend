import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import https from "https";
import nodemailer from "nodemailer";
import crypto from "crypto";
import {
  getKeycloakConfig,
  getSMTPConfig
} from "../config/config.js";

dotenv.config();
const router = express.Router();

/* ================ ENV VARIABLES ============================= */

const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID;

/* =============== CONFIG HELPERS ===================== */

const getKeycloakConfigs = () => {
  const keycloak = getKeycloakConfig();
  return {
    KEYCLOAK_AUTH_SERVER_URL: keycloak.KEYCLOAK_AUTH_SERVER_URL,
    KEYCLOAK_CLIENT_SECRET: keycloak.KEYCLOAK_CLIENT_SECRET,
    KEYCLOAK_ADMIN_USERNAME: keycloak.ADMIN_USERNAME,
    KEYCLOAK_ADMIN_PASSWORD: keycloak.ADMIN_PASSWORD,
  };
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

// Store reset tokens temporarily (in production, use a database)
const resetTokens = new Map(); // email -> { token, expires, userId }

// Helper function to safely decode JWT
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    
    return JSON.parse(decoded);
  } catch (error) {
    console.error('JWT decoding error:', error.message);
    return null;
  }
}

// Helper function to get Keycloak admin token
async function getKeycloakAdminToken() {
  const keycloak = getKeycloakConfigs();
  const tokenUrl = `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append("grant_type", "password");
  params.append("client_id", KEYCLOAK_CLIENT_ID);
  params.append("username", keycloak.KEYCLOAK_ADMIN_USERNAME);
  params.append("password", keycloak.KEYCLOAK_ADMIN_PASSWORD);

  if (keycloak.KEYCLOAK_CLIENT_SECRET) {
    params.append("client_secret", keycloak.KEYCLOAK_CLIENT_SECRET);
  }

  try {
    console.log({
      tokenUrl,
      username:
        keycloak.KEYCLOAK_ADMIN_USERNAME,
      client:
        KEYCLOAK_CLIENT_ID
    });

    const response =
      await axios.post(
        tokenUrl,
        params,
        {
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          httpsAgent:
            new https.Agent({
              rejectUnauthorized: false
            }),
        }
      );

    console.log(
      "✅ Admin token generated"
    );

    return response.data.access_token;

  } catch (error) {

    console.error(
      "Failed to get admin token:"
    );

    if (error.response) {

      console.error(
        error.response.data
      );
    }

    throw error;
  }
}

// Helper function to get user ID from username
async function getUserIdByUsername(username, adminToken) {
  try {
    const keycloak = getKeycloakConfigs();
    const usersResponse = await axios.get(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        params: {
          username: username,
          exact: true
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    );

    if (!usersResponse.data || usersResponse.data.length === 0) {
      return null;
    }

    return usersResponse.data[0].id;
  } catch (error) {
    console.error("Error getting user ID:", error);
    return null;
  }
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
const keycloak = getKeycloakConfigs();
  const tokenUrl = `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append("grant_type", "password");
  params.append("client_id", KEYCLOAK_CLIENT_ID);
  params.append("username", username);
  params.append("password", password);
  params.append("scope", "openid profile email"); 

  if (keycloak.KEYCLOAK_CLIENT_SECRET) {
    params.append("client_secret", keycloak.KEYCLOAK_CLIENT_SECRET);
  }

  try {
    console.log("🔑 Requesting token from:", tokenUrl);
    const tokenResponse = await axios.post(tokenUrl, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    const tokenData = tokenResponse.data;
    const accessToken = tokenData.access_token;

    console.log("✅ Token received successfully");

    // Get user info
    const userInfoUrl = `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/userinfo`;
    const userInfoResponse = await axios.get(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    const userInfo = userInfoResponse.data;
    console.log("✅ User info received:", userInfo.preferred_username);

    // Decode token to get required actions
    const jwtPayload = decodeJWT(accessToken);
    const requiredActions = jwtPayload?.required_actions || [];
    
    console.log("📋 Required actions:", requiredActions);

    // Get roles from token
    const roles = jwtPayload?.realm_access?.roles || [];
    const groups = jwtPayload?.groups || [];

    const userDetails = {
      username: userInfo.preferred_username || username,
      email: userInfo.email || '',
      firstName: userInfo.given_name || '',
      lastName: userInfo.family_name || '',
      roles,
      groups,
      accessToken,
      refreshToken: tokenData.refresh_token,
      tokenType: tokenData.token_type,
      expiresIn: tokenData.expires_in,
    };

    // Check if password change is required
    if (requiredActions.includes('UPDATE_PASSWORD')) {
      console.log("⚠️ Password update required for user:", userDetails.username);
      return res.json({
        ...userDetails,
        requiredActions: ['UPDATE_PASSWORD'],
        accessToken
      });
    }

    console.log("🎉 Login successful for user:", userDetails.username);
    res.json(userDetails);

  } catch (err) {
    console.error("❌ Keycloak login error:");
    
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Response data:", err.response.data);
      
      // Handle "Account is not fully set up" error
      if (err.response.status === 400 && 
          err.response.data?.error === "invalid_grant" && 
          err.response.data?.error_description === "Account is not fully set up") {
        
        console.log("⚠️ Account not fully set up - getting admin token to handle password update");
        
        try {
          const adminToken = await getKeycloakAdminToken();
          
          const usersResponse = await axios.get(
            `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
            {
              headers: {
                Authorization: `Bearer ${adminToken}`,
              },
              params: {
                username: username,
                exact: true
              },
              httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            }
          );

          if (usersResponse.data && usersResponse.data.length > 0) {
            const userData = usersResponse.data[0];
            
            return res.status(401).json({
              error: "Account is not fully set up",
              requiredAction: "UPDATE_PASSWORD",
              username: username,
              email: userData.email || username,
              firstName: userData.firstName || '',
              lastName: userData.lastName || ''
            });
          }
        } catch (adminError) {
          console.error("Error getting admin token:", adminError);
        }
      }
      
      res.status(err.response.status).json({
        error: err.response.data?.error_description ||
               err.response.data?.error ||
               "Invalid credentials or Keycloak error",
        details: err.response.data
      });
    } else if (err.request) {
      console.error("No response received:", err.request);
      res.status(503).json({ 
        error: "Keycloak server is not responding",
        details: err.message
      });
    } else {
      console.error("Request setup error:", err.message);
      res.status(500).json({ 
        error: "Internal server error",
        details: err.message
      });
    }
  }
});

// Forgot password - send reset email
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    // Get admin token
    const keycloak = getKeycloakConfigs();
    const smtp = getSMTPConfigs();
    const adminToken = await getKeycloakAdminToken();
    
    // Find user by email in Keycloak
    const usersResponse = await axios.get(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
        params: {
          email: email,
          exact: true
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    );

    if (!usersResponse.data || usersResponse.data.length === 0) {
      // Return success even if user not found (security best practice)
      return res.json({ 
        message: "If the email exists in our system, reset instructions will be sent" 
      });
    }

    const user = usersResponse.data[0];
    const userId = user.id;
    const firstName = user.firstName || '';
    const lastName = user.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim() || email;

    // Generate a unique reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Store token temporarily
    resetTokens.set(email, {
      token: resetToken,
      expires: expiresAt,
      userId: userId
    });

    // Create reset link
    const resetLink = `https://unityone.swwebapps.com/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    // Setup email transporter
    const transporter = nodemailer.createTransport({
        host: smtp.SMTP_HOST,
        port: smtp.SMTP_PORT,
        secure: false,
        auth: {
          user: smtp.SMTP_USER,
          pass: smtp.SMTP_PASS,
        },
      });

    // Create email HTML content
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

    <!-- Main Content -->
    <div style="padding: 40px 30px; text-align: left; background-color: #ffffff;">
      
      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0; color: #555555;">
        <strong style="color: #333333;">Hi ${fullName},</strong>
      </p>
      
      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 25px 0; color: #555555;">
        We received a request to reset the password for your Build Management account.
      </p>
      
      <!-- Button Container -->
      <div style="text-align: center; margin: 35px 0;">
        <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #0476be, #139FFF); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 50px; font-size: 16px; font-weight: 600; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(4, 118, 190, 0.3);">
          Reset Your Password
        </a>
      </div>
      
      <!-- Important Notes -->
      <div style="background-color: #f8faff; border-left: 4px solid #0476be; padding: 20px; margin: 30px 0; border-radius: 8px;">
        <p style="font-size: 14px; line-height: 1.5; margin: 0 0 10px 0; color: #666666;">
          <strong style="color: #333333;">⏰ Link Expiry:</strong> This reset link is valid for <strong style="color: #0476be;">15 minutes</strong>. If you don't reset your password within this time, you'll need to request a new link.
        </p>
        <p style="font-size: 14px; line-height: 1.5; margin: 0; color: #666666;">
          <strong style="color: #333333;">🔒 Security Notice:</strong> If you did not request a password reset, please ignore this email. Your account will remain secure. For security reasons, do not share this link with anyone.
        </p>
      </div>
      
      <p style="font-size: 14px; line-height: 1.5; margin: 25px 0 0 0; color: #888888; font-style: italic;">
        This is an automated message, please do not reply to this email.
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

    // Send email
    await transporter.sendMail({
      from: smtp.SMTP_FROM,
      to: email,
      subject: "Reset Your Build Management Password",
      html: emailBody,
    });

    console.log(`📧 Password reset email sent to: ${email}`);

    res.json({ 
      message: "If the email exists in our system, reset instructions will be sent" 
    });

  } catch (error) {
    console.error("Forgot password error:", error);
    // Always return success for security
    res.json({ 
      message: "If the email exists in our system, reset instructions will be sent" 
    });
  }
});

// Verify reset token
router.post("/verify-reset-token", async (req, res) => {
  const { token, email } = req.body;

  if (!token || !email) {
    return res.status(400).json({ error: "Token and email are required" });
  }

  const storedData = resetTokens.get(email);

  if (!storedData || storedData.token !== token) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  if (Date.now() > storedData.expires) {
    resetTokens.delete(email);
    return res.status(400).json({ error: "Token has expired" });
  }

  res.json({ valid: true, userId: storedData.userId });
});

// Reset password with token
router.post("/reset-password", async (req, res) => {
  const { token, email, newPassword } = req.body;

  if (!token || !email || !newPassword) {
    return res.status(400).json({ error: "Token, email, and new password are required" });
  }

  const storedData = resetTokens.get(email);

  if (!storedData || storedData.token !== token) {
    return res.status(400).json({ error: "Invalid or expired token" });
  }

  if (Date.now() > storedData.expires) {
    resetTokens.delete(email);
    return res.status(400).json({ error: "Token has expired" });
  }

  try {
    const keycloak = getKeycloakConfigs();
    const adminToken = await getKeycloakAdminToken();
    
    // Reset the password
    await axios.put(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users/${storedData.userId}/reset-password`,
      {
        type: "password",
        value: newPassword,
        temporary: false
      },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    );

    // Remove any required actions
    await axios.put(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users/${storedData.userId}`,
      {
        requiredActions: []
      },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    );

    // Delete the used token
    resetTokens.delete(email);

    res.json({ message: "Password reset successfully" });
    
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ 
      error: "Failed to reset password",
      details: error.response?.data || error.message
    });
  }
});

// Update password endpoint (for temporary password flow)
router.post("/update-password", async (req, res) => {
  const { username, newPassword, signOutOthers } = req.body;

  if (!username || !newPassword) {
    return res.status(400).json({ error: "Username and new password are required" });
  }

  try {
    const keycloak = getKeycloakConfigs();
    const adminToken = await getKeycloakAdminToken();
    
    // Find the user
    const userId = await getUserIdByUsername(username, adminToken);
    
    if (!userId) {
      return res.status(404).json({ error: "User not found" });
    }

    // Reset the password
    await axios.put(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}/reset-password`,
      {
        type: "password",
        value: newPassword,
        temporary: false
      },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    );

    // Remove required actions
    await axios.put(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`,
      {
        requiredActions: []
      },
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }
    );

    // If signOutOthers is true, revoke all sessions
    if (signOutOthers) {
      try {
        await axios.post(
          `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}/logout`,
          {},
          {
            headers: {
              Authorization: `Bearer ${adminToken}`,
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          }
        );
        console.log("✅ Signed out from other devices");
      } catch (logoutError) {
        console.error("Error signing out from other devices:", logoutError);
        // Don't fail the request if logout fails
      }
    }

    res.json({ 
      message: "Password updated successfully",
      username: username 
    });
    
  } catch (error) {
    console.error("Password update error:", error);
    
    res.status(500).json({ 
      error: "Failed to update password",
      details: error.response?.data || error.message
    });
  }
});

export default router;