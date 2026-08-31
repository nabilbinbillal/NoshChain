import {
  generateKeyPairSync,
  createSign,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import type { Transaction } from "./types.js";
import { CHAIN_ID_STRING } from "./types.js";
import { sha256, transactionMessage } from "./crypto.js";

export type WalletData = {
  address: string;
  publicKey: string;
  privateKey: string;
};

export class NoshWallet {
  public readonly address: string;
  public readonly publicKey: string;
  private readonly privateKey: KeyObject;

  constructor(existing?: WalletData) {
    if (existing) {
      this.privateKey = createPrivateKey(existing.privateKey);
      this.publicKey = existing.publicKey;
      this.address = existing.address;
      return;
    }

    const keys = generateKeyPairSync("ec", {
      namedCurve: "secp256k1",
    });

    this.privateKey = keys.privateKey;

    const publicKeyDer = keys.publicKey.export({
      type: "spki",
      format: "der",
    });

    this.address = sha256(publicKeyDer.toString("hex")).slice(-40);

    this.publicKey = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
  }

  getPrivateKeyPem(): string {
    return this.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
  }

  static loadFromFile(path: string): NoshWallet {
    if (!existsSync(path)) {
      throw new Error(`Wallet file not found: ${path}`);
    }

    const data = JSON.parse(readFileSync(path, "utf8")) as WalletData;
    const derived = deriveAddress(data.publicKey);
    if (derived !== data.address) {
      throw new Error("Wallet address does not match public key");
    }
    return new NoshWallet(data);
  }

  sign(
    from: string,
    to: string,
    amount: string,
    fee: string,
    nonce: number,
    extra: Partial<Transaction> = {}
  ): Transaction {
    if (from !== this.address) {
      throw new Error("Invalid sender address");
    }

    const unsigned = {
      chainId: CHAIN_ID_STRING,
      from,
      to,
      amount,
      fee,
      nonce,
      ...extra,
    };

    const signer = createSign("SHA256");
    signer.update(transactionMessage(unsigned));
    signer.end();

    const signature = signer.sign(this.privateKey, "base64");

    return {
      ...unsigned,
      signature,
      publicKey: this.publicKey,
    };
  }

  save(name: string): string {
    const privateKey = this.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();

    const file = `data/wallets/${name}.json`;

    mkdirSync("data/wallets", { recursive: true });

    writeFileSync(
      file,
      JSON.stringify(
        {
          address: this.address,
          publicKey: this.publicKey,
          privateKey,
        },
        null,
        2
      )
    );

    return file;
  }
}

export function deriveAddress(publicKeyPem: string): string {
  const publicKey = createPublicKey(publicKeyPem);
  const exported = publicKey.export({ type: "spki", format: "der" });
  return sha256(exported.toString("hex")).slice(-40);
}
