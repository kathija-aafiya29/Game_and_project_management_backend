import jwt from "jsonwebtoken";

// const JWT_SECRET = process.env.JWT_SECRET || "POC_SECRET_KEY";
// const JWT_EXPIRES_IN = "1h";

// export function generateToken(payload){
//   return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
// };

export function verifySocketToken(token){
 const decoded = jwt.decode(token);

  if (!decoded) throw new Error("INVALID_TOKEN");

  if (decoded.exp * 1000 < Date.now()) {
    throw new Error("TOKEN_EXPIRED");
  }

  return decoded;
};

