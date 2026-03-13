import { Response } from "express";
interface MediaMTXAuthPayload {
    user?: string;
    password?: string;
    ip?: string;
    action?: "read" | "publish" | "playback";
    path?: string;
    protocol?: string;
    id?: string;
    query?: string;
}
export declare class AuthController {
    private readonly jwtSecret;
    validate(body: MediaMTXAuthPayload, res: Response): void;
}
export {};
