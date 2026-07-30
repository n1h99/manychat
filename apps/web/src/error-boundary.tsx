import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProperties {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProperties, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    failed: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, information: ErrorInfo): void {
    console.error('Web application render failed', {
      componentStack: information.componentStack,
      message: error.message,
    });
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="bootstrap-error" role="alert">
          <h1>The interface could not be loaded</h1>
          <p>Refresh the page. If the problem persists, contact support.</p>
        </main>
      );
    }

    return this.props.children;
  }
}
