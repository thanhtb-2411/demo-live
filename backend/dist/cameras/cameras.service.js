"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var CamerasService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CamerasService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = require("axios");
const jwt = require("jsonwebtoken");
const cameras_data_1 = require("./cameras.data");
let CamerasService = CamerasService_1 = class CamerasService {
    constructor() {
        this.logger = new common_1.Logger(CamerasService_1.name);
        this.mediamtxHost = process.env.MEDIAMTX_HOST || "localhost";
        this.mediamtxApiPort = process.env.MEDIAMTX_API_PORT || "9997";
        this.mediamtxWebRTCPort = process.env.MEDIAMTX_WEBRTC_PORT || "8889";
        this.mediamtxPlaybackPort = process.env.MEDIAMTX_PLAYBACK_PORT || "9996";
        this.jwtSecret = process.env.JWT_SECRET || "demo-secret-change-in-production";
    }
    get apiBaseUrl() {
        return `http://${this.mediamtxHost}:${this.mediamtxApiPort}`;
    }
    getCameras() {
        return cameras_data_1.CAMERA_CONFIG.cameras.map(({ id, name }) => ({
            id,
            name,
        }));
    }
    async getLiveStream(id) {
        const camera = cameras_data_1.CAMERA_CONFIG.cameras.find((c) => c.id === id);
        if (!camera) {
            throw new common_1.NotFoundException(`Camera "${id}" không tồn tại trong hệ thống`);
        }
        const rtspUrl = camera.video.source;
        await this.configureMediaMTXPath(camera.id, rtspUrl);
        const token = jwt.sign({ cameraId: camera.id }, this.jwtSecret, { expiresIn: "1h" });
        const streamUrl = `http://${this.mediamtxHost}:${this.mediamtxWebRTCPort}/${camera.id}/whep?token=${token}`;
        this.logger.log(`[${camera.id}] WHEP URL sẵn sàng: ${streamUrl}`);
        return { streamUrl };
    }
    async configureMediaMTXPath(pathId, rtspUrl) {
        const payload = {
            source: rtspUrl,
            sourceOnDemand: true,
            sourceOnDemandStartTimeout: "30s",
            sourceOnDemandCloseAfter: "10s",
            record: true,
        };
        try {
            await axios_1.default.post(`${this.apiBaseUrl}/v3/config/paths/add/${pathId}`, payload);
            this.logger.log(`[MediaMTX] Path "${pathId}" đã được tạo mới`);
        }
        catch (error) {
            const httpStatus = error?.response?.status;
            if (httpStatus === 400) {
                this.logger.log(`[MediaMTX] Path "${pathId}" đã tồn tại, đang cập nhật source...`);
                try {
                    await axios_1.default.patch(`${this.apiBaseUrl}/v3/config/paths/patch/${pathId}`, payload);
                    this.logger.log(`[MediaMTX] Path "${pathId}" đã được cập nhật`);
                }
                catch (patchErr) {
                    this.logger.error(`[MediaMTX] Lỗi PATCH path "${pathId}": ${patchErr.message}`);
                    throw new common_1.HttpException(`Không thể cập nhật cấu hình MediaMTX: ${patchErr.message}`, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
                }
            }
            else {
                this.logger.error(`[MediaMTX] Lỗi kết nối API (status ${httpStatus}): ${error.message}`);
                throw new common_1.HttpException(`Không thể kết nối MediaMTX server: ${error.message}`, common_1.HttpStatus.BAD_GATEWAY);
            }
        }
    }
    async getRecordings(id) {
        const camera = cameras_data_1.CAMERA_CONFIG.cameras.find((c) => c.id === id);
        if (!camera) {
            throw new common_1.NotFoundException(`Camera "${id}" không tồn tại`);
        }
        const token = jwt.sign({ cameraId: id }, this.jwtSecret, { expiresIn: "1h" });
        const playbackBase = `http://${this.mediamtxHost}:${this.mediamtxPlaybackPort}`;
        try {
            const res = await axios_1.default.get(`${playbackBase}/list`, {
                params: { path: id, token },
            });
            const raw = res.data ?? [];
            const recordings = raw.map((seg) => {
                const startDate = new Date(seg.start);
                const label = startDate.toLocaleString("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                });
                const totalSec = Math.floor(seg.duration);
                const h = Math.floor(totalSec / 3600);
                const m = Math.floor((totalSec % 3600) / 60);
                const s = totalSec % 60;
                const durationLabel = [
                    h ? `${h}h` : "",
                    m ? `${m}ph` : "",
                    `${s}s`,
                ]
                    .filter(Boolean)
                    .join(" ");
                const url = `${playbackBase}/get?path=${encodeURIComponent(id)}` +
                    `&start=${encodeURIComponent(seg.start)}` +
                    `&duration=${Math.ceil(seg.duration)}` +
                    `&token=${token}`;
                return { start: seg.start, duration: seg.duration, durationLabel, label, url };
            });
            recordings.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
            return { recordings, playbackBaseUrl: playbackBase, token };
        }
        catch (err) {
            if (err?.response?.status === 404) {
                return { recordings: [], playbackBaseUrl: playbackBase, token };
            }
            this.logger.error(`[Playback] Lỗi lấy recordings cho "${id}": ${err.message}`);
            throw new common_1.HttpException("Không thể lấy danh sách recording", common_1.HttpStatus.BAD_GATEWAY);
        }
    }
};
exports.CamerasService = CamerasService;
exports.CamerasService = CamerasService = CamerasService_1 = __decorate([
    (0, common_1.Injectable)()
], CamerasService);
//# sourceMappingURL=cameras.service.js.map