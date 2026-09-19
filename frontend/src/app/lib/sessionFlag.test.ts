import { readSessionFlag, subscribeToSessionFlag, writeSessionFlag } from "./sessionFlag";

const KEY = "test-banner-dismissed";

describe("sessionFlag", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("reads a flag that was written", () => {
    expect(readSessionFlag(KEY)).toBe(false);

    writeSessionFlag(KEY, true);
    expect(readSessionFlag(KEY)).toBe(true);

    writeSessionFlag(KEY, false);
    expect(readSessionFlag(KEY)).toBe(false);
  });

  it("notifies subscribers so the UI updates without an effect", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToSessionFlag(KEY, listener);

    writeSessionFlag(KEY, true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    writeSessionFlag(KEY, true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not throw when sessionStorage is unavailable", () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(() => writeSessionFlag(KEY, true)).not.toThrow();
    expect(readSessionFlag(KEY)).toBe(false);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
