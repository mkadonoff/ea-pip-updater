"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pypi_1 = require("../../src/pypi");
const axios_1 = __importDefault(require("axios"));
jest.mock("axios");
const mocked = axios_1.default;
describe("fetchPyPiPackage", () => {
    it("fetches metadata", async () => {
        mocked.get.mockResolvedValueOnce({ data: { info: { name: "example", version: "1.0.0" }, releases: {} } });
        const res = await (0, pypi_1.fetchPyPiPackage)("example");
        expect(res.info.name).toBe("example");
        expect(res.info.version).toBe("1.0.0");
    });
});
//# sourceMappingURL=pypi.test.js.map