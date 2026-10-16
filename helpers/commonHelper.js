const { getUserWithTeam } = require("../services/keycloack.service");

const userTextColors = [
  '#2563EB', // Blue
  '#16A34A', // Green
  '#D97706', // Amber
  '#7C3AED', // Violet
  '#0891B2', // Cyan
  '#DB2777', // Pink
  '#4B5563', // Gray
  '#1D4ED8', // Strong Blue
  '#15803D', // Dark Green
  '#9333EA', // Purple
  '#0E7490', // Teal
  '#B45309', // Brown
  '#475569', // Slate
  '#BE185D', // Rose
  '#0369A1', // Sky
  '#6D28D9'  // Deep Violet
];


// Map to track assigned colors

exports.getShortName = (fullName = "") => {
  if (!fullName) return "";

  const parts = fullName.trim().split(/\s+/);

  if (parts.length === 1) {
    return parts[0][0].toUpperCase();
  }

  return (
    parts[0][0].toUpperCase() +
    parts[parts.length - 1][0].toUpperCase()
  );
};

/* -------- Helpers to resolve names -------- */
exports.getUserNameById = async (userId) => {
  if (!userId) return null;
  const user = await getUserWithTeam(userId);
  return user?.name || null;
};

exports.getEmailByUserId = async (userId) => {
  if (!userId) return null;
  const user = await getUserWithTeam(userId);
  return user?.email || null;
}

exports.getStatusNameById = async (db, statusId) => {
  if (statusId === null || statusId === undefined) return null;

  const [[row]] = await db.execute(
    `SELECT name FROM bug_statuses WHERE id = ?`,
    [statusId]
  );

  return row?.name || null;
};
const profileColors = [
  '#E3F2FD', // Light Blue
  '#E8F5E9', // Light Green
  '#FFF3E0', // Light Orange
  '#F3E5F5', // Light Purple
  '#E0F7FA', // Light Cyan
  '#FCE4EC', // Light Pink
  '#F1F8E9', // Light Lime
  '#EDE7F6', // Soft Lavender
  '#E0F2F1', // Mint
  '#FFF8E1', // Soft Yellow
  '#ECEFF1', // Light Gray Blue
  '#F5F5F5', // Neutral Light Gray
  '#E6F4EA', // Subtle Green
  '#E8EAF6', // Indigo Light
  '#FFF1F2', // Soft Rose
  '#EEF2FF'  // Pale Indigo
];



exports.getProfileColorForUser = (key = "") => {
  if (!key) return profileColors[0];

  // Create simple hash from key
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % profileColors.length;
  return profileColors[index];
};

exports.getTextColorForUser = (key = "") => {
  if (!key) return userTextColors[0];

  // Create simple hash from key
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % userTextColors.length;
  return userTextColors[index];
}
exports.getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30 in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};