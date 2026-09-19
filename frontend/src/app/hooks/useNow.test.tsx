import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { getServerNowSnapshot, useNow } from "./useNow";

function NowProbe() {
  const now = useNow();
  return <span data-testid="now">{now}</span>;
}

describe("useNow", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("exposes 0 as the server snapshot so no time is baked into the HTML", () => {
    // The server render must not contain a real timestamp: a real one would be
    // frozen into the markup and could disagree with the client on hydration.
    expect(getServerNowSnapshot()).toBe(0);
    expect(renderToString(<NowProbe />)).toContain("0");
  });

  it("reports the current time on the client", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    render(<NowProbe />);

    expect(Number(screen.getByTestId("now").textContent)).toBe(
      Date.parse("2026-01-01T00:00:00.000Z"),
    );
  });

  it("returns the same value on every render within one tick", () => {
    // A snapshot that changed on each call would make React re-render forever;
    // this asserts the value is cached between ticks.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { rerender } = render(<NowProbe />);
    const first = screen.getByTestId("now").textContent;

    rerender(<NowProbe />);

    expect(screen.getByTestId("now").textContent).toBe(first);
  });
});
