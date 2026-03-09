import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
  resetKey?: string | number | boolean | null;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // Keep runtime diagnostics in console for debugging while preventing white screen.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card p-4 text-sm text-rose-300">
          {this.props.fallbackMessage ?? "页面渲染异常，请刷新后重试。"}
        </div>
      );
    }
    return this.props.children;
  }
}
