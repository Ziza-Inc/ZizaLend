import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyState } from "./EmptyState";
import { Info } from "lucide-react";

// Mock next/link
jest.mock("next/link", () => {
  // Named rather than an anonymous arrow so `react/display-name` has something
  // to report and the component shows up by name in failure output.
  return function MockLink({
    children,
    href,
    className,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) {
    return (
      <a href={href} className={className} {...props}>
        {children}
      </a>
    );
  };
});

describe("EmptyState", () => {
  it("renders icon, title, and description", () => {
    render(<EmptyState icon={Info} title="No data" description="Nothing to see here" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("Nothing to see here")).toBeInTheDocument();
  });

  it("renders an action link when actionHref is provided", () => {
    render(
      <EmptyState
        icon={Info}
        title="No items"
        description="Create your first item"
        actionLabel="Create"
        actionHref="/create"
      />,
    );
    const link = screen.getByRole("link", { name: /Create/ });
    expect(link).toHaveAttribute("href", "/create");
  });

  it("renders a button action when onAction is provided", () => {
    const onAction = jest.fn();
    render(
      <EmptyState
        icon={Info}
        title="No items"
        description="Create your first item"
        actionLabel="Create"
        onAction={onAction}
      />,
    );
    const btn = screen.getByRole("button", { name: /Create/ });
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders action icon when provided", () => {
    render(
      <EmptyState
        icon={Info}
        title="No items"
        description="Get started"
        actionLabel="Go"
        actionHref="/start"
        actionIcon={<span data-testid="custom-icon">→</span>}
      />,
    );
    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
  });

  it("does not render action section when no actionLabel is provided", () => {
    render(<EmptyState icon={Info} title="No data" description="Nothing here" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(
      <EmptyState
        icon={Info}
        title="Test"
        description="Test description"
        className="custom-class"
      />,
    );
    const container = screen.getByText("Test").parentElement;
    expect(container?.className).toContain("custom-class");
  });
});
