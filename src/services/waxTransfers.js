const crypto = require("node:crypto");

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map([...BASE58_ALPHABET].map((char, index) => [char, BigInt(index)]));
const CURVE = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
  n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
  gx: BigInt("55066263022277343669578718895168534326250603453777594175500187360389116729240"),
  gy: BigInt("32670510020758816978083085130507043184471273380659243275938904335757337482424")
};
const ZERO_32 = Buffer.alloc(32, 0);

function createWaxTransferService({
  rpcUrl,
  tokenContract,
  tokenSymbol = "NKFE",
  tokenPrecision = 4,
  sourceWallet,
  privateKey,
  permission = "active",
  memo = "Farmer Pets $NKFE withdrawal",
  fetchFn = globalThis.fetch
}) {
  function isConfigured() {
    return Boolean(rpcUrl && tokenContract && sourceWallet && privateKey);
  }

  async function transfer({ to, amount }) {
    if (!isConfigured()) {
      return {
        ok: false,
        error: "Direct WAX withdrawals are not configured. Set WAX_RPC_URL, NKFE_TOKEN_CONTRACT, NKFE_PAYOUT_SOURCE_WALLET, and NKFE_TREASURY_PRIVATE_KEY."
      };
    }

    if (typeof fetchFn !== "function") {
      return { ok: false, error: "Direct WAX withdrawals cannot run because fetch is unavailable." };
    }

    const privateKeyBytes = parseWifPrivateKey(privateKey);
    const publicKey = getCompressedPublicKey(privateKeyBytes);
    const info = await rpcJson(fetchFn, rpcUrl, "/v1/chain/get_info", {});
    const block = await rpcJson(fetchFn, rpcUrl, "/v1/chain/get_block", {
      block_num_or_id: info.last_irreversible_block_num || info.head_block_num
    });
    const transaction = buildTransferTransaction({
      amount,
      block,
      expiration: getExpiration(info.head_block_time),
      from: sourceWallet,
      memo,
      permission,
      to,
      tokenContract,
      tokenPrecision,
      tokenSymbol
    });
    const packedTransaction = serializeTransaction(transaction);
    const digest = sha256(Buffer.concat([
      Buffer.from(info.chain_id, "hex"),
      packedTransaction,
      ZERO_32
    ]));
    const signature = signDigest(privateKeyBytes, publicKey, digest);
    const pushed = await rpcJson(fetchFn, rpcUrl, "/v1/chain/push_transaction", {
      signatures: [signature],
      compression: 0,
      packed_context_free_data: "",
      packed_trx: packedTransaction.toString("hex")
    });

    return {
      ok: true,
      transactionId: pushed.transaction_id || pushed.processed?.id || null
    };
  }

  return { isConfigured, transfer };
}

async function rpcJson(fetchFn, rpcUrl, path, body) {
  const response = await fetchFn(`${rpcUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`WAX RPC ${path} failed with HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }

  return response.json();
}

function buildTransferTransaction({
  amount,
  block,
  expiration,
  from,
  memo,
  permission,
  to,
  tokenContract,
  tokenPrecision,
  tokenSymbol
}) {
  const blockId = Buffer.from(block.id, "hex");

  return {
    expiration,
    refBlockNum: Number(block.block_num) & 0xffff,
    refBlockPrefix: blockId.readUInt32LE(8),
    actions: [{
      account: tokenContract,
      name: "transfer",
      authorization: [{ actor: from, permission }],
      data: serializeTransferData({ from, to, amount, tokenPrecision, tokenSymbol, memo })
    }]
  };
}

function getExpiration(headBlockTime) {
  const base = headBlockTime ? new Date(`${headBlockTime}Z`) : new Date();
  return new Date(base.getTime() + 60_000).toISOString().replace(/\.\d{3}Z$/, "");
}

function serializeTransaction(transaction) {
  const chunks = [];
  pushUInt32(chunks, Math.floor(Date.parse(`${transaction.expiration}Z`) / 1000));
  pushUInt16(chunks, transaction.refBlockNum);
  pushUInt32(chunks, transaction.refBlockPrefix);
  pushVaruint(chunks, 0);
  chunks.push(Buffer.from([0]));
  pushVaruint(chunks, 0);
  pushVaruint(chunks, 0);
  pushVaruint(chunks, transaction.actions.length);

  for (const action of transaction.actions) {
    pushName(chunks, action.account);
    pushName(chunks, action.name);
    pushVaruint(chunks, action.authorization.length);
    for (const auth of action.authorization) {
      pushName(chunks, auth.actor);
      pushName(chunks, auth.permission);
    }
    pushBytes(chunks, action.data);
  }

  pushVaruint(chunks, 0);
  return Buffer.concat(chunks);
}

