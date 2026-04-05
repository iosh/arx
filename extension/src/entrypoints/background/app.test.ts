import { beforeEach, describe, expect, it, vi } from "vitest";

const { createBackgroundRootMock } = vi.hoisted(() => ({
  createBackgroundRootMock: vi.fn(),
}));

vi.mock("./backgroundRoot", () => ({
  createBackgroundRoot: createBackgroundRootMock,
}));

describe("background app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createBackgroundRootMock.mockReturnValue({
      initialize: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
    });
  });

  it("delegates start and stop to the background root", async () => {
    const { createBackgroundApp } = await import("./app");

    const app = createBackgroundApp();
    await app.start();
    await app.stop();

    expect(createBackgroundRootMock).toHaveBeenCalledTimes(1);
    const root = createBackgroundRootMock.mock.results[0]?.value;
    expect(root.initialize).toHaveBeenCalledTimes(1);
    expect(root.shutdown).toHaveBeenCalledTimes(1);
  });
});
