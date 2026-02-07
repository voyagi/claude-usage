/**
 * Root React component for the Claude Usage dashboard.
 * Manages tab navigation, data fetching, and message handling.
 */
import { useState, useEffect } from 'react';
import { OverviewTab } from './components/OverviewTab';
import { TrustIndicator } from './components/TrustIndicator';
import { DashboardData, WebviewMessage, ExtensionMessage } from './types';
import { vscode } from './index';

type Tab = 'overview' | 'trends' | 'session';

interface AppState {
  activeTab: Tab;
}

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [data, setData] = useState<DashboardData | null>(null);

  // Restore tab from saved state on mount
  useEffect(() => {
    const savedState = vscode.getState() as AppState | undefined;
    if (savedState?.activeTab) {
      setActiveTab(savedState.activeTab);
    }
  }, []);

  // Request initial data and listen for updates
  useEffect(() => {
    // Request data from extension
    const requestMessage: WebviewMessage = { type: 'requestData' };
    vscode.postMessage(requestMessage);

    // Listen for data updates from extension
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      if (message.type === 'usageData') {
        setData(message.payload);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Persist tab selection
  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    vscode.setState({ activeTab: tab });
  };

  return (
    <div className="app-container">
      <TrustIndicator />

      <nav className="tabs">
        <button
          className={activeTab === 'overview' ? 'tab tab-active' : 'tab tab-inactive'}
          onClick={() => handleTabChange('overview')}
        >
          Overview
        </button>
        <button
          className={activeTab === 'trends' ? 'tab tab-active' : 'tab tab-inactive'}
          onClick={() => handleTabChange('trends')}
        >
          Trends
        </button>
        <button
          className={activeTab === 'session' ? 'tab tab-active' : 'tab tab-inactive'}
          onClick={() => handleTabChange('session')}
        >
          Session
        </button>
      </nav>

      <main className="tab-content">
        {!data ? (
          <div className="loading-skeleton">
            <div className="skeleton-card">
              <div className="skeleton-line skeleton-title"></div>
              <div className="skeleton-line"></div>
              <div className="skeleton-line"></div>
            </div>
            <div className="skeleton-card">
              <div className="skeleton-line skeleton-title"></div>
              <div className="skeleton-line"></div>
            </div>
            <div className="skeleton-card">
              <div className="skeleton-line skeleton-title"></div>
              <div className="skeleton-line"></div>
              <div className="skeleton-line"></div>
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && <OverviewTab data={data} />}
            {activeTab === 'trends' && (
              <div className="placeholder-tab">
                <p>Trends tab (Plan 05-04)</p>
              </div>
            )}
            {activeTab === 'session' && (
              <div className="placeholder-tab">
                <p>Session tab (Plan 05-05)</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