function serializeTransferData({ from, to, amount, tokenPrecision, tokenSymbol, memo }) {
  const chunks = [];
  pushName(chunks, from);
  pushName(chunks, to);
  pushAsset(chunks, amount, tokenPrecision, tokenSymbol);
  pushString(chunks, memo || "");
  return Buffer.concat(chunks);
}

function pushAsset(chunks, amount, precision, symbol) {
  const scaled = BigInt(Math.round(Number(amount) * (10 ** precision)));
  const buffer = Buffer.alloc(16, 0);
  buffer.writeBigInt64LE(scaled, 0);
  buffer[8] = precision;
  Buffer.from(symbol).copy(buffer, 9, 0, Math.min(symbol.length, 7));
  chunks.push(buffer);
}

function pushBytes(chunks, bytes) {
  pushVaruint(chunks, bytes.length);
  chunks.push(bytes);
}

function pushString(chunks, value) {
  pushBytes(chunks, Buffer.from(value, "utf8"));
}

function pushUInt16(chunks, value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  chunks.push(buffer);
}

function pushUInt32(chunks, value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  chunks.push(buffer);
}

function pushVaruint(chunks, value) {
  const bytes = [];
  let v = Number(value);
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v) byte |= 0x80;
    bytes.push(byte);
  } while (v);
  chunks.push(Buffer.from(bytes));
}

function pushName(chunks, name) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(encodeName(name));
  chunks.push(buffer);
}

function encodeName(name) {
  let value = 0n;
  for (let i = 0; i <= 12; i++) {
    let c = 0n;
    if (i < name.length) c = BigInt(charToSymbol(name[i]));
    if (i < 12) {
      c &= 0x1fn;
      c <<= BigInt(64 - 5 * (i + 1));
    } else {
      c &= 0x0fn;
    }
    value |= c;
  }
  return value;
}

function charToSymbol(char) {
  if (char >= "a" && char <= "z") return char.charCodeAt(0) - "a".charCodeAt(0) + 6;
  if (char >= "1" && char <= "5") return char.charCodeAt(0) - "1".charCodeAt(0) + 1;
  return 0;
}

function parseWifPrivateKey(wif) {
  const decoded = base58Decode(wif);
  if (decoded.length !== 37 && decoded.length !== 38) throw new Error("Invalid WAX private key length.");
  const payload = decoded.subarray(0, decoded.length - 4);
  const checksum = decoded.subarray(decoded.length - 4);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.equals(expected)) throw new Error("Invalid WAX private key checksum.");
  if (payload[0] !== 0x80) throw new Error("Invalid WAX private key prefix.");
  return payload.subarray(1, 33);
}

