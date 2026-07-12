import {
  Accessory,
  CameraController,
  type CameraControllerOptions,
  Characteristic,
  DoorbellController,
  Service,
  uuid,
} from "@homebridge/hap-nodejs";
import type { AppConfig, CameraConfig } from "../config.js";
import {
  BITRATE_VARIABLE,
  CODEC_AAC_ELD,
  H264_LEVELS,
  H264_PROFILES,
  SAMPLERATE_16K,
  SRTP_AES_CM_128,
} from "../util/hap-values.js";
import { cameraUuidSeed } from "../util/identifiers.js";
import type { SnapshotFetcher } from "./snapshot.js";
import { FrigateStreamingDelegate } from "./streaming-delegate.js";

export interface CameraAccessory {
  accessory: Accessory;
  controller: CameraController;
  delegate: FrigateStreamingDelegate;
  setMotion: (detected: boolean) => void;
  ring?: () => void;
}

export function buildCameraAccessory(
  config: AppConfig,
  camera: CameraConfig,
  snapshots: SnapshotFetcher,
): CameraAccessory {
  const accessory = new Accessory(camera.name, uuid.generate(cameraUuidSeed(camera.name)));

  accessory
    .getService(Service.AccessoryInformation)!
    .setCharacteristic(Characteristic.Manufacturer, "Frigate Proxy")
    .setCharacteristic(Characteristic.Model, camera.frigateName)
    .setCharacteristic(Characteristic.SerialNumber, accessory.UUID.slice(0, 8));

  const delegate = new FrigateStreamingDelegate(config, camera, snapshots);

  const options: CameraControllerOptions = {
    cameraStreamCount: 2,
    delegate,
    streamingOptions: {
      supportedCryptoSuites: [SRTP_AES_CM_128],
      video: {
        codec: { profiles: H264_PROFILES, levels: H264_LEVELS },
        resolutions: [
          [1920, 1080, 30],
          [1280, 720, 30],
          [1280, 720, 15],
          [1024, 576, 30],
          [640, 360, 30],
          [480, 270, 30],
          [320, 240, 15], // Apple Watch
        ],
      },
      ...(camera.audio && {
        audio: {
          twoWayAudio: camera.twoWayAudio,
          codecs: [
            {
              type: CODEC_AAC_ELD,
              samplerate: SAMPLERATE_16K,
              bitrate: BITRATE_VARIABLE,
              audioChannels: 1,
            },
          ],
        },
      }),
    },
  };

  const controller = camera.doorbell
    ? new DoorbellController(options)
    : new CameraController(options);
  delegate.controller = controller;
  accessory.configureController(controller);

  const motionService = accessory.addService(Service.MotionSensor, `${camera.name} Motion`);
  const setMotion = (detected: boolean): void => {
    motionService.updateCharacteristic(Characteristic.MotionDetected, detected);
  };

  return {
    accessory,
    controller,
    delegate,
    setMotion,
    ring:
      controller instanceof DoorbellController ? () => controller.ringDoorbell() : undefined,
  };
}
