// Error containment (RevMatch three-tier pattern). A render crash in one
// surface shows a recover card instead of blanking the app.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    this.props.onError?.(error);
  }

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    const detail = `${error.message}\n${(error.stack || '').split('\n').slice(0, 6).join('\n')}`;
    return (
      <div style={{
        position: 'absolute', inset: 0, zIndex: 9000, background: 'var(--bg)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 17, fontWeight: 500 }}>This screen hit a snag</div>
        <div style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 280 }}>Your data is safe. Try again, or reload the app.</div>
        <button
          type="button"
          onClick={() => { try { navigator.clipboard.writeText(detail); } catch { /* ignore */ } this.setState({ copied: true }); setTimeout(() => this.setState({ copied: false }), 1600); }}
          style={{ maxWidth: 300, padding: '8px 10px', borderRadius: 8, background: 'rgba(255, 107, 94, 0.08)', border: '1px solid rgba(255, 107, 94, 0.28)', color: '#FF8A80', fontSize: 11, lineHeight: 1.45, textAlign: 'left', wordBreak: 'break-word' }}
        >
          {copied ? 'Copied' : error.message}
        </button>
        <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
          <button type="button" className="km-btn km-btn--ghost km-btn--sm" onClick={() => this.setState({ error: null })}>Try again</button>
          <button type="button" className="km-btn km-btn--sm" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
