import { FfmpegProcess } from "./ffmpeg.js";

/**
 * Return-audio (talkback) pipeline: the iOS device sends AAC-ELD SRTP to the
 * local audio port we advertised in prepareStream. ffmpeg reads it via an SDP
 * description on stdin, decodes, and publishes PCMA/8000 to go2rtc over RTSP;
 * go2rtc forwards it to the camera's speaker backchannel.
 */

export interface TalkbackParams {
  audioPort: number; // local port the device sends return audio to
  srtpKeySalt: Buffer; // 16-byte key + 14-byte salt (same material we echoed)
  targetRtspUrl: string; // go2rtc stream to publish into
  ffmpegPath: string;
  cameraName: string;
  onExit?: (expected: boolean) => void;
}

export function buildTalkbackSdp(audioPort: number, srtpKeySalt: Buffer): string {
  // AAC-ELD 16 kHz mono, payload 110 — mirrors homebridge-camera-ffmpeg's
  // known-good talkback SDP (config F8F0212C00BC00 = AAC-ELD @16k).
  return [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=Talk",
    "c=IN IP4 0.0.0.0",
    "t=0 0",
    `m=audio ${audioPort} RTP/AVP 110`,
    "b=AS:24",
    "a=rtpmap:110 MPEG4-GENERIC/16000/1",
    "a=fmtp:110 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3;config=F8F0212C00BC00",
    `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${srtpKeySalt.toString("base64")}`,
  ].join("\r\n");
}

export function startTalkback(params: TalkbackParams): FfmpegProcess {
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-protocol_whitelist", "pipe,udp,rtp,file,crypto",
    "-f", "sdp",
    "-c:a", "libfdk_aac",
    "-i", "pipe:0",
    "-c:a", "pcm_alaw",
    "-ar", "8000",
    "-ac", "1",
    "-f", "rtsp",
    "-rtsp_transport", "tcp",
    params.targetRtspUrl,
  ];
  return new FfmpegProcess(`talkback:${params.cameraName}`, params.ffmpegPath, args, {
    stdinData: buildTalkbackSdp(params.audioPort, params.srtpKeySalt),
    onExit: params.onExit,
  });
}
