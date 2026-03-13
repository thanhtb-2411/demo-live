export interface NVR {
    ip: string;
    username: string;
    password: string;
}
export interface VideoConfig {
    source: string;
    options: {
        hwaccel?: string;
        rtsp_transport?: string;
    };
}
export interface Camera {
    id: string;
    name: string;
    video: VideoConfig;
}
export interface CameraConfig {
    cameras: Camera[];
}
export declare const CAMERA_CONFIG: CameraConfig;
