import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useHydrated } from "./useHydrated";

function HydratedProbe() {
  const hydrated = useHydrated();
  return <span data-testid="hydrated">{String(hydrated)}</span>;
}

describe("useHydrated", () => {
  it("is false during a server render", () => {
    expect(renderToString(<HydratedProbe />)).toContain("false");
  });

  it("is true on the client, without needing an effect to flip it", () => {
    render(<HydratedProbe />);
    expect(screen.getByTestId("hydrated").textContent).toBe("true");
  });
});
