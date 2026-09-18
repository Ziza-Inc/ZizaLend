"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import Link from "next/link";
import { RefreshCcw, Siren, TriangleAlert } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  scope?: string;
  variant?: "page" | "section";
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorFallbackProps {
  error?: Error | null;
  onRetry: () => void;
  scope?: string;
  variant?: "page" | "section";
}

const REPORT_ISSUE_URL = "https://github.com/Ziza-Inc/ZizaLend/issues/new";

export function ErrorFallback({
  error,
  onRetry,
  scope = "section",
  variant = "section",
}: ErrorFallbackProps) {
  const isPage = variant === "page";

  return (
    <div
      className={
        isPage
          ? "flex min-h-[70vh] items-center justify-center px-4 py-10"
          : "rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 shadow-sm"
      }
      role="alert"
      aria-live="assertive"
    >
      <div
        className={
          isPage
            ? "mx-auto max-w-xl rounded-[2rem] border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 text-center shadow-lg"
            : "flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"
        }
      >
        <div className={isPage ? "space-y-5" : "flex gap-4"}>
          <div
            className={
              isPage
                ? "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400"
                : "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400"
            }
            aria-hidden="true"
          >
            {isPage ? <Siren className="h-8 w-8" /> : <TriangleAlert className="h-6 w-6" />}
          </div>
          <div className={isPage ? "space-y-3" : "space-y-2"}>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
              Something went wrong
            </h1>
            <p className="max-w-lg text-sm leading-6 text-[var(--text-secondary)]">
              {`The ${scope} hit an unexpected runtime error. You can reset this area and keep using the rest of Zizalend.`}
            </p>
            {error?.message ? (
              <p className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 font-mono text-xs text-[var(--text-secondary)]">
                {error.message}
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={
            isPage
              ? "flex flex-col items-center justify-center gap-3 pt-2 sm:flex-row"
              : "flex flex-wrap items-center gap-3"
          }
        >
          <button
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            <RefreshCcw className="h-4 w-4" />
            Try Again
          </button>
          <Link
            href={REPORT_ISSUE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-[var(--border-default)] px-5 py-2.5 text-sm font-semibold text-[var(--text-secondary)] transition hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
          >
            Report this issue
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * ErrorBoundary catches JavaScript errors anywhere in its child component tree
 * and displays a fallback UI instead of crashing the entire application.
 *
 * Must be a class component — React does not yet support error boundaries
 * as functional components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleReset}
          scope={this.props.scope}
          variant={this.props.variant}
        />
      );
    }

    return this.props.children;
  }
}
