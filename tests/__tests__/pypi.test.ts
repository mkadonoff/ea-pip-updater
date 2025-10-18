import { fetchPyPiPackage } from "../../src/pypi";
import axios from "axios";

jest.mock("axios");
const mocked = axios as jest.Mocked<typeof axios>;

describe("fetchPyPiPackage", () => {
  it("fetches metadata", async () => {
    mocked.get.mockResolvedValueOnce({ data: { info: { name: "example", version: "1.0.0" }, releases: {} } });
    const res = await fetchPyPiPackage("example");
    expect(res.info.name).toBe("example");
    expect(res.info.version).toBe("1.0.0");
  });
});
