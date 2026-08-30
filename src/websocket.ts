import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { Block, Transaction } from "./types.js";
import { createLogger } from "./logger.js";

interface ExtendedWebSocket extends WebSocket {
  subscriptions?: Set<string>;
}

export type WebSocketEvent =
  | { type: "block"; data: Block }
  | { type: "transaction"; data: Transaction }
  | { type: "mempool"; data: Transaction[] }
  | { type: "chain"; data: { height: number; hash: string } }
  | { type: "sync"; data: { blocks: number; chainWork: string } };

export class BlockchainWebSocket {
  private wss: WebSocketServer;
  private logger = createLogger("WebSocket");

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.setupWebSocket();
    this.logger.info("WebSocket server initialized");
  }

  private setupWebSocket(): void {
    this.wss.on("connection", (ws: ExtendedWebSocket, req) => {
      const clientIp = req.socket.remoteAddress;
      this.logger.info("WebSocket client connected", { ip: clientIp });

      ws.on("message", (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(ws, data);
        } catch (error) {
          this.logger.error("Invalid WebSocket message", { error, ip: clientIp });
          ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
        }
      });

      ws.on("close", () => {
        this.logger.info("WebSocket client disconnected", { ip: clientIp });
      });

      ws.on("error", (error) => {
        this.logger.error("WebSocket error", { error, ip: clientIp });
      });

      // Send initial state
      ws.send(JSON.stringify({ type: "connected", message: "Connected to NoshChain" }));
    });
  }

  private handleClientMessage(ws: WebSocket, data: Record<string, unknown>): void {
    switch (data.type) {
      case "subscribe":
        this.handleSubscribe(ws, data);
        break;
      case "unsubscribe":
        this.handleUnsubscribe(ws, data);
        break;
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
      default:
        ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
    }
  }

  private handleSubscribe(ws: ExtendedWebSocket, data: Record<string, unknown>): void {
    const channels = data.channels as string[] || [];
    const subscriptions = ws.subscriptions ?? new Set<string>();
    ws.subscriptions = subscriptions;
    channels.forEach((channel) => {
      subscriptions.add(channel);
    });
    ws.send(JSON.stringify({ type: "subscribed", channels }));
  }

  private handleUnsubscribe(ws: ExtendedWebSocket, data: Record<string, unknown>): void {
    const channels = data.channels as string[] || [];
    const subscriptions = ws.subscriptions;
    if (subscriptions) {
      channels.forEach((channel) => {
        subscriptions.delete(channel);
      });
    }
    ws.send(JSON.stringify({ type: "unsubscribed", channels }));
  }

  broadcast(event: WebSocketEvent): void {
    const message = JSON.stringify(event);
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        const extendedClient = client as ExtendedWebSocket;
        const subscriptions = extendedClient.subscriptions ?? new Set();

        // Check if client is subscribed to this event type
        let shouldSend = true;
        if (subscriptions.size > 0) {
          switch (event.type) {
            case "block":
              shouldSend = subscriptions.has("blocks") || subscriptions.has("all");
              break;
            case "transaction":
              shouldSend = subscriptions.has("transactions") || subscriptions.has("all");
              break;
            case "mempool":
              shouldSend = subscriptions.has("mempool") || subscriptions.has("all");
              break;
            case "chain":
              shouldSend = subscriptions.has("chain") || subscriptions.has("all");
              break;
            case "sync":
              shouldSend = subscriptions.has("sync") || subscriptions.has("all");
              break;
          }
        }

        if (shouldSend) {
          client.send(message);
        }
      }
    });

    this.logger.debug("Event broadcasted", { type: event.type, clients: this.wss.clients.size });
  }

  broadcastBlock(block: Block): void {
    this.broadcast({ type: "block", data: block });
  }

  broadcastTransaction(tx: Transaction): void {
    this.broadcast({ type: "transaction", data: tx });
  }

  broadcastMempool(transactions: Transaction[]): void {
    this.broadcast({ type: "mempool", data: transactions });
  }

  broadcastChain(height: number, hash: string): void {
    this.broadcast({ type: "chain", data: { height, hash } });
  }

  broadcastSync(blocks: number, chainWork: string): void {
    this.broadcast({ type: "sync", data: { blocks, chainWork } });
  }

  getConnectedClients(): number {
    return this.wss.clients.size;
  }

  close(): void {
    this.wss.close();
    this.logger.info("WebSocket server closed");
  }
}