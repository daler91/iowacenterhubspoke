import React from "react";
import PropTypes from "prop-types";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 m-4 border border-red-200 bg-red-50 text-red-800 rounded-md">
          <h2 className="text-lg font-semibold mb-2">Something went wrong.</h2>
          <p className="text-sm opacity-80 mb-4">{this.state.error?.message || "An unexpected error occurred."}</p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              // Optional: reload window or trigger a refetch if passed via props
            }}
            className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-900 rounded-md text-sm font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ErrorBoundary;
