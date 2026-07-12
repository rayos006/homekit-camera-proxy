/**
 * hap-nodejs publishes these as `declare const enum`s, which have no runtime
 * representation — fine under tsc (values are inlined) but undefined when run
 * with tsx/esbuild. These HAP protocol constants are mirrored here, typed
 * against the real enums so a drift would fail the typecheck.
 */
import type {
  AudioBitrate,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  Categories,
  H264Level,
  H264Profile,
  MDNSAdvertiser,
  SRTPCryptoSuites,
  StreamRequestTypes,
} from "@homebridge/hap-nodejs";

export const CATEGORY_IP_CAMERA = 17 as Categories.IP_CAMERA;
export const CATEGORY_VIDEO_DOORBELL = 18 as Categories.VIDEO_DOORBELL;
export const ADVERTISER_CIAO = "ciao" as MDNSAdvertiser.CIAO;
export const SRTP_AES_CM_128 = 0 as SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80;
export const H264_PROFILES = [0, 1, 2] as H264Profile[]; // BASELINE, MAIN, HIGH
export const H264_LEVELS = [0, 1, 2] as H264Level[]; // 3.1, 3.2, 4.0
export const CODEC_AAC_ELD = "AAC-eld" as AudioStreamingCodecType.AAC_ELD;
export const SAMPLERATE_16K = 16 as AudioStreamingSamplerate.KHZ_16;
export const BITRATE_VARIABLE = 0 as AudioBitrate.VARIABLE;
export const STREAM_START = "start" as StreamRequestTypes.START;
export const STREAM_RECONFIGURE = "reconfigure" as StreamRequestTypes.RECONFIGURE;
export const STREAM_STOP = "stop" as StreamRequestTypes.STOP;
