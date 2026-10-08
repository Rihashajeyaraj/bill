import React from "react";

export default class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: String(error?.message || "Unexpected application error")
    };
  }

  componentDidCatch(error, info) {
    console.error("Root render crash", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900">
        <div className="mx-auto w-full max-w-2xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-rose-700">Application Error</h1>
          <p className="mt-2 text-sm text-slate-700">
            The app crashed while rendering. Refresh the page. If it repeats, share the error below.
          </p>
          <pre className="mt-4 overflow-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">
            {this.state.message}
          </pre>
        </div>
      </div>
    );
  }
}
