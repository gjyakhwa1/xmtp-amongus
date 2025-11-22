import { GameManager } from "./gameManager.js";
import { createAgent } from "./agent/setup.js";
import { createCommandMiddleware } from "./middleware/commandMiddleware.js";
import { setupIntroHandler } from "./handlers/messageHandlers.js";
import {
  setupStartHandler,
  setupJoinHandler,
  setupTaskHandler,
  setupKillHandler,
  setupVoteHandler,
} from "./handlers/commandHandlers.js";

process.loadEnvFile(".env");

// Initialize agent and game manager
const agent = await createAgent();
const gameManager = new GameManager(agent);

// Setup middleware
const commandMiddleware = createCommandMiddleware(agent, gameManager);
agent.use(commandMiddleware);

// Setup message handlers
agent.on("text", setupIntroHandler(agent));

// Setup command handlers
agent.on("text", setupStartHandler(agent, gameManager));
agent.on("text", setupJoinHandler(agent, gameManager));
agent.on("text", setupTaskHandler(gameManager));
agent.on("text", setupKillHandler(agent, gameManager));
agent.on("text", setupVoteHandler(gameManager));

// Start agent
agent.on("start", () => {
  console.log(`MAFIA Agent is running...`);
  console.log(`Address: ${agent.address}`);
  console.log(`Conversation Id: ${agent.client.inboxId}`);
  console.log(`Send @mafia /start to begin!`);
});

await agent.start();
