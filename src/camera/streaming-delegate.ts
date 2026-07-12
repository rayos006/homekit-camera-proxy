import { createSocket, type Socket } from "node:dgram";
import {
  CameraController,
  type CameraStreamingDelegate,
  type PrepareStreamCallback,
  type PrepareStreamRequest,
  type PrepareStreamResponse,
  type SnapshotRequest,
  type SnapshotRequestCallback,
  type StartStreamRequest,
  type StreamingRequest,
  type StreamRequestCallback,
} from "@homebridge/hap-nodejs";
import { type AppConfig, type CameraConfig, rtspUrl } from "../config.js";
import { createLogger } from "../logger.js";
import { STREAM_RECONFIGURE, STREAM_START, STREAM_STOP } from "../util/hap-values.js";
import { FfmpegProcess } from "./ffmpeg.js";
import type { SnapshotFetcher } from "./snapshot.js";
import { startTalkback } from "./talkback.js";

interface StreamEndpoint {
  localPort: number;
  socket: Socket;
  ssrc: number;
  srtpKeySalt: Buffer; // key (16) + salt (14)
  targetPort: number;
}

interface SessionInfo {
  targetAddress: string;
  addressVersion: "ipv4" | "ipv6";
  video: StreamEndpoint;
  audio?: StreamEndpoint;
}

interface OngoingSession {
  main: FfmpegProcess;
  talkback?: FfmpegProcess;
  info: SessionInfo;
}

function bindUdpPort(version: "ipv4" | "ipv6"): Promise<{ socket: Socket; port: number }> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(version === "ipv6" ? "udp6" : "udp4");
    socket.once("error", reject);
    socket.bind(0, () => resolve({ socket, port: socket.address().port }));
  });
}

export class FrigateStreamingDelegate implements CameraStreamingDelegate {
  /** Assigned right after the controller is constructed with this delegate. */
  controller!: CameraController;

  private readonly log;
  private readonly pending = new Map<string, SessionInfo>();
  private readonly ongoing = new Map<string, OngoingSession>();

  constructor(
    private readonly config: AppConfig,
    private readonly camera: CameraConfig,
    private readonly snapshots: SnapshotFetcher,
  ) {
    this.log = createLogger(`stream:${camera.frigateName}`);
  }

  get activeStreamCount(): number {
    return this.ongoing.size;
  }

  handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
    this.snapshots
      .fetch(this.camera.frigateName, request.height)
      .then((data) => callback(undefined, data))
      .catch((err) => {
        this.log.warn("snapshot failed", { error: String(err) });
        callback(err instanceof Error ? err : new Error(String(err)));
      });
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    try {
      const video = await bindUdpPort(request.addressVersion);
      const session: SessionInfo = {
        targetAddress: request.targetAddress,
        addressVersion: request.addressVersion,
        video: {
          localPort: video.port,
          socket: video.socket,
          ssrc: CameraController.generateSynchronisationSource(),
          srtpKeySalt: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
          targetPort: request.video.port,
        },
      };

      const response: PrepareStreamResponse = {
        video: {
          port: video.port,
          ssrc: session.video.ssrc,
          srtp_key: request.video.srtp_key,
          srtp_salt: request.video.srtp_salt,
        },
      };

      if (this.camera.audio) {
        const audio = await bindUdpPort(request.addressVersion);
        session.audio = {
          localPort: audio.port,
          socket: audio.socket,
          ssrc: CameraController.generateSynchronisationSource(),
          srtpKeySalt: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
          targetPort: request.audio.port,
        };
        response.audio = {
          port: audio.port,
          ssrc: session.audio.ssrc,
          srtp_key: request.audio.srtp_key,
          srtp_salt: request.audio.srtp_salt,
        };
      }

      this.pending.set(request.sessionID, session);
      callback(undefined, response);
    } catch (err) {
      this.log.error("prepareStream failed", { error: String(err) });
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    switch (request.type) {
      case STREAM_START:
        this.startStream(request, callback);
        return;
      case STREAM_RECONFIGURE:
        // -c:v copy cannot adapt; iOS copes with the original stream parameters
        this.log.debug("ignoring reconfigure", {
          width: request.video.width,
          height: request.video.height,
        });
        callback();
        return;
      case STREAM_STOP:
        this.stopStream(request.sessionID, true);
        callback();
        return;
    }
  }

  private selectStream(requestedWidth: number): string {
    const { main, sub } = this.camera.streams;
    if (!sub || requestedWidth >= 1280) return main;
    return sub;
  }

