import crypto from "node:crypto";

const SCRYPT_KEY_LEN = 64;
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;

function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEY_LEN,
      { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey as Buffer);
      }
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nRaw, rRaw, pRaw, salt, expectedHex] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      expectedHex.length / 2,
      { N: n, r, p },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result as Buffer);
      }
    );
  });

  const expected = Buffer.from(expectedHex, "hex");
  if (derivedKey.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derivedKey, expected);
}
