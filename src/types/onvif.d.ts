declare module "onvif" {
  import { EventEmitter } from "node:events";

  export interface CamOptions {
    hostname: string;
    username: string;
    password: string;
    port?: number;
    timeout?: number;
    preserveAddress?: boolean;
  }

  export interface CamEventTopic {
    _?: string;
  }

  export interface CamEventSimpleItem {
    $?: { Name?: string; Value?: unknown };
  }

  export interface CamEventMessage {
    topic?: CamEventTopic;
    message?: {
      message?: {
        data?: {
          simpleItem?: CamEventSimpleItem | CamEventSimpleItem[];
        };
      };
    };
  }

  export class Cam extends EventEmitter {
    constructor(options: CamOptions, callback?: (error?: Error) => void);
    on(event: "event", listener: (message: CamEventMessage, xml?: string) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    removeAllListeners(event?: string): this;
  }
}
