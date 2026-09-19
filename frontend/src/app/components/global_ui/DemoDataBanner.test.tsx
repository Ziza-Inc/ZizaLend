import { render, screen } from "@testing-library/react";
import { DemoDataBanner, isDemoDataEnabled } from "./DemoDataBanner";

/**
 * The banner is the only thing standing between a seeded deployment and a reader who believes the
 * numbers are real, so both halves matter: it has to appear when the flag is set, and it has to stay
 * away when it is not — a banner that shows up on every local page load is one developers learn to
 * ignore.
 */
describe("isDemoDataEnabled", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    [" true ", true],
    ["1", true],
  ])("treats %p as enabled", (value, expected) => {
    expect(isDemoDataEnabled(value)).toBe(expected);
  });

  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["0", false],
    ["no", false],
    ["yes", false],
  ])("treats %p as disabled", (value, expected) => {
    expect(isDemoDataEnabled(value)).toBe(expected);
  });
});

describe("DemoDataBanner", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DEMO_DATA;
  });

  it("renders the seeded-data notice when the flag is set", () => {
    process.env.NEXT_PUBLIC_DEMO_DATA = "true";

    render(<DemoDataBanner />);

    expect(screen.getByTestId("demo-data-banner")).toBeInTheDocument();
    expect(screen.getByText(/Demo data\./)).toBeInTheDocument();
    expect(screen.getByText(/not real transactions/)).toBeInTheDocument();
  });

  it("announces itself as a status rather than as decoration", () => {
    process.env.NEXT_PUBLIC_DEMO_DATA = "true";

    render(<DemoDataBanner />);

    expect(screen.getByRole("status")).toHaveTextContent("Demo data.");
  });

  it("renders nothing when the flag is unset", () => {
    render(<DemoDataBanner />);

    expect(screen.queryByTestId("demo-data-banner")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it('renders nothing when the flag is "false"', () => {
    process.env.NEXT_PUBLIC_DEMO_DATA = "false";

    render(<DemoDataBanner />);

    expect(screen.queryByTestId("demo-data-banner")).not.toBeInTheDocument();
  });
});