function base58Decode(value) {
  let num = 0n;
  for (const char of value) {
    const digit = BASE58_MAP.get(char);
    if (digit === undefined) throw new Error("Invalid base58 character.");
    num = num * 58n + digit;
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = hex ? Buffer.from(hex, "hex") : Buffer.alloc(0);
  let leadingZeroes = 0;
  for (const char of value) {
    if (char !== "1") break;
    leadingZeroes += 1;
  }
  if (leadingZeroes) bytes = Buffer.concat([Buffer.alloc(leadingZeroes), bytes]);
  return bytes;
}

function base58Encode(buffer) {
  let num = BigInt(`0x${buffer.toString("hex") || "0"}`);
  let result = "";
  while (num > 0n) {
    const mod = Number(num % 58n);
    result = BASE58_ALPHABET[mod] + result;
    num /= 58n;
  }
  for (const byte of buffer) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result || "1";
}

function signDigest(privateKeyBytes, publicKey, digest) {
  const privateScalar = bytesToBigInt(privateKeyBytes);
  const z = bytesToBigInt(digest);

  for (let attempt = 0; attempt < 100; attempt++) {
    const k = deterministicNonce(privateKeyBytes, digest, attempt);
    const rPoint = pointMultiply(k, G());
    const rValue = mod(rPoint.x, CURVE.n);
    if (rValue === 0n) continue;

    let recovery = Number(rPoint.y & 1n) | (rPoint.x >= CURVE.n ? 2 : 0);
    let sValue = mod(modInv(k, CURVE.n) * (z + rValue * privateScalar), CURVE.n);
    if (sValue === 0n) continue;
    if (sValue > CURVE.n / 2n) {
      sValue = CURVE.n - sValue;
      recovery ^= 1;
    }

    const r = bigIntToBytes(rValue, 32);
    const s = bigIntToBytes(sValue, 32);
    if (findRecoveryId(digest, r, s, publicKey) !== recovery) continue;

    const compact = Buffer.concat([Buffer.from([recovery + 27 + 4]), r, s]);
    const checksum = ripemd160(Buffer.concat([compact, Buffer.from("K1")])).subarray(0, 4);
    return `SIG_K1_${base58Encode(Buffer.concat([compact, checksum]))}`;
  }

  throw new Error("Could not create recoverable WAX signature.");
}

function deterministicNonce(privateKeyBytes, digest, attempt) {
  const seed = Buffer.concat([privateKeyBytes, digest, Buffer.from([attempt])]);
  const value = mod(bytesToBigInt(sha256(seed)), CURVE.n - 1n) + 1n;
  return value;
}

function getCompressedPublicKey(privateKeyBytes) {
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(privateKeyBytes);
  return ecdh.getPublicKey(null, "compressed");
}

function findRecoveryId(digest, rBytes, sBytes, publicKey) {
  const r = bytesToBigInt(rBytes);
  const s = bytesToBigInt(sBytes);
  const z = bytesToBigInt(digest);

  for (let recovery = 0; recovery < 4; recovery++) {
    const x = r + BigInt(Math.floor(recovery / 2)) * CURVE.n;
    if (x >= CURVE.p) continue;
    const ySquare = mod(x ** 3n + 7n, CURVE.p);
    let y = modPow(ySquare, (CURVE.p + 1n) / 4n, CURVE.p);
    if (Number(y & 1n) !== (recovery & 1)) y = CURVE.p - y;
    const rPoint = { x, y };
    const q = pointMultiply(modInv(r, CURVE.n), pointSubtract(pointMultiply(s, rPoint), pointMultiply(z, G())));
    if (!q.infinity && compressedPoint(q).equals(publicKey)) return recovery;
  }

  return null;
}

function decompressPublicKey(publicKey) {
  const x = bytesToBigInt(publicKey.subarray(1));
  const ySquare = mod(x ** 3n + 7n, CURVE.p);
  let y = modPow(ySquare, (CURVE.p + 1n) / 4n, CURVE.p);
  if (Number(y & 1n) !== (publicKey[0] & 1)) y = CURVE.p - y;
  return { x, y };
}

function compressedPoint(point) {
  return Buffer.concat([
    Buffer.from([point.y & 1n ? 0x03 : 0x02]),
    bigIntToBytes(point.x, 32)
  ]);
}

function pointAdd(a, b) {
  if (a.infinity) return b;
  if (b.infinity) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y, CURVE.p) === 0n) return { infinity: true };
    return pointDouble(a);
  }
  const m = mod((b.y - a.y) * modInv(b.x - a.x, CURVE.p), CURVE.p);
  const x = mod(m * m - a.x - b.x, CURVE.p);
  const y = mod(m * (a.x - x) - a.y, CURVE.p);
  return { x, y };
}

function pointDouble(a) {
  if (a.infinity || a.y === 0n) return { infinity: true };
  const m = mod((3n * a.x * a.x) * modInv(2n * a.y, CURVE.p), CURVE.p);
  const x = mod(m * m - 2n * a.x, CURVE.p);
  const y = mod(m * (a.x - x) - a.y, CURVE.p);
  return { x, y };
}

function pointMultiply(scalar, point) {
  let n = mod(scalar, CURVE.n);
  let result = { infinity: true };
  let addend = point;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    n >>= 1n;
  }
  return result;
}

function pointSubtract(a, b) {
  return pointAdd(a, { x: b.x, y: mod(-b.y, CURVE.p), infinity: b.infinity });
}

function G() {
  return { x: CURVE.gx, y: CURVE.gy };
}

function mod(value, divisor) {
  const result = value % divisor;
  return result >= 0n ? result : result + divisor;
}

function modInv(value, divisor) {
  let a = mod(value, divisor);
  let b = divisor;
  let x = 0n;
  let y = 1n;
  let u = 1n;
  let v = 0n;
  while (a !== 0n) {
    const q = b / a;
    [x, u] = [u, x - u * q];
    [y, v] = [v, y - v * q];
    [b, a] = [a, b - a * q];
  }
  if (b !== 1n) throw new Error("Inverse does not exist.");
  return mod(x, divisor);
}

function modPow(base, exponent, divisor) {
  let result = 1n;
  let b = mod(base, divisor);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = mod(result * b, divisor);
    b = mod(b * b, divisor);
    e >>= 1n;
  }
  return result;
}

function bytesToBigInt(bytes) {
  return BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
}

function bigIntToBytes(value, length) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length > length) return bytes.subarray(bytes.length - length);
  if (bytes.length === length) return bytes;
  return Buffer.concat([Buffer.alloc(length - bytes.length), bytes]);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest();
}

function ripemd160(buffer) {
  return crypto.createHash("ripemd160").update(buffer).digest();
}

module.exports = {
  createWaxTransferService,
  internals: {
    base58Encode,
    parseWifPrivateKey,
    serializeTransaction,
    serializeTransferData
  }
};
