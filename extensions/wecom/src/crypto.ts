/**
 * WeCom callback verification and message encryption/decryption.
 * Uses AES-256-CBC with PKCS#7 padding, matching the WeCom API spec.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Generate WeCom callback signature: SHA1(sort([token, timestamp, nonce, encrypted])). */
export function generateWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string,
): string {
  const sorted = [token, timestamp, nonce, encrypted].sort().join("");
  return createHash("sha1").update(sorted).digest("hex");
}

/** Verify a WeCom callback signature. */
export function verifyWecomCallback(params: {
  token: string;
  timestamp: string;
  nonce: string;
  encrypted: string;
  signature: string;
}): boolean {
  const expected = generateWecomSignature(
    params.token,
    params.timestamp,
    params.nonce,
    params.encrypted,
  );
  return expected === params.signature;
}

/**
 * Derive the 32-byte AES key from WeCom's encodingAESKey (base64, 43 chars → 32 bytes).
 */
function deriveAesKey(encodingAESKey: string): Buffer {
  return Buffer.from(encodingAESKey + "=", "base64");
}

/** PKCS#7 unpad. */
function pkcs7Unpad(buf: Buffer): Buffer {
  const padLen = buf[buf.length - 1]!;
  if (padLen < 1 || padLen > 32) {
    return buf;
  }
  return buf.subarray(0, buf.length - padLen);
}

/** PKCS#7 pad to 32-byte blocks. */
function pkcs7Pad(buf: Buffer): Buffer {
  const blockSize = 32;
  const padLen = blockSize - (buf.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  return Buffer.concat([buf, padding]);
}

/**
 * Decrypt a WeCom encrypted message.
 * Format after decryption: 16-byte random + 4-byte msg_len (BE) + msg + corpId
 */
export function decryptWecomMessage(
  encodingAESKey: string,
  encrypted: string,
): { message: string; corpId: string } {
  const key = deriveAesKey(encodingAESKey);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);

  const cipherBuf = Buffer.from(encrypted, "base64");
  const decrypted = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
  const unpadded = pkcs7Unpad(decrypted);

  // Skip 16 random bytes, read 4-byte message length (big-endian)
  const msgLen = unpadded.readUInt32BE(16);
  const message = unpadded.subarray(20, 20 + msgLen).toString("utf8");
  const corpId = unpadded.subarray(20 + msgLen).toString("utf8");

  return { message, corpId };
}

/**
 * Encrypt a WeCom message for callback reply.
 * Format: 16-byte random + 4-byte msg_len (BE) + msg + corpId
 */
export function encryptWecomMessage(
  encodingAESKey: string,
  corpId: string,
  message: string,
): string {
  const key = deriveAesKey(encodingAESKey);
  const iv = key.subarray(0, 16);

  const random = randomBytes(16);
  const msgBuf = Buffer.from(message, "utf8");
  const corpIdBuf = Buffer.from(corpId, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);

  const plaintext = pkcs7Pad(Buffer.concat([random, lenBuf, msgBuf, corpIdBuf]));
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);

  return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64");
}

/** Extract a field value from simple WeCom XML. */
export function extractXmlField(xml: string, field: string): string | undefined {
  // WeCom XML is simple and predictable: <xml><field><![CDATA[value]]></field></xml>
  const cdataPattern = new RegExp(`<${field}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${field}>`, "i");
  const cdataMatch = cdataPattern.exec(xml);
  if (cdataMatch) {
    return cdataMatch[1];
  }
  // Also handle non-CDATA: <field>value</field>
  const plainPattern = new RegExp(`<${field}>([^<]*)</${field}>`, "i");
  const plainMatch = plainPattern.exec(xml);
  return plainMatch?.[1];
}

/** Build a simple WeCom XML response. */
export function buildWecomXml(fields: Record<string, string | number>): string {
  const parts = Object.entries(fields).map(([key, value]) => {
    if (typeof value === "number") {
      return `<${key}>${value}</${key}>`;
    }
    return `<${key}><![CDATA[${value}]]></${key}>`;
  });
  return `<xml>${parts.join("")}</xml>`;
}
