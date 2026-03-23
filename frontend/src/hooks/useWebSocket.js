import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';

export function useWebSocket(onMessageCallback) {
  const wsRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);

  const connect = useCallback(() => {
    // Determine the base WebSocket URL based on the API base
    const backendUrl = import.meta.env.VITE_BACKEND_URL || import.meta.env.REACT_APP_BACKEND_URL || globalThis.location.origin;
    const wsUrl = new URL('/api/ws', backendUrl);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

    // Attempt to grab token from localStorage
    const token = localStorage.getItem('auth_token');
    if (token) {
        wsUrl.searchParams.append('token', token);
    } else {
        console.warn("WebSocket not connecting: No auth token found");
        return; // Don't connect if there's no token
    }

    try {
        const ws = new WebSocket(wsUrl.toString());
        wsRef.current = ws;

        ws.onopen = () => {
            console.log('WebSocket connected');
            setIsConnected(true);
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data === "pong") return;
                console.log('WebSocket message received:', data);
                if (onMessageCallback) {
                    onMessageCallback(data);
                }
            } catch (err) {
                console.error("Failed to parse WebSocket message:", err);
            }
        };

        ws.onclose = (event) => {
            console.log('WebSocket disconnected', event.code, event.reason);
            setIsConnected(false);
            wsRef.current = null;

            // Reconnect logic
            if (event.code !== 1008 && event.code !== 1000) { // Don't reconnect on auth failure or normal closure
               reconnectTimeoutRef.current = setTimeout(() => {
                   console.log('Attempting to reconnect WebSocket...');
                   connect();
               }, 3000); // Try again in 3 seconds
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            // The onclose event will typically follow an onerror event
        };

    } catch (e) {
        console.error("Failed to initialize WebSocket:", e);
    }
  }, [onMessageCallback]);

  const disconnect = useCallback(() => {
      if (wsRef.current) {
          wsRef.current.close(1000, "Component unmounting");
          wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
      }
  }, []);

  useEffect(() => {
    connect();

    // Optional: Send periodic pings to keep the connection alive
    const pingInterval = setInterval(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send("ping");
        }
    }, 30000);

    return () => {
        clearInterval(pingInterval);
        disconnect();
    };
  }, [connect, disconnect]);

  return { isConnected };
}
