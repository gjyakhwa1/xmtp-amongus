import { Agent } from "@xmtp/agent-sdk";
import fs from "fs";
import {
  ActionsCodec,
  IntentCodec,
} from "../xmtp-inline-actions/types/index.js";

const getDbPath = (description = "xmtp"): string => {
  let volumePath = ".data/xmtp";

  if (!fs.existsSync(volumePath)) fs.mkdirSync(volumePath, { recursive: true });

  return `${volumePath}/${description}.db3`;
};

export async function createAgent() {
  const dbPath = getDbPath();
  const env = (process.env.XMTP_ENV as "local" | "dev" | "production") || "dev";

  const agent = await Agent.createFromEnv({
    env: env,
    dbPath,
    codecs: [
      new ActionsCodec(),
      new IntentCodec(),
    ],
  });

  return agent;
}

