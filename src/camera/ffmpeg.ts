import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createLogger, type Logger } from "../logger.js";

const KILL_TIMEOUT_MS = 2000;

export class FfmpegProcess {
  private readonly process: ChildProcess;
  private readonly log: Logger;
  private stopped = false;
  private killTimer?: NodeJS.Timeout;

  constructor(
    name: string,
    ffmpegPath: string,
    args: string[],
    opts: { stdinData?: string; onExit?: (expected: boolean) => void } = {},
  ) {
    this.log = createLogger(`ffmpeg:${name}`);
    this.log.debug("spawning", { args: args.join(" ") });

    this.process = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });

    if (opts.stdinData !== undefined) {
      this.process.stdin?.write(opts.stdinData);
      this.process.stdin?.end();
    }

    if (this.process.stderr) {
      createInterface({ input: this.process.stderr }).on("line", (line) => {
        if (line.trim()) this.log.debug(line);
      });
    }

    this.process.on("error", (err) => {
      this.log.error("failed to spawn ffmpeg", { error: err.message });
      opts.onExit?.(this.stopped);
    });

    this.process.on("exit", (code, signal) => {
      if (this.killTimer) clearTimeout(this.killTimer);
      if (this.stopped) {
        this.log.debug("exited after stop", { code, signal });
      } else {
        this.log.warn("exited unexpectedly", { code, signal });
      }
      opts.onExit?.(this.stopped);
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.process.kill("SIGTERM");
    this.killTimer = setTimeout(() => {
      if (this.process.exitCode === null) this.process.kill("SIGKILL");
    }, KILL_TIMEOUT_MS);
  }
}
