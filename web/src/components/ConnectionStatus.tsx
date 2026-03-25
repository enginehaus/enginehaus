import { Activity, WifiOff, RefreshCw } from 'lucide-react';
import './ConnectionStatus.css';

interface ConnectionStatusProps {
  isConnected: boolean;
  lastUpdate: Date | null;
  onRefresh?: () => void;
}

function formatLastUpdate(date: Date | null): string {
  if (!date) return 'Never';

  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;

  return date.toLocaleTimeString();
}

export function ConnectionStatus({ isConnected, lastUpdate, onRefresh }: ConnectionStatusProps) {
  return (
    <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
      {isConnected ? (
        <>
          <Activity size={14} className="pulse" />
          <span className="status-text">Live</span>
          <span className="last-update">{formatLastUpdate(lastUpdate)}</span>
        </>
      ) : (
        <>
          <WifiOff size={14} />
          <span className="status-text">Offline</span>
        </>
      )}
      {onRefresh && (
        <button className="refresh-btn" onClick={onRefresh} title="Refresh now">
          <RefreshCw size={12} />
        </button>
      )}
    </div>
  );
}
