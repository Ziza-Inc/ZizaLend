import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { MotionConfig } from "framer-motion";
import { MotionProvider } from "./MotionProvider";

// `framer-motion` resolves `prefers-reduced-motion` through a module-level
// listener that is initialised once and cached, which jsdom cannot drive
// reliably. The wiring is therefore asserted where it is decided — the
// `reducedMotion` prop handed to `MotionConfig` — and the stylesheet half is
// asserted against the CSS itself.
jest.mock("framer-motion", () => {
  const actual = jest.requireActual("framer-motion");
  return {
    ...actual,
    MotionConfig: jest.fn(({ children }: { children: React.ReactNode }) => children),
  };
});

const mockedMotionConfig = MotionConfig as unknown as jest.Mock;

describe("reduced motion", () => {
  beforeEach(() => {
    mockedMotionConfig.mockClear();
  });

  it("neutralises custom animations and transitions in the stylesheet", () => {
    // The CSS half covers what framer-motion does not own: the custom keyframe
    // animations and Tailwind's transition utilities. jsdom does not apply media
    // queries, so asserting on the stylesheet is the only way to catch someone
    // deleting the block.
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/[locale]/globals.css"), "utf8");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    // The shimmer is frozen rather than played once: it exists to signal motion.
    expect(css).toMatch(/\.animate-shimmer\s*\{\s*animation:\s*none;/);
  });

  it("renders its children", () => {
    render(
      <MotionProvider>
        <p>inside</p>
      </MotionProvider>,
    );

    expect(screen.getByText("inside")).toBeInTheDocument();
  });

  it("tells framer-motion to follow the visitor's own preference", () => {
    // `user` is what keeps opacity fades while dropping transform, layout and
    // rotate animations. Any other value would either ignore the setting or
    // disable transitions wholesale.
    render(
      <MotionProvider>
        <p>inside</p>
      </MotionProvider>,
    );

    expect(mockedMotionConfig).toHaveBeenCalledWith(
      expect.objectContaining({ reducedMotion: "user" }),
      undefined,
    );
  });
});
