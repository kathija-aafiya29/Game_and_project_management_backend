import axios from "axios";
import https from "https";
import dotenv from "dotenv";
import { getKeycloakConfig } from "../config/config.js";
dotenv.config();
const { KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID } = process.env;

const getKeycloakConfigs = () => {
  const keycloak = getKeycloakConfig();
  return {
    KEYCLOAK_AUTH_SERVER_URL: keycloak.KEYCLOAK_AUTH_SERVER_URL,
    KEYCLOAK_CLIENT_SECRET: keycloak.KEYCLOAK_CLIENT_SECRET,
    KEYCLOAK_ADMIN_USERNAME: keycloak.ADMIN_USERNAME,
    KEYCLOAK_ADMIN_PASSWORD: keycloak.ADMIN_PASSWORD,
  };
};

/* -------------------------------------------------
   ADMIN TOKEN (with simple in-memory cache)
-------------------------------------------------- */
let cachedToken = null;
let tokenExpiry = 0;

export const getAdminToken = async () => {
  // ✅ RETURN CACHED TOKEN
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const keycloak = getKeycloakConfigs();

  try {
    // ✅ VALIDATION
    if (!keycloak.KEYCLOAK_AUTH_SERVER_URL) {
      throw new Error("KEYCLOAK_AUTH_SERVER_URL is missing");
    }

    if (!KEYCLOAK_REALM) {
      throw new Error("KEYCLOAK_REALM is missing");
    }

    if (!KEYCLOAK_CLIENT_ID) {
      throw new Error("KEYCLOAK_CLIENT_ID is missing");
    }

    if (!keycloak.KEYCLOAK_CLIENT_SECRET) {
      throw new Error("KEYCLOAK_CLIENT_SECRET is missing");
    }

    if (!keycloak.KEYCLOAK_ADMIN_USERNAME) {
      throw new Error("KEYCLOAK_ADMIN_USERNAME is missing");
    }

    if (!keycloak.KEYCLOAK_ADMIN_PASSWORD) {
      throw new Error("KEYCLOAK_ADMIN_PASSWORD is missing");
    }

    // ✅ REQUEST TOKEN
    const { data } = await axios.post(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: "password",
        client_id: KEYCLOAK_CLIENT_ID,
        client_secret: keycloak.KEYCLOAK_CLIENT_SECRET,
        username: keycloak.KEYCLOAK_ADMIN_USERNAME,
        password: keycloak.KEYCLOAK_ADMIN_PASSWORD,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    // ✅ CACHE TOKEN
    cachedToken = data.access_token;

    tokenExpiry = Date.now() + (data.expires_in - 30) * 1000;

    console.log("✅ New admin token fetched");

    return cachedToken;
  } catch (err) {
    console.error("❌ Error fetching Keycloak admin token:");

    console.error("STATUS:", err.response?.status);

    console.error("DATA:", err.response?.data);

    console.error("MESSAGE:", err.message);

    throw err;
  }
};

/* -------------------------------------------------
   GET USER BY ID
-------------------------------------------------- */
export const getUserById = async (userId) => {
  if (!userId) return null;

  const token = await getAdminToken();
  const keycloak = getKeycloakConfigs();

  try {
    console.log("Fetching user:", userId);
    console.log(
      "Request URL:",
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`,
    );

    const { data: user } = await axios.get(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    console.log("User response:", user);

    return {
      id: user.id,
      name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
      email: user.email,
      username: user.username,
    };
  } catch (err) {
    console.error("Error fetching user:", userId);
    console.error("Error response:", err.response?.data);
    console.error("Error message:", err.message);
    return null;
  }
};

/* -------------------------------------------------
   GET USER TEAMS (GROUPS)
-------------------------------------------------- */
export const getUserTeams = async (userId) => {
  if (!userId) return [];

  const token = await getAdminToken();
  const keycloak = getKeycloakConfigs();
  try {
    const { data: groups } = await axios.get(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users/${userId}/groups`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    return groups.map((g) => ({
      id: g.id,
      name: g.name,
      path: g.path,
    }));
  } catch (err) {
    console.error(
      `Error fetching groups for user ${userId}:`,
      err.response?.data || err.message,
    );
    return [];
  }
};

/* -------------------------------------------------
   GET USER WITH TEAMS (MOST USED)
-------------------------------------------------- */
export const getUserWithTeam = async (userId) => {
  const user = await getUserById(userId);

  console.log(user, "user by Id");

  if (!user) return null;

  const teams = await getUserTeams(userId);

  return {
    ...user,
    teams,
  };
};

/* ---------------- ALL USERS ---------------- */
export const getAllKeycloakUsers = async () => {
  const token = await getAdminToken();
  const keycloak = getKeycloakConfigs();
  const { data } = await axios.get(
    `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${KEYCLOAK_REALM}/users`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        max: 1000, // increase if needed
      },
    },
  );

  return data.map((u) => ({
    id: u.id,
    name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.username,
    email: u.email,
  }));
};
const userCache = new Map();
const teamCache = new Map();
export const getUsersWithTeamsBulk = async (userIds) => {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);

  if (!uniqueIds.length) return {};

  const result = {};

  /* STEP 1: Get users in parallel (but cached) */
  const users = await Promise.all(
    uniqueIds.map(async (id) => {
      if (userCache.has(id)) return userCache.get(id);

      const user = await getUserById(id);
      userCache.set(id, user);
      return user;
    }),
  );

  /* STEP 2: Get teams in parallel (but cached) */
  const teamsList = await Promise.all(
    uniqueIds.map(async (id) => {
      if (teamCache.has(id)) return teamCache.get(id);

      const teams = await getUserTeams(id);
      teamCache.set(id, teams);
      return teams;
    }),
  );

  /* STEP 3: Combine */
  uniqueIds.forEach((id, index) => {
    const user = users[index];

    if (user) {
      result[id] = {
        ...user,
        teams: teamsList[index] || [],
      };
    }
  });

  return result;
};

