declare module "fyers-api-v3" {
  import { EventEmitter } from "node:events";

  export class FyersDataSocket extends EventEmitter {
    LiteMode: unknown;
    FullMode: unknown;
    static getInstance(
      accessToken: string,
      logPath?: string,
      enableLogging?: boolean
    ): FyersDataSocket;
    subscribe(symbols: string[], marketDepth?: boolean): void;
    unsubscribe(symbols: string[], marketDepth?: boolean): void;
    mode(mode: unknown): void;
    autoReconnect(retryCount: number): void;
    setQueueProcessInterval?(intervalMs: number): void;
    connect(): void;
    close(): void;
    isConnected?(): boolean;
  }

  export const fyersDataSocket: typeof FyersDataSocket;
}
