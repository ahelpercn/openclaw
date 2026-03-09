import { describe, expect, it } from "vitest";
import {
  buildWecomXml,
  decryptWecomMessage,
  encryptWecomMessage,
  extractXmlField,
  generateWecomSignature,
  verifyWecomCallback,
} from "./crypto.js";

// WeCom uses a 43-char base64 encodingAESKey (decodes to 32 bytes)
const TEST_ENCODING_AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const TEST_CORP_ID = "wx1234567890abcdef";
const TEST_TOKEN = "test_token_123";

describe("generateWecomSignature", () => {
  it("produces a consistent SHA1 hash", () => {
    const sig = generateWecomSignature("token", "1234567890", "nonce123", "encrypted_data");
    expect(sig).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is order-independent (sorted before hash)", () => {
    const sig1 = generateWecomSignature("a", "b", "c", "d");
    const sig2 = generateWecomSignature("d", "c", "b", "a");
    // Both should produce the same hash since inputs are sorted
    expect(sig1).toBe(sig2);
  });

  it("changes with different inputs", () => {
    const sig1 = generateWecomSignature("token", "1234", "nonce", "data1");
    const sig2 = generateWecomSignature("token", "1234", "nonce", "data2");
    expect(sig1).not.toBe(sig2);
  });
});

describe("verifyWecomCallback", () => {
  it("verifies a correct signature", () => {
    const sig = generateWecomSignature(TEST_TOKEN, "12345", "nonce", "encrypted");
    expect(
      verifyWecomCallback({
        token: TEST_TOKEN,
        timestamp: "12345",
        nonce: "nonce",
        encrypted: "encrypted",
        signature: sig,
      }),
    ).toBe(true);
  });

  it("rejects an incorrect signature", () => {
    expect(
      verifyWecomCallback({
        token: TEST_TOKEN,
        timestamp: "12345",
        nonce: "nonce",
        encrypted: "encrypted",
        signature: "0000000000000000000000000000000000000000",
      }),
    ).toBe(false);
  });
});

describe("encrypt / decrypt roundtrip", () => {
  it("roundtrips a plain text message", () => {
    const original = "Hello from WeCom!";
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, TEST_CORP_ID, original);
    expect(typeof encrypted).toBe("string");
    expect(encrypted.length).toBeGreaterThan(0);

    const { message, corpId } = decryptWecomMessage(TEST_ENCODING_AES_KEY, encrypted);
    expect(message).toBe(original);
    expect(corpId).toBe(TEST_CORP_ID);
  });

  it("roundtrips a Chinese message", () => {
    const original = "你好，企业微信！";
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, TEST_CORP_ID, original);
    const { message, corpId } = decryptWecomMessage(TEST_ENCODING_AES_KEY, encrypted);
    expect(message).toBe(original);
    expect(corpId).toBe(TEST_CORP_ID);
  });

  it("roundtrips an XML message", () => {
    const xml =
      "<xml><Content><![CDATA[test message]]></Content><MsgType><![CDATA[text]]></MsgType></xml>";
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, TEST_CORP_ID, xml);
    const { message } = decryptWecomMessage(TEST_ENCODING_AES_KEY, encrypted);
    expect(message).toBe(xml);
  });

  it("roundtrips an empty message", () => {
    const encrypted = encryptWecomMessage(TEST_ENCODING_AES_KEY, TEST_CORP_ID, "");
    const { message, corpId } = decryptWecomMessage(TEST_ENCODING_AES_KEY, encrypted);
    expect(message).toBe("");
    expect(corpId).toBe(TEST_CORP_ID);
  });
});

describe("extractXmlField", () => {
  it("extracts CDATA fields", () => {
    const xml = "<xml><Content><![CDATA[hello world]]></Content></xml>";
    expect(extractXmlField(xml, "Content")).toBe("hello world");
  });

  it("extracts plain value fields", () => {
    const xml = "<xml><CreateTime>1700000000</CreateTime></xml>";
    expect(extractXmlField(xml, "CreateTime")).toBe("1700000000");
  });

  it("extracts MsgType from mixed XML", () => {
    const xml =
      "<xml><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hi]]></Content><CreateTime>123</CreateTime></xml>";
    expect(extractXmlField(xml, "MsgType")).toBe("text");
    expect(extractXmlField(xml, "Content")).toBe("hi");
    expect(extractXmlField(xml, "CreateTime")).toBe("123");
  });

  it("returns undefined for missing fields", () => {
    const xml = "<xml><Foo>bar</Foo></xml>";
    expect(extractXmlField(xml, "Missing")).toBeUndefined();
  });

  it("handles empty CDATA", () => {
    const xml = "<xml><Content><![CDATA[]]></Content></xml>";
    expect(extractXmlField(xml, "Content")).toBe("");
  });
});

describe("buildWecomXml", () => {
  it("builds XML with CDATA for strings", () => {
    const xml = buildWecomXml({ Content: "hello", MsgType: "text" });
    expect(xml).toContain("<Content><![CDATA[hello]]></Content>");
    expect(xml).toContain("<MsgType><![CDATA[text]]></MsgType>");
    expect(xml).toMatch(/^<xml>.*<\/xml>$/);
  });

  it("builds XML with raw values for numbers", () => {
    const xml = buildWecomXml({ CreateTime: 1700000000 });
    expect(xml).toContain("<CreateTime>1700000000</CreateTime>");
  });

  it("handles mixed types", () => {
    const xml = buildWecomXml({ Name: "bot", AgentID: 1000001 });
    expect(xml).toContain("<Name><![CDATA[bot]]></Name>");
    expect(xml).toContain("<AgentID>1000001</AgentID>");
  });
});
