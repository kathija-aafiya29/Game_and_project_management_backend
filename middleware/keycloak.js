import session from "express-session";
import Keycloak from "keycloak-connect";
import dotenv from "dotenv";

dotenv.config();

const memoryStore = new session.MemoryStore();

const keycloak = new Keycloak(
  {
    store: memoryStore,
  },
  {
    realm: process.env.KEYCLOAK_REALM,
    "auth-server-url": process.env.KEYCLOAK_AUTH_SERVER_URL,
    "ssl-required": "none",
    resource: process.env.KEYCLOAK_CLIENT_ID,
    "public-client": true,
    "confidential-port": 0,
  }
);

export { keycloak, memoryStore };
