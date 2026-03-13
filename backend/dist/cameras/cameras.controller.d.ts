import { CamerasService } from "./cameras.service";
export declare class CamerasController {
    private readonly camerasService;
    constructor(camerasService: CamerasService);
    getCameras(): {
        id: string;
        name: string;
    }[];
    getLiveStream(id: string): Promise<{
        streamUrl: string;
    }>;
    getRecordings(id: string): Promise<{
        recordings: import("./cameras.service").RecordingSegment[];
        playbackBaseUrl: string;
        token: string;
    }>;
}