export const logoutAllUsers = async () => {
  const token = await getAdminToken();
  const keycloak = getKeycloakConfigs();
  try {
    console.log("🔍 Fetching all users from Keycloak...");

    // Step 1: fetch users (pagination safe)
    let first = 0;
    const max = 100;
    let users = [];
    let batch = [];

    do {
      const { data } = await axios.get(
        `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { first, max },
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        },
      );

      batch = data;
      users.push(...batch);
      first += max;
    } while (batch.length === max);

    console.log(`👥 Total users found: ${users.length}`);

    // Step 2: logout each user
    let success = 0;
    let failed = 0;

    for (const user of users) {
      try {
        await axios.post(
          `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${user.id}/logout`,
          {},
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
          },
        );

        success++;
        console.log(`✅ Logged out: ${user.username}`);
      } catch (err) {
        failed++;
        console.error(`❌ Failed logout: ${user.username}`);
      }
    }

    console.log("🎉 Bulk logout completed");
    console.log(`Success: ${success}, Failed: ${failed}`);
  } catch (err) {
    console.error(
      "❌ Bulk logout job failed:",
      err.response?.data || err.message,
    );
    throw err;
  }
};

export const validateKeycloakToken = async (req, res, next) => {
  const keycloak = getKeycloakConfigs();
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "Missing token" });
    }

    const token = authHeader.split(" ")[1];

    const params = new URLSearchParams();
    params.append("token", token);
    params.append("client_id", process.env.KEYCLOAK_CLIENT_ID);
    params.append("client_secret", keycloak.KEYCLOAK_CLIENT_SECRET);

    const response = await axios.post(
      `${keycloak.KEYCLOAK_AUTH_SERVER_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token/introspect`,
      params,
    );

    if (!response.data.active) {
      return res.status(401).json({ message: "Token revoked / logged out" });
    }

    req.user = response.data;
    next();
  } catch (err) {
    console.error("Token validation error:", err.message);
    return res.status(401).json({ message: "Invalid token" });
  }
};
