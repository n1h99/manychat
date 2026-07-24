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
          <h1>Не удалось загрузить интерфейс</h1>
          <p>Обновите страницу. Если ошибка повторяется, сообщите в поддержку.</p>
        </main>
      );
    }

    return this.props.children;
  }
}
