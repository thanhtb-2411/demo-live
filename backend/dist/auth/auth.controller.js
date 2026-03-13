"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const jwt = require("jsonwebtoken");
let AuthController = class AuthController {
    constructor() {
        this.jwtSecret = process.env.JWT_SECRET || "demo-secret-change-in-production";
    }
    validate(body, res) {
        if (body.action !== "read") {
            res.status(200).send("OK");
            return;
        }
        const params = new URLSearchParams(body.query || "");
        const token = params.get("token");
        if (!token) {
            res.status(401).send("Missing token");
            return;
        }
        try {
            const decoded = jwt.verify(token, this.jwtSecret);
            if (decoded.cameraId !== body.path) {
                res.status(401).send("Token camera mismatch");
                return;
            }
            res.status(200).send("OK");
        }
        catch {
            res.status(401).send("Invalid or expired token");
        }
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)("mediamtx"),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "validate", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)("api/auth")
], AuthController);
//# sourceMappingURL=auth.controller.js.map