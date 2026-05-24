import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Usage: node scripts/generate-auth-config.mjs <admin-password-of-at-least-12-characters>");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log("# Copy these values to .env.local:");
console.log(`ADMIN_PASSWORD_HASH=scrypt\\$${salt.toString("base64url")}\\$${hash.toString("base64url")}`);
console.log(`AUTH_SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
console.log("# For Vercel environment variables, remove the two backslashes from ADMIN_PASSWORD_HASH.");