  private startStream(request: StartStreamRequest, callback: StreamRequestCallback): void {
    const session = this.pending.get(request.sessionID);
    if (!session) {
      callback(new Error(`no prepared session ${request.sessionID}`));
      return;
    }
    this.pending.delete(request.sessionID);

    const stream = this.selectStream(request.video.width);
    const input = rtspUrl(this.config, stream);
    const address =
      session.addressVersion === "ipv6" ? `[${session.targetAddress}]` : session.targetAddress;

    const args: string[] = [
      "-hide_banner",
      "-loglevel", "warning",
      "-rtsp_transport", "tcp",
      "-i", input,
      "-sn", "-dn",
      "-map", "0:v:0",
    ];

    if (this.camera.videoCodec === "copy") {
      args.push("-c:v", "copy");
    } else {
      args.push(
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-color_range", "mpeg",
        "-r", String(request.video.fps),
        "-b:v", `${request.video.max_bit_rate}k`,
        "-maxrate", `${request.video.max_bit_rate}k`,
        "-bufsize", `${request.video.max_bit_rate * 2}k`,
        "-filter:v",
        `scale='min(${request.video.width},iw)':'min(${request.video.height},ih)':force_original_aspect_ratio=decrease`,
      );
    }

    args.push(
      "-payload_type", String(request.video.pt),
      "-ssrc", String(session.video.ssrc),
      "-f", "rtp",
      "-srtp_out_suite", "AES_CM_128_HMAC_SHA1_80",
      "-srtp_out_params", session.video.srtpKeySalt.toString("base64"),
      `srtp://${address}:${session.video.targetPort}?rtcpport=${session.video.targetPort}&pkt_size=1316`,
    );

    if (this.camera.audio && session.audio) {
      args.push(
        "-map", "0:a:0?",
        "-c:a", "libfdk_aac",
        "-profile:a", "aac_eld",
        "-flags", "+global_header",
        "-ar", "16k",
        "-b:a", "24k",
        "-ac", "1",
        "-payload_type", String(request.audio.pt),
        "-ssrc", String(session.audio.ssrc),
        "-f", "rtp",
        "-srtp_out_suite", "AES_CM_128_HMAC_SHA1_80",
        "-srtp_out_params", session.audio.srtpKeySalt.toString("base64"),
        `srtp://${address}:${session.audio.targetPort}?rtcpport=${session.audio.targetPort}&pkt_size=188`,
      );
    }

    this.log.info("starting stream", {
      stream,
      width: request.video.width,
      height: request.video.height,
      codec: this.camera.videoCodec,
      audio: this.camera.audio,
    });

    const main = new FfmpegProcess(this.camera.frigateName, this.config.ffmpegPath, args, {
      onExit: (expected) => {
        if (!expected && this.ongoing.has(request.sessionID)) {
          this.log.warn("stream died, notifying controller");
          this.stopStream(request.sessionID, false);
          this.controller.forceStopStreamingSession(request.sessionID);
        }
      },
    });

    let talkback: FfmpegProcess | undefined;
    if (this.camera.twoWayAudio && session.audio) {
      // free the advertised audio port so the talkback ffmpeg can bind it
      session.audio.socket.close();
      talkback = startTalkback({
        audioPort: session.audio.localPort,
        srtpKeySalt: session.audio.srtpKeySalt,
        targetRtspUrl: rtspUrl(this.config, this.camera.streams.main),
        ffmpegPath: this.config.ffmpegPath,
        cameraName: this.camera.frigateName,
        onExit: (expected) => {
          if (!expected) this.log.warn("talkback process died; live view continues");
        },
      });
    }

    this.ongoing.set(request.sessionID, { main, talkback, info: session });
    callback();
  }

  private stopStream(sessionID: string, expected: boolean): void {
    const pending = this.pending.get(sessionID);
    if (pending) {
      pending.video.socket.close();
      pending.audio?.socket.close();
      this.pending.delete(sessionID);
    }

    const session = this.ongoing.get(sessionID);
    if (!session) return;
    this.ongoing.delete(sessionID);
    session.main.stop();
    session.talkback?.stop();
    session.info.video.socket.close();
    if (!this.camera.twoWayAudio) session.info.audio?.socket.close();
    this.log.info("stream stopped", { sessionID, expected });
  }

  stopAll(): void {
    for (const id of [...this.ongoing.keys(), ...this.pending.keys()]) {
      this.stopStream(id, true);
    }
  }
}
