"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAMERA_CONFIG = void 0;
const DEMO_RTSP = "rtsp://admin:8TuwdmlF@155.248.185.149:27720/1/2";
exports.CAMERA_CONFIG = {
    cameras: [
        {
            id: "CTR01",
            name: "Camera Cổng Vào",
            video: {
                source: DEMO_RTSP,
                options: { hwaccel: "auto", rtsp_transport: "tcp" },
            },
        },
        {
            id: "CTR02",
            name: "Camera Cổng Ra",
            video: {
                source: DEMO_RTSP,
                options: { hwaccel: "auto", rtsp_transport: "tcp" },
            },
        },
        {
            id: "CTR03",
            name: "Camera Hành Lang A",
            video: {
                source: DEMO_RTSP,
                options: { hwaccel: "auto", rtsp_transport: "tcp" },
            },
        },
        {
            id: "CTR04",
            name: "Camera Khu Kho",
            video: {
                source: DEMO_RTSP,
                options: { hwaccel: "auto", rtsp_transport: "tcp" },
            },
        },
    ],
};
//# sourceMappingURL=cameras.data.js.map