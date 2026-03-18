import { createSign, createPrivateKey } from "node:crypto";

/**
 * Signs a payload using a Turnkey P256 private key.
 *
 * The Go CLI uses `apikey.Stamp(payload, key)` from tkhq/go-sdk.
 * This replicates that behavior: ECDSA P256 signature over the raw payload bytes,
 * returned as a Turnkey API stamp string.
 *
 * NOTE: This is a simplified implementation. The actual Turnkey stamp format
 * includes a JSON structure with the public key, signature scheme, and signature.
 * For production use, consider using @turnkey/api-key-stamper from npm.
 */
export class Signer {
  constructor(private privateKey: string) {}

  /**
   * Sign a single payload string and return the stamp.
   * The privateKey is expected to be a Turnkey-format P256 private key.
   */
  sign(payload: string): string {
    if (!payload.trim()) {
      throw new Error("Cannot sign empty payload");
    }

    // Turnkey private keys are hex-encoded raw P256 private key bytes.
    // Convert to a PEM or JWK for Node's crypto module.
    const keyBuffer = Buffer.from(this.privateKey, "hex");

    const key = createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        d: keyBuffer.toString("base64url"),
        // x and y would be derived, but for signing we only need d
      },
      format: "jwk",
    });

    const signer = createSign("SHA256");
    signer.update(payload);
    const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });

    // Return as hex-encoded signature (Turnkey stamp format wraps this)
    return signature.toString("hex");
  }

  /**
   * Sign multiple unsigned payloads, returning signatures in order.
   */
  signAll(payloads: Array<{ payload: string }>): string[] {
    if (payloads.length === 0) {
      throw new Error("No payloads to sign");
    }
    return payloads.map((p) => this.sign(p.payload));
  }
}
