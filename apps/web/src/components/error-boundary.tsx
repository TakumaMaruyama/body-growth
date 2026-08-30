import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          身体成長<small>Body Growth Record</small>
        </div>
      </header>
      <main className="container">
        <div className="card error-fallback">
          <h1>画面を読み込めませんでした</h1>
          <p className="subtle">
            一時的な問題が発生しました。もう一度お試しください。
          </p>
          {/* Dev only: messages can carry API responses and other internals. */}
          {import.meta.env.DEV ? (
            <pre className="error-detail">{error.message || String(error)}</pre>
          ) : null}
          <button type="button" onClick={resetError} className="button">
            もう一度読み込む
          </button>
        </div>
      </main>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      "ErrorBoundary caught an error:",
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
