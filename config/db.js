import mysql from "mysql2/promise";
import { getDBConfig } from "./config.js";

let pool;

export const initDB = async () => {
  try {
    const config = getDBConfig();
    pool = mysql.createPool({
      host: config.DB_HOST,
      port: config.DB_PORT || 3306,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      timezone: '+05:30',
      connectionLimit: 10,
      queueLimit: 0,
    });

    // Test the connection
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    console.log("✅ MySQL connected successfully");
    return pool;
  } catch (err) {
    console.error("❌ DB Connection Error:", err);
    throw err;
  }
};

// Export a function that returns the pool
export const getDB = () => {
  if (!pool) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return pool;
};

// For backward compatibility with routes that use db.query()
export const db = {
  query: (...args) => {
    if (!pool) {
      throw new Error('Database not initialized. Call initDB() first.');
    }
    return pool.query(...args);
  },
  execute: (...args) => {
    if (!pool) {
      throw new Error('Database not initialized. Call initDB() first.');
    }
    return pool.execute(...args);
  },
  getConnection: () => {
    if (!pool) {
      throw new Error('Database not initialized. Call initDB() first.');
    }
    return pool.getConnection();
  }
};