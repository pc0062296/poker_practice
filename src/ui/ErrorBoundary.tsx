import { Component, type ReactNode } from 'react';
import { messages } from '../i18n';

interface State {
  error: Error | null;
}

/** Keeps one broken screen from taking down the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="screen">
        <div className="screen-body">
          <section className="panel">
            <h2 className="panel-heading">{messages.errors.title}</h2>
            <p className="settings-note">{messages.errors.body}</p>
            <pre className="error-detail">{this.state.error.message}</pre>
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              {messages.errors.retry}
            </button>
          </section>
        </div>
      </main>
    );
  }
}
