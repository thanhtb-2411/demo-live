export interface RecordingSegment {
    start: string;
    duration: number;
    durationLabel: string;
    label: string;
    url: string;
}
export declare class CamerasService {
    private readonly logger;
    private readonly mediamtxHost;
    private readonly mediamtxApiPort;
    private readonly mediamtxWebRTCPort;
    private readonly mediamtxPlaybackPort;
    private readonly jwtSecret;
    private get apiBaseUrl();
    getCameras(): {
        id: string;
        name: string;
    }[];
    getLiveStream(id: string): Promise<{
        streamUrl: string;
    }>;
    private configureMediaMTXPath;
    getRecordings(id: string): Promise<{
        recordings: RecordingSegment[];
        playbackBaseUrl: string;
        token: string;
    }>;
}
