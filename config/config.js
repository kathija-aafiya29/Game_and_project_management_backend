import dotenv from "dotenv";
import { getSecret } from "./awsSecrets.js";

dotenv.config();

/* ========================================= CONFIG VARIABLES ==================================== */
let dbConfig = null;
let s3Config = null;
let keycloakConfig = null;
let smtpConfig = null;

/* ========================================= LOAD SECRETS ================================= */

export const loadSecrets = async () => {
  try {
    /* ================================ DB SECRET ============================ */

    dbConfig = await getSecret(
      process.env.DB_SECRET_NAME
    );
    console.log("✅ DB Secret Loaded");

    /* ================================= S3 SECRET ============================ */

    s3Config = await getSecret(
      process.env.S3_SECRET
    );
    console.log("✅ S3 Secret Loaded");

    /* ================================== KEYCLOAK SECRET ================================ */

    keycloakConfig = await getSecret(
      process.env.KEYCLOAK_SECRET
    );
    console.log("✅ Keycloak Secret Loaded");

    /* =============================== SMTP SECRET (OPTIONAL) ======================== */

    if (process.env.SMTP_SECRET_NAME) {
      smtpConfig = await getSecret(
        process.env.SMTP_SECRET_NAME
      );
      console.log("✅ SMTP Secret Loaded");
    }
    console.log(
      "🔥 All Secrets Loaded Successfully"
    );

  } catch (error) {

    console.error(
      "❌ Failed to load secrets:",
      error
    );

    process.exit(1);
  }
};

/* =========================================
   EXPORT CONFIGS
========================================= */

export const getDBConfig = () => {
  if (!dbConfig) {
    throw new Error(
      "DB Config not loaded"
    );
  }
  return dbConfig;
};

export const getS3Config = () => {
  if (!s3Config) {
    throw new Error(
      "S3 Config not loaded"
    );
  }
  return s3Config;
};

export const getKeycloakConfig = () => {
  if (!keycloakConfig) {
    throw new Error(
      "Keycloak Config not loaded"
    );
  }
  return keycloakConfig;
};

export const getSMTPConfig = () => {
  if (!smtpConfig) {
    throw new Error(
      "SMTP Config not loaded"
    );
  }
  return smtpConfig;
};